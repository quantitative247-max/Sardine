// Anki / Mochi / Markdown / backup exporters.
import { save, open } from '@tauri-apps/plugin-dialog';
import { api } from './backend.js';
import { app, title, toast, saveDocs, saveAnnos, saveSettings } from './state.svelte.js';
import { esc, setMacros } from './md.js';
import { parseClozes } from './cards.js';

const tagOf = (name) => (name || 'pdf').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 60);
const csvCell = (s) => '"' + String(s).replace(/"/g, '""') + '"';

function toAnkiMath(t) {
  return (t || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, x) => `\\[${x}\\]`)
    .replace(/(\\\[[\s\S]*?\\\])|(\\begin\{([a-zA-Z]+\*?)\}[\s\S]*?\\end\{\3\})/g, (m, done, env) => (done ? m : `\\[${env}\\]`))
    .replace(/(^|[^\\$])\$(?=\S)((?:\\.|[^$\\\n])+?)\$(?!\d)/g, (_, p, x) => `${p}\\(${x}\\)`);
}
// media/<file> → data: URL, filled in before exporting
let MEDIA = {};
async function loadMedia(cards) {
  MEDIA = {};
  const names = new Set();
  const scan = (t) => { for (const m of String(t || '').matchAll(/\]\(media\/([A-Za-z0-9.]+)\)/g)) names.add(m[1]); };
  for (const a of cards) { const c = a.card; [c.front, c.back, c.text, c.extra, a.note].forEach(scan); }
  for (const n of names) { try { MEDIA[n] = await api.mediaDataUrl(n); } catch {} }
}
const mediaSrc = (src) => (src.startsWith('media/') ? MEDIA[src.slice(6)] || '' : src);
const imgsToHtml = (t) => t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `\u0003${mediaSrc(src)}\u0003`);
const imgsToMd = (t) => t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `![${alt}](${mediaSrc(src)})`);
const conv = (t) => esc(toAnkiMath(imgsToHtml(t || ''))).replace(/\u0003([^\u0003]*)\u0003/g, '<img src="$1">').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

/** Mochi-style cloze → Anki cloze: {{2::x::hint}} → {{c2::x::hint}}; unnumbered → one shared number. */
function toAnkiCloze(text) {
  const cl = parseClozes(text);
  const used = cl.map((c) => c.group).filter(Boolean);
  const zero = (used.length ? Math.max(...used) : 0) + 1;
  let out = '', last = 0;
  for (const c of cl) {
    out += text.slice(last, c.start) + `{{c${c.group || zero}::${c.body}${c.hint ? '::' + c.hint : ''}}}`;
    last = c.end;
  }
  return out + text.slice(last);
}

function ankiField(a, side) {
  const c = a.card, parts = [];
  if (c.hlSide === side) parts.push(a.kind === 'area' ? `<img src="${a.image}">` : `<blockquote>${conv(a.text)}</blockquote>`);
  const t = side === 'front' ? c.front : c.back;
  if (t.trim()) parts.push(conv(t));
  if (side === 'back' && a.note?.trim()) parts.push(`<div style="opacity:.7">${conv(a.note)}</div>`);
  return parts.join('<br>').replace(/[\t\r]/g, ' ');
}
function mochiField(a, side) {
  const c = a.card, parts = [];
  if (c.type === 'cloze') return imgsToMd(side === 'front' ? c.text : [c.extra, a.note].filter((x) => x?.trim()).join('\n\n'));
  if (c.hlSide === side) parts.push(a.kind === 'area' ? `![snip p.${a.page}](${a.image})` : a.text.split('\n').map((l) => '> ' + l).join('\n'));
  const t = side === 'front' ? c.front : c.back;
  if (t.trim()) parts.push(imgsToMd(t).replace(/\\\[([\s\S]+?)\\\]/g, '$$$$$1$$$$').replace(/\\\(([\s\S]+?)\\\)/g, '$$$1$$'));
  if (side === 'back' && a.note?.trim()) parts.push(imgsToMd(a.note));
  return parts.join('\n\n');
}

async function saveAs(defaultPath, contents, ext, label) {
  const path = await save({ defaultPath, filters: [{ name: label, extensions: [ext] }] });
  if (!path) return false;
  await api.saveTextFile(path, contents);
  return true;
}

