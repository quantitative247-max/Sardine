// Global app state + persistence (JSON files via Rust).
import { api } from './backend.js';
import { setMacros } from './md.js';
import { newSched, isDue, todayKey } from './sched.js';

export const DEFAULT_SETTINGS = {
  macros: '', newPerDay: 20, defaultSide: 'front', cardMode: false, sideOpen: true,
  theme: 'system', invertPages: true, sideTab: 'toc',
};

export const app = $state({
  ready: false,
  view: 'library',           // 'library' | 'reader'
  docs: {},                  // id -> doc meta
  annos: {},                 // docId -> [annotation]
  present: {},               // id -> true when the PDF file is in the library folder
  settings: { ...DEFAULT_SETTINGS },
  newcount: { day: '', n: 0 },
  docId: null,               // open document
  info: null,                // { num_pages, sizes, outline }
  page: 1,                   // current page in reader
  editor: null,              // editor state
  review: null,              // review session
  dialog: null,              // { kind:'confirm'|'settings'|'help', ... }
  toast: '',
  coverBust: 0,
  systemDark: false,
});

// Non-reactive hooks the reader registers (goToPage, flashTo …)
export const ctl = {};

// ---------------------------------------------------------------- toast & dialogs
let toastT;
export function toast(msg, ms = 2200) { app.toast = msg; clearTimeout(toastT); toastT = setTimeout(() => (app.toast = ''), ms); }
export function confirmBox(html, yes = 'Delete') {
  return new Promise((resolve) => { app.dialog = { kind: 'confirm', html, yes, resolve }; });
}

// ---------------------------------------------------------------- persistence
const timers = {};
function debounce(key, fn, ms = 400) { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); }
const snap = (v) => JSON.stringify($state.snapshot(v));
export const saveDocs = () => debounce('docs', () => api.storeSet('docs', snap(app.docs)).catch(errToast));
export const saveSettings = () => debounce('settings', () => api.storeSet('settings', snap(app.settings)).catch(errToast), 100);
export const saveAnnos = (docId) => debounce('annos/' + docId, () => api.storeSet('annos/' + docId, snap(app.annos[docId] || [])).catch(errToast), 150);
const saveNew = () => api.storeSet('newcount', snap(app.newcount)).catch(errToast);
function errToast(e) { console.error(e); toast('Save failed: ' + e, 5000); }

export async function boot() {
  const [docs, settings, newcount, annos, present] = await Promise.all([
    api.storeGet('docs'), api.storeGet('settings'), api.storeGet('newcount'), api.storePrefix('annos/'), api.booksPresent(),
  ]);
  app.docs = docs ? JSON.parse(docs) : {};
  app.settings = { ...DEFAULT_SETTINGS, ...(settings ? JSON.parse(settings) : {}) };
  app.newcount = newcount ? JSON.parse(newcount) : { day: '', n: 0 };
  const a = {};
  for (const [k, v] of Object.entries(annos)) a[k.slice('annos/'.length)] = JSON.parse(v);
  app.annos = a;
  app.present = Object.fromEntries(present.map((id) => [id, true]));
  setMacros(app.settings.macros);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  app.systemDark = mq.matches; mq.addEventListener('change', (e) => (app.systemDark = e.matches));
  app.ready = true;
}

// ---------------------------------------------------------------- docs
export const title = (d) => d?.title || d?.name || '';
const junkTitle = (t) => !t || t.length < 3 || /^(untitled|microsoft word|document\d*|\S+\.(docx?|tex|dvi|indd|pdf))/i.test(t);

export async function importPaths(paths, openAfter = false) {
  if (!paths?.length) return;
  toast(`Adding ${paths.length} file${paths.length === 1 ? '' : 's'}…`, 60000);
  let res;
  try { res = await api.importPdfs(paths); }
  catch (e) { toast('Import failed: ' + e, 5000); return; }
  let added = 0;
  for (const r of res) {
    const cur = app.docs[r.id];
    app.present[r.id] = true;
    if (cur) { cur.numPages = r.num_pages; continue; }
    app.docs[r.id] = {
      id: r.id, name: r.name, title: junkTitle(r.title) ? undefined : r.title,
      author: r.author && !/^(unknown|admin|user)$/i.test(r.author) ? r.author : undefined,
      numPages: r.num_pages, lastPage: 1, addedAt: Date.now(), bookmarks: [],
    };
    added++;
  }
  app.coverBust++;
  saveDocs();
  toast(res.length ? (added ? `Added ${added} book${added === 1 ? '' : 's'}` : 'Already in your library') : 'No PDF found');
  if (openAfter && res.length) openDoc(res[res.length - 1].id);
}

