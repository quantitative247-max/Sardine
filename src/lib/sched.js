// Schedulers: SM-2 (Anki-style steps) and FSRS (v5 defaults; accepts FSRS-6 21-parameter sets).
export const MIN = 60e3, DAY = 864e5;

// ------------------------------------------------------------------ config
export const FSRS5_DEFAULT = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const cfg = { algo: 'sm2', retention: 0.9, maxIvl: 36500, w: FSRS5_DEFAULT };

export function parseWeights(str) {
  const nums = String(str || '').split(/[\s,\[\]]+/).filter(Boolean).map(Number);
  if ((nums.length === 19 || nums.length === 21) && nums.every(Number.isFinite)) return nums;
  return null;
}
export function setSchedConfig(settings) {
  cfg.algo = settings.algorithm === 'fsrs' ? 'fsrs' : 'sm2';
  cfg.retention = Math.min(0.99, Math.max(0.7, +settings.retention || 0.9));
  cfg.maxIvl = Math.max(1, +settings.maxIvl || 36500);
  cfg.w = parseWeights(settings.fsrsWeights) || FSRS5_DEFAULT;
}
export const schedConfig = () => cfg;

export const newSched = () => ({ state: 'new', due: Date.now(), ivl: 0, ease: 2.5, reps: 0, lapses: 0, step: 0 });

/** Grade a schedule with the configured algorithm. g: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export function grade(s0, g, now = Date.now()) {
  return cfg.algo === 'fsrs' ? gradeFSRS(s0, g, now) : gradeSM2(s0, g, now);
}

// ------------------------------------------------------------------ SM-2
const LEARN = [1 * MIN, 10 * MIN], RELEARN = [10 * MIN];
function gradeSM2(s0, g, now) {
  const s = { ...s0 };
  if (s.state === 'review') {
    const late = Math.max(0, (now - s.due) / DAY);
    if (g === 1) { s.lapses++; s.ease = Math.max(1.3, s.ease - 0.2); s.ivl = Math.max(1, Math.round(s.ivl * 0.5)); s.state = 'relearning'; s.step = 0; s.due = now + RELEARN[0]; }
    else {
      if (g === 2) { s.ease = Math.max(1.3, s.ease - 0.15); s.ivl = Math.max(s.ivl + 1, Math.round(s.ivl * 1.2)); }
      if (g === 3) { s.ivl = Math.max(s.ivl + 1, Math.round((s.ivl + late / 2) * s.ease)); }
      if (g === 4) { s.ivl = Math.max(s.ivl + 2, Math.round((s.ivl + late) * s.ease * 1.3)); s.ease += 0.15; }
      s.ivl = Math.min(s.ivl, cfg.maxIvl);
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
  // keep FSRS memory roughly in sync so switching later is smooth
  if (s.S != null) delete s.S, delete s.D;
  s.reps++; s.last = now;
  return s;
}

// ------------------------------------------------------------------ FSRS
const clampD = (d) => Math.min(10, Math.max(1, d));
function decayOf(w) { return w.length >= 21 ? -w[20] : -0.5; }
function factorOf(w) { const d = decayOf(w); return Math.pow(0.9, 1 / d) - 1; }
export function retrievability(elapsedDays, S, w = cfg.w) { return Math.pow(1 + (factorOf(w) * Math.max(0, elapsedDays)) / S, decayOf(w)); }
function nextIvl(S, w = cfg.w) {
  const d = decayOf(w), f = factorOf(w);
  const ivl = (S / f) * (Math.pow(cfg.retention, 1 / d) - 1);
  return Math.min(cfg.maxIvl, Math.max(1, Math.round(ivl)));
}
const D0 = (w, g) => w[4] - Math.exp(w[5] * (g - 1)) + 1;
function nextD(w, D, g) {
  const dp = D + (-w[6] * (g - 3)) * ((10 - D) / 9);
  return clampD(w[7] * D0(w, 4) + (1 - w[7]) * dp);
}
function recallS(w, D, S, R, g) {
  return S * (1 + Math.exp(w[8]) * (11 - D) * Math.pow(S, -w[9]) * (Math.exp(w[10] * (1 - R)) - 1) * (g === 2 ? w[15] : 1) * (g === 4 ? w[16] : 1));
}
function forgetS(w, D, S, R) {
  const sf = w[11] * Math.pow(D, -w[12]) * (Math.pow(S + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
  return Math.min(sf, S / Math.exp(w[17] * w[18]));
}
function shortS(w, S, g) {
  let inc = Math.exp(w[17] * (g - 3 + w[18]));
  if (w.length >= 21) { inc *= Math.pow(S, -w[19]); if (g >= 3) inc = Math.max(inc, 1); }
  return S * inc;
}

/** Estimate FSRS memory for a card that was scheduled by SM-2 and has no history. */
function seedMemory(s, w) {
  if (s.state === 'review') return { S: Math.max(0.5, s.ivl || 1), D: clampD(5 + (2.5 - (s.ease || 2.5)) * 4) };
  return { S: w[2], D: clampD(D0(w, 3)) };
}

