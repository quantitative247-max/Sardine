// Card variants: a basic card has one schedule ('b'); a cloze card has one per group.
//   {{text}}            → unnumbered: all hidden together on one card ('c0')
//   {{1::text}}         → group 1 ('c1'); {{2::…}} → group 2 …
//   {{1::text::hint}}   → shows the hint while hidden
import { newSched, isDueS } from './sched.js';

/** Parse clozes with brace-depth matching so LaTeX like {{\frac{a}{b}}} works. */
export function parseClozes(text) {
  const out = [];
  if (!text) return out;
  let i = 0;
  while ((i = text.indexOf('{{', i)) !== -1) {
    let depth = 0, j = i + 2, end = -1;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0 && text[j + 1] === '}') { end = j; break; }
        depth = Math.max(0, depth - 1);
      }
    }
    if (end < 0) break;
    let body = text.slice(i + 2, end), group = 0, hint = '';
    const m = body.match(/^(\d{1,2})::([\s\S]*)$/);
    if (m) { group = +m[1]; body = m[2]; }
    const hm = body.match(/^([\s\S]*?)::([^:{}]*)$/);
    if (hm && hm[1]) { body = hm[1]; hint = hm[2]; }
    out.push({ start: i, end: end + 2, group, body, hint });
    i = end + 2;
  }
  return out;
}

export function clozeKeys(text) {
  const keys = new Set(parseClozes(text).map((c) => 'c' + c.group));
  return [...keys].sort((a, b) => +a.slice(1) - +b.slice(1));
}

/** Make sure a cloze card has one schedule per group (keeping existing progress). */
export function syncCloze(card) {
  const keys = clozeKeys(card.text);
  const cs = { ...(card.cs || {}) };
  for (const k of keys) cs[k] ||= newSched();
  for (const k of Object.keys(cs)) if (!keys.includes(k)) delete cs[k];
  card.cs = cs;
  return keys.length;
}

/** All reviewable variants of an annotation: [{ key, s }] */
export function variants(a) {
  const c = a?.card;
  if (!c) return [];
  if (c.type === 'cloze') return Object.entries(c.cs || {}).map(([key, s]) => ({ key, s }));
  return c.s ? [{ key: 'b', s: c.s }] : [];
}
export const getS = (a, key) => (key === 'b' ? a.card.s : a.card.cs?.[key]);
export function setS(a, key, s) { if (key === 'b') a.card.s = s; else a.card.cs[key] = s; }
export const anyDue = (a, now = Date.now()) => variants(a).some((v) => isDueS(v.s, now));
export const keyLabel = (key) => (key === 'b' ? '' : key === 'c0' ? 'cloze' : 'cloze ' + key.slice(1));
