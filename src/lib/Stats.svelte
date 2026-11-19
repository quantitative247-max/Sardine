<script>
  import Icon from './Icon.svelte';
  import Bars from './Bars.svelte';
  import { app, allCards, title } from './state.svelte.js';
  import { variants } from './cards.js';
  import { DAY, isLearning, schedConfig } from './sched.js';
  import { startReview } from './review.svelte.js';

  let rangeKey = $state('30');
  let deck = $state('');
  let year = $state(new Date().getFullYear());

  const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 3 months'], ['365', 'Last year'], ['all', 'All time']];
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
  const today0 = dayStart(Date.now());
  const fmtDay = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const mins = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3600000 ? `${(ms / 60000).toFixed(ms < 600000 ? 1 : 0)} min` : `${(ms / 3600000).toFixed(1)} h`);
  const pct = (x) => (x == null || !isFinite(x) ? '—' : Math.round(x * 100) + '%');

  const logs = $derived(app.revlog.filter((e) => !deck || e.d === deck));
  const firstT = $derived(logs.length ? Math.min(...logs.map((e) => e.t)) : Date.now());
  const days = $derived(rangeKey === 'all' ? Math.max(7, Math.ceil((today0 - dayStart(firstT)) / DAY) + 1) : +rangeKey);
  const start = $derived(today0 - (days - 1) * DAY);
  const prevStart = $derived(start - days * DAY);
  const bucketDays = $derived(days <= 92 ? 1 : 7);
  const buckets = $derived.by(() => {
    const out = [];
    for (let t = start; t <= today0; t += bucketDays * DAY) out.push({ t, end: t + bucketDays * DAY, label: bucketDays === 1 ? fmtDay(t) : 'wk of ' + fmtDay(t) });
    return out;
  });
  const inRange = $derived(logs.filter((e) => e.t >= start));
  const inPrev = $derived(logs.filter((e) => e.t >= prevStart && e.t < start));
  const per = (list, f) => buckets.map((b) => f(list.filter((e) => e.t >= b.t && e.t < b.end)));

  // ---- summaries
  const learned = $derived(inRange.filter((e) => e.st === 'new').length);
  const learnedPrev = $derived(inPrev.filter((e) => e.st === 'new').length);
  const retention = (list) => { const r = list.filter((e) => e.st === 'review'); return r.length ? r.filter((e) => e.g > 1).length / r.length : null; };
  const time = (list) => list.reduce((s, e) => s + (e.ms || 0), 0);

  const learnedBars = $derived(per(inRange, (l) => [l.filter((e) => e.st === 'new').length]).map((v, i) => ({ label: buckets[i].label, values: v })));
  const cumBars = $derived.by(() => {
    const firsts = logs.filter((e) => e.st === 'new').map((e) => e.t).sort((a, b) => a - b);
    return buckets.map((b) => ({ label: b.label, values: [firsts.filter((t) => t < b.end).length] }));
  });
  const reviewBars = $derived(per(inRange, (l) => [
    l.filter((e) => e.st === 'new' || e.st === 'learning').length,
    l.filter((e) => e.st === 'review').length,
    l.filter((e) => e.st === 'relearning').length,
  ]).map((v, i) => ({ label: buckets[i].label, values: v })));
  const retBars = $derived(per(inRange, (l) => [retention(l)]).map((v, i) => ({ label: buckets[i].label, values: v })));
  const timeBars = $derived(per(inRange, (l) => [time(l)]).map((v, i) => ({ label: buckets[i].label, values: v })));
  const buttons = $derived([1, 2, 3, 4].map((g) => inRange.filter((e) => e.g === g).length));

  // ---- current card state
  const cardVs = $derived(allCards().filter((a) => !deck || a.docId === deck).flatMap((a) => variants(a).map((v) => ({ ...v, a }))));
  const counts = $derived({
    new: cardVs.filter((v) => v.s.state === 'new').length,
    learning: cardVs.filter((v) => isLearning(v.s)).length,
    young: cardVs.filter((v) => v.s.state === 'review' && v.s.ivl < 21).length,
    mature: cardVs.filter((v) => v.s.state === 'review' && v.s.ivl >= 21).length,
  });
  const total = $derived(cardVs.length);
  const forecastDays = $derived(Math.min(Math.max(days, 14), 90));
  const forecast = $derived.by(() => {
    const out = [];
    for (let i = 0; i < forecastDays; i++) {
      const t0 = today0 + i * DAY, t1 = t0 + DAY;
      const due = cardVs.filter((v) => v.s.state !== 'new' && (i === 0 ? v.s.due < t1 : v.s.due >= t0 && v.s.due < t1));
      out.push({ label: i === 0 ? 'Today' : fmtDay(t0), values: [due.filter((v) => v.s.state === 'review').length, due.filter((v) => isLearning(v.s)).length] });
    }
    return out;
  });
  const forecastTotal = $derived(forecast.reduce((s, d) => s + d.values[0] + d.values[1], 0));
  const IVL_BUCKETS = [[1, 1, '1d'], [2, 3, '2–3d'], [4, 7, '4–7d'], [8, 14, '1–2w'], [15, 30, '2–4w'], [31, 60, '1–2mo'], [61, 120, '2–4mo'], [121, 240, '4–8mo'], [241, 365, '8–12mo'], [366, 1e9, '1y+']];
  const ivlBars = $derived(IVL_BUCKETS.map(([lo, hi, label]) => ({ label, values: [cardVs.filter((v) => v.s.state === 'review' && v.s.ivl >= lo && v.s.ivl <= hi).length] })));
  const avgIvl = $derived.by(() => { const r = cardVs.filter((v) => v.s.state === 'review'); return r.length ? r.reduce((s, v) => s + v.s.ivl, 0) / r.length : 0; });
  const progress = $derived(Object.values(app.docs).map((d) => {
    const vs = (app.annos[d.id] || []).flatMap(variants);
    return { d, n: vs.length, started: vs.filter((v) => v.s.state !== 'new').length, mature: vs.filter((v) => v.s.state === 'review' && v.s.ivl >= 21).length };
  }).filter((x) => x.n).sort((a, b) => b.n - a.n));

  // ---- heatmap
  const years = $derived([...new Set([new Date().getFullYear(), ...logs.map((e) => new Date(e.t).getFullYear())])].sort());
  const heat = $derived.by(() => {
    const byDay = new Map();
    for (const e of logs) { const k = dayStart(e.t); byDay.set(k, (byDay.get(k) || 0) + 1); }
    const jan1 = new Date(year, 0, 1), dec31 = new Date(year, 11, 31);
    const first = new Date(jan1); first.setDate(first.getDate() - first.getDay());
    const weeks = [], months = [];
    let yearTotal = 0, active = 0;
    for (let w = 0, d = new Date(first); d <= dec31; w++) {
      const col = [];
      for (let i = 0; i < 7; i++, d.setDate(d.getDate() + 1)) {
        const inYear = d.getFullYear() === year, t = +d, n = byDay.get(dayStart(t)) || 0;
        if (inYear) { yearTotal += n; if (n) active++; if (d.getDate() === 1) months.push({ w, label: d.toLocaleDateString([], { month: 'short' }) }); }
        col.push(inYear ? { t, n, future: t > Date.now() } : null);
      }
      weeks.push(col);
    }
    const nz = [...byDay.values()].sort((a, b) => a - b);
    const q = (p) => nz[Math.floor(p * (nz.length - 1))] || 1;
    const levels = [q(0.25), q(0.5), q(0.75)];
    // streak: consecutive days ending today (or yesterday)
    let streak = 0, t = today0;
    if (!byDay.get(t)) t -= DAY;
    while (byDay.get(t)) { streak++; t -= DAY; }
    let best = 0, run = 0;
    for (const k of [...byDay.keys()].sort((a, b) => a - b)) { run = byDay.has(k - DAY) ? run + 1 : 1; best = Math.max(best, run); }
    return { weeks, months, yearTotal, active, levels, streak, best, allDays: byDay.size };
  });
  const level = (n) => (!n ? 0 : n <= heat.levels[0] ? 1 : n <= heat.levels[1] ? 2 : n <= heat.levels[2] ? 3 : 4);
  let hoverDay = $state(null);

  const todayLogs = $derived(logs.filter((e) => e.t >= today0));
  const C = { learn: '#3b7be0', review: 'var(--green)', relearn: '#d0503c', time: '#9a6be0', fc: 'var(--accent)' };

  function key(e) { if (e.key === 'Escape' && !app.review) { e.stopImmediatePropagation(); app.stats = false; } }
