// SM-2 scheduler with Anki-style learning steps.
export const MIN = 60e3, DAY = 864e5;
const LEARN = [1 * MIN, 10 * MIN], RELEARN = [10 * MIN];

export const newSched = () => ({ state: 'new', due: Date.now(), ivl: 0, ease: 2.5, reps: 0, lapses: 0, step: 0 });

export function grade(s0, g, now = Date.now()) {
  const s = { ...s0 };
  if (s.state === 'review') {
    const late = Math.max(0, (now - s.due) / DAY);
    if (g === 1) { s.lapses++; s.ease = Math.max(1.3, s.ease - 0.2); s.ivl = Math.max(1, Math.round(s.ivl * 0.5)); s.state = 'relearning'; s.step = 0; s.due = now + RELEARN[0]; }
    else {
      if (g === 2) { s.ease = Math.max(1.3, s.ease - 0.15); s.ivl = Math.max(s.ivl + 1, Math.round(s.ivl * 1.2)); }
      if (g === 3) { s.ivl = Math.max(s.ivl + 1, Math.round((s.ivl + late / 2) * s.ease)); }
      if (g === 4) { s.ivl = Math.max(s.ivl + 2, Math.round((s.ivl + late) * s.ease * 1.3)); s.ease += 0.15; }
      s.due = now + s.ivl * DAY;
    }
  } else {
    const relearn = s.state === 'relearning', steps = relearn ? RELEARN : LEARN;
    if (s.state === 'new') s.state = 'learning';
    if (g === 1) { s.step = 0; s.due = now + steps[0]; }
    else if (g === 2) { s.due = now + (s.step + 1 < steps.length ? (steps[s.step] + steps[s.step + 1]) / 2 : steps[s.step] * 1.5); }
    else if (g === 3) {
      s.step++;
      if (s.step >= steps.length) { s.state = 'review'; s.ivl = relearn ? Math.max(1, s.ivl) : 1; s.due = now + s.ivl * DAY; }
      else s.due = now + steps[s.step];
    } else { s.state = 'review'; s.ivl = relearn ? Math.max(2, s.ivl + 1) : 4; s.due = now + s.ivl * DAY; }
  }
  s.reps++; s.last = now;
  return s;
}

export const endOfDay = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return +d; };
export const todayKey = () => new Date().toDateString();
export const isLearning = (s) => s.state === 'learning' || s.state === 'relearning';

export function isDue(a, now = Date.now()) {
  const s = a.card?.s;
  if (!s) return false;
  if (s.state === 'review') return s.due <= endOfDay();
  if (isLearning(s)) return s.due <= now + 20 * MIN;
  return false;
}

export function fmtIvl(ms) {
  const m = ms / MIN;
  if (m < 60) return Math.max(1, Math.round(m)) + 'm';
  const h = m / 60; if (h < 24) return Math.round(h) + 'h';
  const d = h / 24; if (d < 30) return Math.round(d) + 'd';
  if (d < 365) return (d / 30).toFixed(d < 300 ? 1 : 0).replace(/\.0$/, '') + 'mo';
  return (d / 365).toFixed(1).replace(/\.0$/, '') + 'y';
}