export async function exportCards(fmt, docId) {
  const cards = Object.values(app.annos).flat().filter((a) => a.card && (!docId || a.docId === docId));
  cards.sort((a, b) => (a.docId > b.docId) - (a.docId < b.docId) || a.page - b.page);
  if (!cards.length) return toast('No cards to export');
  const base = docId ? tagOf(title(app.docs[docId])) : 'margin-all';
  let ok;
  await loadMedia(cards);
  if (fmt === 'anki') {
    // column 1 picks the note type per row: Basic (Front/Back) or Cloze (Text/Back Extra)
    const lines = ['#separator:tab', '#html:true', '#notetype column:1', '#tags column:4'];
    const clean = (h) => h.replace(/[\t\r]/g, ' ');
    for (const a of cards) {
      const tags = `${tagOf(title(app.docs[a.docId]))} p${a.page}`;
      if (a.card.type === 'cloze') {
        const extra = [a.card.extra, a.note].filter((x) => x?.trim()).map(conv).join('<br>');
        lines.push(['Cloze', clean(conv(toAnkiCloze(a.card.text))), clean(extra), tags].join('\t'));
      } else lines.push(['Basic', ankiField(a, 'front'), ankiField(a, 'back'), tags].join('\t'));
    }
    ok = await saveAs(base + '-anki.txt', lines.join('\n'), 'txt', 'Anki text');
  } else {
    ok = await saveAs(base + '-mochi.csv', ['Front,Back', ...cards.map((a) => csvCell(mochiField(a, 'front')) + ',' + csvCell(mochiField(a, 'back')))].join('\r\n'), 'csv', 'CSV');
  }
  if (ok) toast(`Exported ${cards.length} cards for ${fmt === 'anki' ? 'Anki' : 'Mochi'}`);
}

export async function exportMarkdown(docId) {
  const d = app.docs[docId];
  let out = `# ${title(d)}\n\n`;
  for (const a of (app.annos[docId] || []).slice().sort((x, y) => x.page - y.page || x.rects[0].y - y.rects[0].y)) {
    out += `## p. ${a.page}\n\n` + (a.kind === 'area' ? `![snip](${a.image})` : a.text.split('\n').map((l) => '> ' + l).join('\n')) + '\n\n';
    if (a.note?.trim()) out += a.note + '\n\n';
    if (a.card) out += `**Card** — Q: ${a.card.front || '(highlight)'}  \nA: ${a.card.back || '(highlight)'}\n\n`;
  }
  if (await saveAs(tagOf(title(d)) + '-notes.md', out, 'md', 'Markdown')) toast('Notes exported');
}

export async function backup() {
  const docs = Object.values($state.snapshot(app.docs));
  const data = { app: 'sardine', version: 3, exportedAt: new Date().toISOString(), settings: $state.snapshot(app.settings), docs, annotations: Object.values($state.snapshot(app.annos)).flat() };
  if (await saveAs(`sardine-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'json', 'Sardine backup')) toast('Backup saved');
}

/** Restore a backup — also accepts backups from the single-file HTML version. */
export async function restore() {
  const path = await open({ multiple: false, filters: [{ name: 'Sardine backup', extensions: ['json'] }] });
  if (!path) return;
  try {
    const data = JSON.parse(await api.readTextFile(path));
    if (data.app !== 'sardine' && data.app !== 'margin') throw new Error('Not a Sardine backup');
    for (const d of data.docs || []) {
      const { cover, ...meta } = d;
      const cur = app.docs[meta.id];
      if (!cur) app.docs[meta.id] = { ...meta, bookmarks: meta.bookmarks || [] };
      else if (meta.bookmarks?.length) cur.bookmarks = [...new Map([...(cur.bookmarks || []), ...meta.bookmarks].map((b) => [b.page, b])).values()];
    }
    let n = 0;
    const touched = new Set();
    for (const a of data.annotations || []) {
      const list = (app.annos[a.docId] ||= []);
      const i = list.findIndex((x) => x.id === a.id);
      if (i < 0) list.push(a); else if ((a.updatedAt || 0) > (list[i].updatedAt || 0)) list[i] = a; else continue;
      n++; touched.add(a.docId);
    }
    if (data.settings) { Object.assign(app.settings, data.settings); setMacros(app.settings.macros); saveSettings(); }
    saveDocs(); touched.forEach(saveAnnos);
    const missing = (data.docs || []).filter((d) => !app.present[d.id]).length;
    toast(`Restored ${n} annotations.${missing ? ` ${missing} book${missing === 1 ? '' : 's'} need their PDF — use “Locate file…”.` : ''}`, 5000);
  } catch (e) { toast('Restore failed: ' + (e.message || e), 5000); }
}
