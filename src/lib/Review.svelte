<script>
  import Icon from './Icon.svelte';
  import { app, openEditor } from './state.svelte.js';
  import { cardHTML, md } from './md.js';
  import { getS, variants, keyLabel } from './cards.js';
  import { grade, fmtIvl, MIN } from './sched.js';
  import { answer, undo, exitReview, counts, openContext, docName, curSched } from './review.svelte.js';

  const r = $derived(app.review);
  const a = $derived(r?.cur);
  const k = $derived(r ? counts() : { n: 0, l: 0, r: 0 });
  const key = $derived(r?.key);
  const ivl = (g) => { const s = curSched(); return s ? fmtIvl(grade($state.snapshot(s), g).due - Date.now()) : ''; };
  const soon = $derived.by(() => {
    if (!r || a) return null;
    const all = r.ids.map(([d, i, k]) => { const x = app.annos[d]?.find((y) => y.id === i); return x?.card && getS(x, k); }).filter((s) => s && s.state !== 'new');
    return all.sort((x, y) => x.due - y.due)[0] || null;
  });
  const today = $derived.by(() => {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const es = app.revlog.filter((e) => e.t >= +t0);
    return { n: es.length, min: Math.round(es.reduce((s, e) => s + (e.ms || 0), 0) / 60000) };
  });

  function onKey(e) {
    if (!r || r.away || app.editor || app.dialog) return;
    const kk = e.key.toLowerCase();
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (a && !r.shown) r.shown = true; else if (r.shown) answer(3); }
    else if (/^[1-4]$/.test(e.key)) answer(+e.key);
    else if (kk === 'u' || (kk === 'z' && (e.ctrlKey || e.metaKey))) undo();
    else if (kk === 'e' && a) openEditor(a);
    else if (e.key === 'Escape') exitReview();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if r.away}
  <div class="back"><button class="btn primary" onclick={() => (r.away = false)}>← Back to review</button></div>
{:else}
  <div class="rev">
    <div class="top">
      <button class="ib" title="Done (Esc)" onclick={exitReview}><Icon name="x" /></button>
      <span class="ttl">{r.docId ? docName(r.docId) : 'All books'}</span>
      <span class="counts"><span class="n" title="New">{k.n}</span><span class="l" title="Learning">{k.l}</span><span class="r" title="Review">{k.r}</span></span>
      <span class="sp"></span>
      {#if r.undo.length}<button class="btn ghost" onclick={undo}>Undo (U)</button>{/if}
    </div>
    <div class="scroll">
      <div class="wrap">
        {#if !a}
          <div class="card done">
            <h2>{r.done ? 'Session complete' : 'Nothing due'}</h2>
            <div class="muted">
              {#if r.done}You reviewed {r.done} card{r.done === 1 ? '' : 's'}. {/if}
              Today: {today.n} review{today.n === 1 ? '' : 's'} in {today.min} min.
              {#if soon}Next card due in {fmtIvl(Math.max(MIN, soon.due - Date.now()))}.{:else if !r.ids.length}Turn on Flashcard mode while reading to make cards.{/if}
            </div>
            <div style="margin-top:20px"><button class="btn" onclick={exitReview}>Close</button></div>
          </div>
        {:else}
          <div class="card">
            {#if a.card.type === 'cloze'}
              <div>{@html cardHTML(a, key, r.shown ? 'back' : 'front')}</div>
            {:else}
              <div>{@html cardHTML(a, key, 'front')}</div>
            {/if}
            {#if r.shown}
              {#if a.card.type !== 'cloze'}<hr /><div>{@html cardHTML(a, key, 'back')}</div>{/if}
              {#if a.note?.trim()}<div class="md note">{@html md(a.note)}</div>{/if}
            {/if}
          </div>
          <div class="ctx">
            <span>{docName(a.docId)} · p. {a.page}{#if keyLabel(key)}&nbsp;· {keyLabel(key)}{/if}</span>
            <button class="link" onclick={() => openContext(a)}>Open in book</button>
            <button class="link" onclick={() => openEditor(a)}>Edit (E)</button>
          </div>
          <div class="grades">
            {#if r.shown}
              <button class="g1" onclick={() => answer(1)}>Again<small>{ivl(1)} · 1</small></button>
              <button class="g2" onclick={() => answer(2)}>Hard<small>{ivl(2)} · 2</small></button>
              <button class="g3" onclick={() => answer(3)}>Good<small>{ivl(3)} · 3</small></button>
              <button class="g4" onclick={() => answer(4)}>Easy<small>{ivl(4)} · 4</small></button>
            {:else}
              <button class="show" onclick={() => (r.shown = true)}>Show answer <span>· Space</span></button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .rev{position:fixed;inset:0;background:var(--viewer);z-index:40;display:flex;flex-direction:column}
  .top{height:54px;display:flex;align-items:center;gap:10px;padding:0 14px;background:var(--paper);border-bottom:1px solid var(--line)}
  .ttl{font-weight:600}
  .counts span{font-weight:700;margin-left:10px;font-variant-numeric:tabular-nums}
  .counts .n{color:#3b7be0}.counts .l{color:#d0503c}.counts .r{color:var(--green)}
  .scroll{flex:1;overflow:auto}
  .wrap{max-width:780px;margin:0 auto;padding:34px 18px 80px}
  .card{background:var(--card);border-radius:16px;border:1px solid var(--line);box-shadow:0 8px 24px rgba(0,0,0,.05);padding:30px 34px;font-size:17px;min-height:200px;user-select:text}
  .card :global(.quoteBlock){font-size:16px}
  .card :global(img){max-width:100%}
  .card :global(.cloze){background:var(--accent-soft);color:var(--accent);border-radius:5px;padding:0 6px;font-weight:600}
  .card :global(.cloze.shown){background:transparent;padding:0;border-bottom:2px solid var(--accent);border-radius:0;color:inherit}
  hr{border:0;border-top:1px solid var(--line);margin:24px 0}
  .note{margin-top:16px;font-size:14px;border-top:1px dashed var(--line);padding-top:10px;color:var(--muted)}
  .ctx{margin-top:12px;font-size:12.5px;display:flex;gap:12px;align-items:center;color:var(--muted);padding:0 4px}
  .link{color:var(--accent)} .link:hover{text-decoration:underline}
  .grades{display:flex;gap:10px;justify-content:center;margin-top:22px}
  .grades button{min-width:112px;border-radius:10px;padding:9px 12px;background:var(--card);border:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:1px;font-weight:600}
  .grades small{color:var(--muted);font-size:11.5px;font-weight:400}
  .g1{color:#d0503c}.g2{color:var(--warm)}.g3{color:var(--green)}.g4{color:#3b7be0}
  .grades button:hover{border-color:currentColor}
  .grades .show{min-width:240px;padding:11px;flex-direction:row;justify-content:center;gap:6px;background:var(--primary-bg);color:var(--primary-ink);border:0}
  .show span{opacity:.6;font-weight:400}
  .done{text-align:center;padding:60px 10px}
  .done h2{margin:0 0 8px;font-weight:600}
  .back{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:45}
</style>
