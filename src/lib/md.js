// Light markdown + LaTeX (KaTeX) rendering, shared by notes, cards and review.
import katex from 'katex';

export const COLORS = { yellow: '#ffd84d', green: '#8fe39a', blue: '#86c8ff', pink: '#ffa3d1' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let MACROS = {};
export function setMacros(src) { MACROS = parseMacros(src); }
export function parseMacros(src) {
  const m = {};
  for (const raw of (src || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%')) continue;
    let r = line.match(/^\\(?:re|provide)?newcommand\s*\{?\s*(\\[A-Za-z]+)\s*\}?\s*(?:\[\d\])?\s*\{([\s\S]*)\}\s*$/);
    if (r) { m[r[1]] = r[2]; continue; }
    r = line.match(/^(\\[A-Za-z]+)\s*[:=]\s*(.+)$/);
    if (r) m[r[1]] = r[2];
  }
  return m;
}

function tex(src, display) {
  try { return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', macros: { ...MACROS }, trust: false }); }
  catch (e) { return `<span class="texerr" title="${esc(e.message || e)}">${esc(src)}</span>`; }
}

export function md(src) {
  if (!src) return '';
  const math = [];
  const ph = (t, d) => (math.push(tex(t, d)), `\u0000${math.length - 1}\u0000`);
  let s = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => ph(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => ph(t, true))
    .replace(/\\begin\{([a-zA-Z]+\*?)\}[\s\S]*?\\end\{\1\}/g, (m) => ph(m, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => ph(t, false))
    .replace(/(^|[^\\$])\$(?=\S)((?:\\.|[^$\\\n])+?)\$(?!\d)/g, (_, pre, t) => pre + ph(t, false));
  s = esc(s)
    .replace(/\\\$/g, '$')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/^&gt; ?(.*)$/gm, '<span class="quoteBlock" style="display:block">$1</span>')
    .replace(/^[-*] (.*)$/gm, '• $1')
    .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => math[+i]);
}

export function quoteHTML(a) {
  if (a.kind === 'area') return `<img class="snipImg" src="${a.image}" alt="">`;
  return `<div class="quoteBlock md" style="--qc:${COLORS[a.color] || '#ccc'}">${md(a.text)}</div>`;
}

export function sideHTML(a, side) {
  const c = a.card, parts = [];
  if (c.hlSide === side) parts.push(quoteHTML(a));
  const t = side === 'front' ? c.front : c.back;
  if (t && t.trim()) parts.push(`<div class="md" style="${parts.length ? 'margin-top:12px' : ''}">${md(t)}</div>`);
  return parts.join('') || '<span class="muted">(empty)</span>';
}
