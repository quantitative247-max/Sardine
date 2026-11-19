<script>
  // Floating menu anchored to a rect; closes on outside click / Esc.
  let { anchor, align = 'right', onclose, children } = $props();
  let el = $state();
  let pos = $state({ left: -9999, top: -9999 });

  $effect(() => {
    if (!el || !anchor) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = align === 'right' ? anchor.right - w : anchor.left;
    let y = anchor.bottom + 6;
    if (y + h > innerHeight - 8) y = Math.max(8, anchor.top - h - 6);
    pos = { left: Math.max(8, Math.min(innerWidth - w - 8, x)), top: y };
  });

  function outside(e) { if (el && !el.contains(e.target)) onclose?.(); }
  function key(e) { if (e.key === 'Escape') { e.stopPropagation(); onclose?.(); } }
</script>

<svelte:window onmousedown={outside} onkeydowncapture={key} />
<div class="menu" bind:this={el} style="left:{pos.left}px;top:{pos.top}px">
  {@render children()}
</div>
