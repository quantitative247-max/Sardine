<script module>
  import { api } from './backend.js';
  import { esc } from './md.js';

  // Small LRU of text runs per page.
  const textCache = new Map();
  async function getRuns(id, index) {
    const k = id + ':' + index;
    if (textCache.has(k)) { const v = textCache.get(k); textCache.delete(k); textCache.set(k, v); return v; }
    const runs = await api.text(id, index);
    textCache.set(k, runs);
    if (textCache.size > 80) textCache.delete(textCache.keys().next().value);
    return runs;
  }
  let mctx;
  function buildText(node, runs, W, H) {
    mctx ||= document.createElement('canvas').getContext('2d');
    let html = '';
    for (const r of runs) {
      const fs = r.h * H;
      if (fs < 1 || !r.t) continue;
      mctx.font = `${fs}px sans-serif`;
      const mw = mctx.measureText(r.t).width || 1;
      html += `<span style="left:${(r.x * W).toFixed(1)}px;top:${(r.y * H).toFixed(1)}px;font-size:${fs.toFixed(2)}px;transform:scaleX(${((r.w * W) / mw).toFixed(4)})">${esc(r.t)}</span>${r.eol ? '<br>' : ' '}`;
    }
    node.innerHTML = html;
  }
</script>

<script>
  import { pageUrl } from './backend.js';
  import { COLORS } from './md.js';
  import Icon from './Icon.svelte';

  let { id, index, w, h, visible, annos, flashId, bookmarked, onmarker, observe } = $props();
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
  let retry = $state(0);
  let tl = $state();

  const src = $derived(visible ? pageUrl(id, index, Math.round(w * dpr), retry) : null);

  $effect(() => {
    if (!visible || !tl) return;
    const W = w, H = h, node = tl;
    let alive = true;
    getRuns(id, index).then((runs) => alive && buildText(node, runs, W, H)).catch((e) => console.warn('text', e));
    return () => { alive = false; node.innerHTML = ''; };
  });

  function retryLater() { setTimeout(() => { if (visible && retry < 8) retry++; }, 120 + retry * 120); }

  const shade = (hex) => { const n = parseInt(hex.slice(1), 16), f = (x) => Math.round(x * 0.7); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  const markers = $derived.by(() => {
    const used = [], out = [];
    for (const a of annos) {
      if (!(a.note?.trim() || a.card)) continue;
      let y = Math.min(...a.rects.filter((r) => r.p === index).map((r) => r.y)) * 100;
      while (used.some((u) => Math.abs(u - y) < 2.8)) y += 3;
      used.push(y); out.push({ a, y });
    }
    return out;
  });
</script>

<div class="page" class:bookmarked data-i={index} style="width:{w}px;height:{h}px" use:observe>
  {#if src}<img {src} alt="" draggable="false" onerror={retryLater} />{/if}
  <div class="hl-layer">
    {#each annos as a (a.id)}
      {#each a.rects.filter((r) => r.p === index) as r}
        <div class="hl" class:area={a.kind === 'area'} class:flash={flashId === a.id}
             style="left:{r.x * 100}%;top:{r.y * 100}%;width:{r.w * 100}%;height:{r.h * 100}%;background:{COLORS[a.color]};color:{COLORS[a.color]};border-color:{shade(COLORS[a.color])}"></div>
      {/each}
    {/each}
  </div>
  {#if visible}<div class="tl" bind:this={tl}></div>{/if}
  <div class="mk-layer">
    {#each markers as m (m.a.id)}
      <button class="marker" class:card={m.a.card} style="top:calc({m.y}% - 3px)" title={m.a.card ? 'Flashcard — click to edit' : 'Note — click to edit'} onclick={() => onmarker(m.a)}>
        <Icon name={m.a.card ? 'cards' : 'pen'} size={14} />
      </button>
    {/each}
  </div>
  <div class="ribbon"><Icon name="bookmark" size={22} fill="var(--accent)" style="color:var(--accent)" /></div>
  <div class="snip-layer"></div>
</div>

<style>
  .page{position:relative;margin:0 auto 16px;background:#fff;box-shadow:var(--page-shadow);filter:var(--page-filter)}
  img{position:absolute;inset:0;width:100%;height:100%;display:block;user-select:none;-webkit-user-drag:none}
  .hl-layer{position:absolute;inset:0;z-index:1;pointer-events:none;mix-blend-mode:var(--hl-blend)}
  .hl{position:absolute;border-radius:2px;opacity:var(--hl-op)}
  .hl.area{opacity:1;background:transparent!important;border:2px dashed;border-radius:3px}
  .hl.flash{animation:flash 1.4s ease-out 2}
  @keyframes flash{0%{opacity:1;box-shadow:0 0 0 4px currentColor}100%{opacity:var(--hl-op);box-shadow:0 0 0 0 transparent}}
  .tl{position:absolute;inset:0;z-index:2;overflow:hidden;line-height:1;user-select:text;-webkit-user-select:text}
  .tl :global(span){position:absolute;white-space:pre;color:transparent;transform-origin:0 0;font-family:sans-serif;cursor:text}
  .tl :global(br){user-select:text}
  .tl :global(::selection){background:rgba(47,124,246,.3)}
  .mk-layer{position:absolute;inset:0;z-index:3;pointer-events:none}
  .marker{pointer-events:auto;position:absolute;right:-34px;width:24px;height:24px;border-radius:7px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.12);color:var(--muted)}
  .marker.card{color:var(--accent)}
  .marker:hover{border-color:var(--accent)}
  .ribbon{position:absolute;top:-2px;right:18px;z-index:4;display:none}
  .bookmarked .ribbon{display:block}
  .snip-layer{position:absolute;inset:0;z-index:5;display:none;cursor:crosshair}
  :global(.snipping) .snip-layer{display:block}
</style>
