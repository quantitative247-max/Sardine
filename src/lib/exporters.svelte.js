// Anki / Mochi / Markdown / backup exporters.
import { save, open } from '@tauri-apps/plugin-dialog';
import { api } from './backend.js';
import { app, title, toast, saveDocs, saveAnnos, saveSettings } from './state.svelte.js';
import { esc, setMacros } from './md.js';

const tagOf = (name) => (name || 'pdf').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 60);
const csvCell = (s) => '"' + String(s).replace(/"/g, '""') + '"';

function toAnkiMath(t) {
  return (t || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, x) => `\\[${x}\\]`)
    .replace(/(\\\[[\s\S]*?\\\])|(\\begin\{([a-zA-Z]+\*?)\}[\s\S]*?\\end\{\3\})/g, (m, done, env) => (done ? m : `\\[${env}\\]`))
    .replace(/(^|[^\\$])\$(?=\S)((?:\\.|[^$\\\n])+?)\$(?!\d)/g, (_, p, x) => `${p}\\(${x}\\)`);
}
function ankiField(a, side) {
  const c = a.card, parts = [];
  const conv = (t) => esc(toAnkiMath(t)).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  if (c.hlSide === side) parts.push(a.kind === 'area' ? `<img src="${a.image}">` : `<blockquote>${conv(a.text)}</blockquote>`);
  const t = side === 'front' ? c.front : c.back;
  if (t.trim()) parts.push(conv(t));
  if (side === 'back' && a.note?.trim()) parts.push(`<div style="opacity:.7">${conv(a.note)}</div>`);
  return parts.join('<br>').replace(/[\t\r]/g, ' ');
}
function mochiField(a, side) {
  const c = a.card, parts = [];
  if (c.hlSide === side) parts.push(a.kind === 'area' ? `![snip p.${a.page}](${a.image})` : a.text.split('\n').map((l) => '> ' + l).join('\n'));
  const t = side === 'front' ? c.front : c.back;
  if (t.trim()) parts.push(t.replace(/\\\[([\s\S]+?)\\\]/g, '$$$$$1$$$$').replace(/\\\(([\s\S]+?)\\\)/g, '$$$1$$'));
  if (side === 'back' && a.note?.trim()) parts.push(a.note);
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
  if (fmt === 'anki') {
    const lines = ['#separator:tab', '#html:true', '#tags column:3', '#notetype:Basic'];
    for (const a of cards) lines.push([ankiField(a, 'front'), ankiField(a, 'back'), `${tagOf(title(app.docs[a.docId]))} p${a.page}`].join('\t'));
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
  const data = { app: 'margin', version: 3, exportedAt: new Date().toISOString(), settings: $state.snapshot(app.settings), docs, annotations: Object.values($state.snapshot(app.annos)).flat() };
  if (await saveAs(`margin-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'json', 'Margin backup')) toast('Backup saved');
}

/** Restore a backup — also accepts backups from the single-file HTML version. */
export async function restore() {
  const path = await open({ multiple: false, filters: [{ name: 'Margin backup', extensions: ['json'] }] });
  if (!path) return;
  try {
    const data = JSON.parse(await api.readTextFile(path));
    if (data.app !== 'margin') throw new Error('Not a Margin backup');
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