</script>

<svelte:window onkeydowncapture={key} />

<div class="stats">
  <div class="top">
    <button class="ib" title="Close (Esc)" onclick={() => (app.stats = false)}><Icon name="x" /></button>
    <span class="ttl">Statistics</span>
    <select class="ed sel" bind:value={rangeKey}>{#each RANGES as [v, l]}<option value={v}>{l}</option>{/each}</select>
    <span class="muted range">{fmtDay(start)} → {fmtDay(today0)}{bucketDays > 1 ? ' · weekly' : ' · daily'}</span>
    <span class="sp"></span>
    <span class="muted small">Scheduler: <b>{schedConfig().algo === 'fsrs' ? `FSRS · ${Math.round(schedConfig().retention * 100)}% retention` : 'SM-2'}</b></span>
    <select class="ed sel" bind:value={deck}>
      <option value="">All books</option>
      {#each Object.values(app.docs) as d}<option value={d.id}>{title(d)}</option>{/each}
    </select>
  </div>

  <div class="scroll">
    <div class="wrap">
      <div class="heatHead">
        <select class="ed sel" bind:value={year}>{#each years as y}<option value={y}>{y}</option>{/each}</select>
        <span><b>{heat.yearTotal}</b> reviews in {year} · <b>{heat.active}</b> active days · streak <b>{heat.streak}</b> day{heat.streak === 1 ? '' : 's'} (best {heat.best})</span>
        <span class="sp"></span>
        <span class="muted small">Today: <b>{todayLogs.length}</b> reviews in {mins(todayLogs.reduce((s, e) => s + (e.ms || 0), 0))}</span>
        <button class="btn primary" style="padding:5px 12px" onclick={() => { app.stats = false; startReview(deck || null); }}>Review now</button>
      </div>
      <div class="heat">
        <div class="days"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
        <div class="grid-wrap">
          <div class="months">{#each heat.months as m}<span style="left:{m.w * 15}px">{m.label}</span>{/each}</div>
          <div class="hgrid" role="presentation" onmouseleave={() => (hoverDay = null)}>
            {#each heat.weeks as col}
              <div class="wk">
                {#each col as c}
                  {#if c}<div class="cell l{level(c.n)}" class:future={c.future} role="presentation" onmouseenter={() => (hoverDay = c)}></div>{:else}<div class="cell blank"></div>{/if}
                {/each}
              </div>
            {/each}
          </div>
        </div>
      </div>
      <div class="legend">
        <span>{#if hoverDay}{new Date(hoverDay.t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}: <b>{hoverDay.n}</b> review{hoverDay.n === 1 ? '' : 's'}{:else}&nbsp;{/if}</span>
        <span class="sp"></span>Less <i class="cell l0"></i><i class="cell l1"></i><i class="cell l2"></i><i class="cell l3"></i><i class="cell l4"></i> More
      </div>

      <div class="panels">
        <section>
          <h3>Cards learned</h3>
          <div class="big">{learned} <small>{learnedPrev} previous period</small></div>
          <Bars data={learnedBars} colors={[C.learn]} />
        </section>
        <section>
          <h3>Cards learned (cumulative)</h3>
          <div class="big">{cumBars.at(-1)?.values[0] ?? 0} <small>first reviews</small></div>
          <Bars data={cumBars} type="line" colors={[C.learn]} />
        </section>
        <section>
          <h3>Reviews</h3>
          <div class="big">{inRange.length} <small>{inPrev.length} previous period · {(inRange.length / days).toFixed(1)}/day</small></div>
          <Bars data={reviewBars} colors={[C.learn, C.review, C.relearn]} names={['Learning', 'Review', 'Relearning']} />
        </section>
        <section>
          <h3>Retention rate</h3>
          <div class="big">{pct(retention(inRange))} <small>{pct(retention(inPrev))} previous period</small></div>
          <Bars data={retBars} type="line" colors={[C.review]} max={1} fmt={(v) => pct(v)} />
          <div class="note">Share of mature reviews (not learning) answered Hard, Good or Easy.</div>
        </section>
        <section>
          <h3>Review time</h3>
          <div class="big">{mins(time(inRange))} <small>{mins(time(inPrev))} previous period</small></div>
          <Bars data={timeBars} colors={[C.time]} fmt={mins} />
        </section>
        <section>
          <h3>Review forecast</h3>
          <div class="big">{forecastTotal} <small>next {forecastDays} days · {forecast[0]?.values[0] + forecast[0]?.values[1] || 0} due today</small></div>
          <Bars data={forecast} colors={[C.review, C.learn]} names={['Review', 'Learning']} />
        </section>
        <section>
          <h3>Intervals</h3>
          <div class="big">{counts.young + counts.mature} <small>cards in review · average {avgIvl < 30 ? avgIvl.toFixed(1) + ' d' : (avgIvl / 30).toFixed(1) + ' mo'}</small></div>
          <Bars data={ivlBars} colors={[C.fc]} />
        </section>
        <section>
          <h3>Answer buttons</h3>
          <div class="big">{inRange.length ? pct(buttons[0] / inRange.length) : '—'} <small>Again rate</small></div>
          <div class="btnRows">
            {#each [['Again', '#d0503c'], ['Hard', 'var(--warm)'], ['Good', 'var(--green)'], ['Easy', '#3b7be0']] as [n, c], i}
              <div class="br"><span>{n}</span><div class="track"><div style="width:{inRange.length ? (buttons[i] / inRange.length) * 100 : 0}%;background:{c}"></div></div><b>{buttons[i]}</b></div>
            {/each}
          </div>
        </section>
        <section>
          <h3>Card counts</h3>
          <div class="big">{total} <small>cards</small></div>
          <div class="seg-bar">
            {#each [['new', '#3b7be0'], ['learning', '#d0503c'], ['young', '#7cc58f'], ['mature', 'var(--green)']] as [k, c]}
              {#if counts[k]}<div style="flex:{counts[k]};background:{c}" title="{k}: {counts[k]}"></div>{/if}
            {/each}
          </div>
          <div class="legend2">
            {#each [['New', 'new', '#3b7be0'], ['Learning', 'learning', '#d0503c'], ['Young', 'young', '#7cc58f'], ['Mature (21d+)', 'mature', 'var(--green)']] as [l, k, c]}
              <span><i style="background:{c}"></i>{l} <b>{counts[k]}</b></span>
            {/each}
          </div>
        </section>
        <section class="wide">
          <h3>Book progress</h3>
          {#if !progress.length}<div class="note">No cards yet.</div>{/if}
          {#each progress as p}
            <div class="prog">
              <div class="pt"><Icon name="book" size={16} /><span>{title(p.d)}</span><span class="sp"></span><span class="muted small">{p.started}/{p.n} started · {p.mature} mature</span></div>
              <div class="track"><div style="width:{(p.started / p.n) * 100}%;background:#7cc58f"></div><div style="width:{(p.mature / p.n) * 100}%;background:var(--green);position:absolute;left:0;top:0;bottom:0"></div></div>
            </div>
          {/each}
        </section>
      </div>
    </div>
  </div>
</div>

<style>
  .stats{position:fixed;inset:0;background:var(--lib);z-index:35;display:flex;flex-direction:column}
  .top{height:54px;display:flex;align-items:center;gap:10px;padding:0 14px;background:var(--paper);border-bottom:1px solid var(--line)}
  .ttl{font-weight:600;margin-right:6px}
  .sel{width:auto;padding:5px 8px;font-size:13px;font-family:inherit}
  .range,.small{font-size:12.5px}
  .scroll{flex:1;overflow:auto}
  .wrap{max-width:1240px;margin:0 auto;padding:20px 22px 60px}
  .heatHead{display:flex;align-items:center;gap:12px;margin-bottom:12px;font-size:13.5px}
  .heat{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
  .days{display:grid;grid-template-rows:20px repeat(7,15px);font-size:10.5px;color:var(--muted);text-align:right}
  .days span{line-height:13px}
  .grid-wrap{position:relative;padding-top:20px}
  .months{position:absolute;top:0;left:0;right:0;height:16px;font-size:11px;color:var(--muted)}
  .months span{position:absolute}
  .hgrid{display:flex;gap:2px}
  .wk{display:grid;grid-template-rows:repeat(7,13px);gap:2px}
  .cell{width:13px;height:13px;border-radius:3px;display:inline-block}
  .cell.blank{background:transparent}
  .l0{background:color-mix(in srgb,var(--ink) 7%,transparent)}
  .l1{background:color-mix(in srgb,var(--green) 35%,transparent)}
  .l2{background:color-mix(in srgb,var(--green) 55%,transparent)}
  .l3{background:color-mix(in srgb,var(--green) 78%,transparent)}
  .l4{background:var(--green)}
  .cell.future{opacity:.45}
  .legend{display:flex;align-items:center;gap:4px;font-size:11.5px;color:var(--muted);margin:6px 0 22px}
  .legend i{width:11px;height:11px}
  .panels{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
  section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  section.wide{grid-column:1/-1}
  h3{margin:0;font-size:14.5px;font-weight:600}
  .big{font-size:26px;font-weight:300;margin-top:4px;font-variant-numeric:tabular-nums}
  .big small{font-size:12.5px;color:var(--muted);font-weight:400;margin-left:6px}
  .note{font-size:11.5px;color:var(--faint);margin-top:4px}
  .btnRows{margin-top:14px;display:flex;flex-direction:column;gap:9px}
  .br{display:grid;grid-template-columns:44px 1fr 40px;align-items:center;gap:8px;font-size:12.5px}
  .br b{text-align:right;font-variant-numeric:tabular-nums}
  .track{height:7px;border-radius:4px;background:var(--input);overflow:hidden;position:relative}
  .track>div{height:100%}
  .seg-bar{display:flex;height:12px;border-radius:6px;overflow:hidden;margin-top:16px;background:var(--input)}
  .legend2{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:12.5px;color:var(--muted)}
  .legend2 i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
  .legend2 b{color:var(--ink);margin-left:3px}
  .prog{margin-top:12px}
  .pt{display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:6px}
</style>
