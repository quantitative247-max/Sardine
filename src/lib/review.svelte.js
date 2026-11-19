import { app, allCards, newLeftToday, bumpNew, saveAnno, findAnno, openDoc, ctl, title, logReview, logUndo } from './state.svelte.js';
import { grade, endOfDay, isLearning, MIN, DAY } from './sched.js';
import { variants, getS, setS } from './cards.js';

// Review items are [docId, annoId, variantKey]; a cloze with 3 groups is 3 items.
export function startReview(docId) {
  const ids = allCards().filter((a) => !docId || a.docId === docId).flatMap((a) => variants(a).map((v) => [a.docId, a.id, v.key]));
  app.review = { docId, ids, cur: null, key: null, shown: false, undo: [], done: 0, newLeft: newLeftToday(), away: false, shownAt: Date.now(), siblings: {} };
  nextCard();
}

function items() {
  const out = [];
  for (const [d, i, k] of app.review.ids) {
    const a = findAnno(d, i);
    const s = a?.card && getS(a, k);
    if (s) out.push({ a, k, s });
  }
  return out;
}

function pickNext() {
  const now = Date.now(), all = items(), r = app.review;
  const byDue = (x, y) => x.s.due - y.s.due;
  const learnNow = all.filter((x) => isLearning(x.s) && x.s.due <= now).sort(byDue);
  if (learnNow.length) return learnNow[0];
  // bury siblings: don't show another group of a cloze you just saw in this session
  const notSib = (x) => !r.siblings[x.a.id] || r.siblings[x.a.id] === x.k;
  const rev = all.filter((x) => x.s.state === 'review' && x.s.due <= endOfDay()).sort(byDue);
  const revPick = rev.find(notSib) || rev[0];
  if (revPick) return revPick;
  if (r.newLeft > 0) {
    const fresh = all.filter((x) => x.s.state === 'new').sort((x, y) => x.a.createdAt - y.a.createdAt || x.k.localeCompare(y.k));
    const p = fresh.find(notSib) || fresh[0];
    if (p) return p;
  }
  return all.filter((x) => isLearning(x.s) && x.s.due <= now + 20 * MIN).sort(byDue)[0] || null;
}

export function nextCard() {
  const r = app.review, p = pickNext();
  r.cur = p ? p.a : null; r.key = p ? p.k : null; r.shown = false; r.shownAt = Date.now();
  if (p) r.siblings[p.a.id] = p.k;
}

export function counts() {
  const now = Date.now(), all = items();
  return {
    n: Math.min(app.review.newLeft, all.filter((x) => x.s.state === 'new').length),
    l: all.filter((x) => isLearning(x.s) && x.s.due <= now + 20 * MIN).length,
    r: all.filter((x) => x.s.state === 'review' && x.s.due <= endOfDay()).length,
  };
}

export const curSched = () => (app.review?.cur ? getS(app.review.cur, app.review.key) : null);

export function answer(g) {
  const r = app.review, a = r.cur, k = r.key;
  if (!a || !r.shown) return;
  const now = Date.now();
  const prev = $state.snapshot(getS(a, k)), wasNew = prev.state === 'new';
  const next = grade(prev, g, now);
  setS(a, k, next);
  const entry = { t: now, d: a.docId, a: a.id, k, g, st: prev.state, ivl: +((next.due - now) / DAY).toFixed(4), ms: Math.min(60000, now - r.shownAt) };
  logReview(entry);
  r.undo.push({ docId: a.docId, id: a.id, k, prev, wasNew, entry });
  if (wasNew) { r.newLeft--; bumpNew(1); }
  r.done++;
  saveAnno(a);
  nextCard();
}

export function undo() {
  const r = app.review, u = r.undo.pop();
  if (!u) return;
  const a = findAnno(u.docId, u.id);
  if (!a) return;
  setS(a, u.k, u.prev); r.done--;
  if (u.wasNew) { r.newLeft++; bumpNew(-1); }
  logUndo(u.entry);
  saveAnno(a);
  r.cur = a; r.key = u.k; r.shown = true; r.shownAt = Date.now();
}

export function exitReview() { app.review = null; }

export async function openContext(a) {
  app.review.away = true;
  if (app.docId !== a.docId || app.view !== 'reader') await openDoc(a.docId);
  setTimeout(() => ctl.flashTo?.(a), 250);
}

export const docName = (id) => title(app.docs[id]);