export async function openDoc(id) {
  if (!app.present[id]) { toast('PDF file missing — use “Locate file…” in the library'); return; }
  try {
    app.info = await api.info(id);
  } catch (e) { toast('Could not open: ' + e, 5000); return; }
  const d = app.docs[id];
  d.openedAt = Date.now(); d.numPages = app.info.num_pages; d.bookmarks ||= [];
  saveDocs();
  app.annos[id] ||= [];
  app.page = d.lastPage || 1;
  app.docId = id;
  app.view = 'reader';
}

export function closeDoc() { app.view = 'library'; app.docId = null; app.info = null; }

export async function removeDoc(id) {
  const d = app.docs[id], n = (app.annos[id] || []).length;
  if (!(await confirmBox(`Remove <b>${title(d)}</b> and its ${n} annotation${n === 1 ? '' : 's'}? This can't be undone without a backup.`))) return;
  await api.removeBook(id).catch(() => {});
  delete app.docs[id]; delete app.annos[id]; delete app.present[id];
  api.storeRemove('annos/' + id);
  saveDocs();
}

// ---------------------------------------------------------------- annotations
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export function makeAnno(docId, o) {
  return { id: uid(), docId, note: '', card: null, createdAt: Date.now(), updatedAt: Date.now(), ...o, page: Math.min(...o.rects.map((r) => r.p)) + 1 };
}
export function saveAnno(a) {
  a.updatedAt = Date.now();
  const list = (app.annos[a.docId] ||= []);
  const i = list.findIndex((x) => x.id === a.id);
  if (i >= 0) list[i] = a; else list.push(a);
  saveAnnos(a.docId);
  return list.find((x) => x.id === a.id);
}
export function deleteAnno(a) {
  app.annos[a.docId] = (app.annos[a.docId] || []).filter((x) => x.id !== a.id);
  saveAnnos(a.docId);
}
export const findAnno = (docId, id) => app.annos[docId]?.find((x) => x.id === id);

// ---------------------------------------------------------------- cards
export const allCards = () => Object.values(app.annos).flat().filter((a) => a.card);
export function newLeftToday() {
  const n = app.newcount.day === todayKey() ? app.newcount.n : 0;
  return Math.max(0, app.settings.newPerDay - n);
}
export function bumpNew(d) {
  if (app.newcount.day !== todayKey()) app.newcount = { day: todayKey(), n: 0 };
  app.newcount.n = Math.max(0, app.newcount.n + d); saveNew();
}
export function dueCount(docId) {
  const cards = allCards().filter((a) => !docId || a.docId === docId);
  const now = Date.now();
  return cards.filter((a) => isDue(a, now)).length + Math.min(cards.filter((a) => a.card.s.state === 'new').length, newLeftToday());
}

// ---------------------------------------------------------------- editor
export function openEditor(a, opt = {}) {
  if (!a) return;
  const card = a.card || (opt.card ? { hlSide: opt.side || app.settings.defaultSide, front: '', back: '' } : null);
  app.editor = {
    a: $state.snapshot(a), isNew: !!opt.isNew, color: a.color || 'yellow',
    side: card?.hlSide || opt.side || app.settings.defaultSide,
    cardOn: !!card, front: card?.front || '', back: card?.back || '',
    note: a.note || '', quote: a.text || '', cardTitle: opt.card,
  };
}
export function commitEditor() {
  const e = app.editor; if (!e) return;
  const a = e.a;
  if (a.kind !== 'area') a.text = e.quote.trim();
  a.note = e.note; a.color = e.color;
  if (e.cardOn) {
    const card = { ...(a.card || {}), hlSide: e.side, front: e.front, back: e.back };
    const has = (side) => card.hlSide === side || (side === 'front' ? e.front : e.back).trim();
    if (!has('front') || !has('back')) { toast('A card needs something on both the front and the back'); return false; }
    card.s ||= newSched();
    a.card = card;
  } else a.card = null;
  app.lastColor = e.color;
  const saved = saveAnno(a);
  if (app.review?.cur?.id === a.id) app.review.cur = saved;
  toast(a.card && e.isNew ? 'Card added' : 'Saved');
  app.editor = null;
  return true;
}

// ---------------------------------------------------------------- theme
export function resolvedTheme() {
  const t = app.settings.theme;
  return t === 'system' ? (app.systemDark ? 'dark' : 'light') : t;
}