/** Update only stability/difficulty (used for replaying history). */
export function fsrsMemory(mem, g, elapsedDays, w = cfg.w) {
  if (!mem) return { S: w[g - 1], D: clampD(D0(w, g)) };
  const { S, D } = mem;
  if (elapsedDays < 1) return { S: shortS(w, S, g), D: nextD(w, D, g) };
  const R = retrievability(elapsedDays, S, w);
  return { S: g === 1 ? forgetS(w, D, S, R) : recallS(w, D, S, R, g), D: nextD(w, D, g) };
}

function gradeFSRS(s0, g, now) {
  const w = cfg.w;
  const s = { ...s0 };
  const elapsed = s.last ? (now - s.last) / DAY : 0;
  const had = s.state !== 'new';
  let mem = s.S != null ? { S: s.S, D: s.D } : had ? seedMemory(s, w) : null;
  const m = fsrsMemory(mem, g, elapsed, w);
  s.S = m.S; s.D = m.D;

  const goReview = (ivl) => { s.state = 'review'; s.ivl = ivl; s.due = now + ivl * DAY; s.step = 0; };
  if (s.state === 'new' || s.state === 'learning') {
    s.state = 'learning';
    if (g === 1) { s.step = 0; s.due = now + 1 * MIN; }
    else if (g === 2) { s.due = now + (s0.state === 'new' ? 5 : 10) * MIN; }
    else if (g === 3) {
      if (s0.state === 'new' && s.step === 0) { s.step = 1; s.due = now + 10 * MIN; }
      else goReview(nextIvl(s.S));
    } else {
      // Easy graduates immediately, at least one day beyond what Good would give
      const goodS = fsrsMemory(mem, 3, elapsed, w).S;
      goReview(Math.max(nextIvl(s.S), nextIvl(goodS) + 1));
    }
  } else if (s.state === 'relearning') {
    if (g === 1) s.due = now + 5 * MIN;
    else if (g === 2) s.due = now + 10 * MIN;
    else goReview(nextIvl(s.S));
  } else {
    if (g === 1) { s.lapses = (s.lapses || 0) + 1; s.state = 'relearning'; s.step = 0; s.ivl = nextIvl(s.S); s.due = now + 5 * MIN; }
    else {
      // keep Hard ≤ Good < Easy
      const ivlFor = (gg) => nextIvl(fsrsMemory(mem, gg, elapsed, w).S);
      const hard = ivlFor(2), good = Math.max(ivlFor(3), hard + 1), easy = Math.max(ivlFor(4), good + 1);
      goReview(g === 2 ? Math.min(hard, good) : g === 3 ? good : easy);
    }
  }
  s.reps = (s.reps || 0) + 1; s.last = now;
  return s;
}

// ------------------------------------------------------------------ helpers
export const endOfDay = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return +d; };
export const todayKey = () => new Date().toDateString();
export const isLearning = (s) => s.state === 'learning' || s.state === 'relearning';
export function isDueS(s, now = Date.now()) {
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
