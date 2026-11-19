import { app, allCards, newLeftToday, bumpNew, saveAnno, findAnno, openDoc, ctl, title } from './state.svelte.js';
import { grade, endOfDay, isLearning, MIN } from './sched.js';

export function startReview(docId) {
  const ids = allCards().filter((a) => !docId || a.docId === docId).map((a) => [a.docId, a.id]);
  app.review = { docId, ids, cur: null, shown: false, undo: [], done: 0, newLeft: newLeftToday(), away: false };
  nextCard();
}

const cards = () => app.review.ids.map(([d, i]) => findAnno(d, i)).filter((a) => a?.card);

function pickNext() {
  const now = Date.now(), c = cards();
  const byDue = (x, y) => x.card.s.due - y.card.s.due;
  const learnNow = c.filter((a) => isLearning(a.card.s) && a.card.s.due <= now).sort(byDue);
  if (learnNow.length) return learnNow[0];
  const rev = c.filter((a) => a.card.s.state === 'review' && a.card.s.due <= endOfDay()).sort(byDue);
  if (rev.length) return rev[0];
  if (app.review.newLeft > 0) {
    const fresh = c.filter((a) => a.card.s.state === 'new').sort((a, b) => a.createdAt - b.createdAt);
    if (fresh.length) return fresh[0];
  }
  return c.filter((a) => isLearning(a.card.s) && a.card.s.due <= now + 20 * MIN).sort(byDue)[0] || null;
}

export function nextCard() { app.review.cur = pickNext(); app.review.shown = false; }

export function counts() {
  const now = Date.now(), c = cards();
  return {
    n: Math.min(app.review.newLeft, c.filter((x) => x.card.s.state === 'new').length),
    l: c.filter((x) => isLearning(x.card.s) && x.card.s.due <= now + 20 * MIN).length,
    r: c.filter((x) => x.card.s.state === 'review' && x.card.s.due <= endOfDay()).length,
  };
}

export function answer(g) {
  const r = app.review, a = r.cur;
  if (!a || !r.shown) return;
  const prev = $state.snapshot(a.card.s), wasNew = prev.state === 'new';
  r.undo.push({ docId: a.docId, id: a.id, prev, wasNew });
  a.card.s = grade(prev, g);
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
  a.card.s = u.prev; r.done--;
  if (u.wasNew) { r.newLeft++; bumpNew(-1); }
  saveAnno(a);
  r.cur = a; r.shown = true;
}

export function exitReview() { app.review = null; }

export async function openContext(a) {
  app.review.away = true;
  if (app.docId !== a.docId || app.view !== 'reader') await openDoc(a.docId);
  setTimeout(() => ctl.flashTo?.(a), 250);
}

export const docName = (id) => title(app.docs[id]);
