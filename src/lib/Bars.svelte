<script>
  // Minimal bar / stacked-bar / line chart. data: [{ label, values: number[] }]
  let { data = [], colors = ['var(--accent)'], type = 'bar', height = 150, fmt = (v) => String(v), names = [], max = null } = $props();
  let hover = $state(-1);
  const totals = $derived(data.map((d) => d.values.reduce((a, b) => a + (b || 0), 0)));
  const top = $derived(max ?? Math.max(1, ...(type === 'line' ? data.map((d) => d.values[0] ?? 0) : totals)));
  const pts = $derived(type === 'line'
    ? data.map((d, i) => d.values[0] == null ? null : `${data.length === 1 ? 50 : (i / (data.length - 1)) * 100},${100 - ((d.values[0] || 0) / top) * 100}`).filter(Boolean).join(' ')
    : '');
  const tip = $derived(hover >= 0 && data[hover] ? data[hover] : null);
</script>

<div class="chart" style="height:{height}px" role="img" onmouseleave={() => (hover = -1)}>
  <span class="ymax">{fmt(top)}</span>
  {#if type === 'line'}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={colors[0]} stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
    </svg>
    <div class="hit">
      {#each data as d, i}<div role="presentation" onmouseenter={() => (hover = i)} class:on={hover === i}></div>{/each}
    </div>
  {:else}
    <div class="bars">
      {#each data as d, i}
        <div class="col" role="presentation" onmouseenter={() => (hover = i)} class:on={hover === i}>
          <div class="stack" style="height:{(totals[i] / top) * 100}%">
            {#each d.values as v, j}{#if v}<div style="flex:{v};background:{colors[j % colors.length]}"></div>{/if}{/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
  <div class="base"></div>
  {#if data.length}
    <div class="xl"><span>{data[0].label}</span><span>{data[data.length - 1].label}</span></div>
  {/if}
  {#if tip}
    <div class="tip" style="left:{Math.min(80, Math.max(0, (hover / Math.max(1, data.length - 1)) * 100 - 10))}%">
      <b>{tip.label}</b>
      {#if tip.values.length > 1 && names.length}
        {#each tip.values as v, j}<div><i style="background:{colors[j]}"></i>{names[j]}: {fmt(v || 0)}</div>{/each}
      {:else}<div>{tip.values[0] == null ? '—' : fmt(tip.values[0])}</div>{/if}
    </div>
  {/if}
</div>

<style>
  .chart{position:relative;margin-top:14px;padding-bottom:18px}
  .ymax{position:absolute;top:-14px;right:0;font-size:10.5px;color:var(--faint)}
  svg{position:absolute;inset:0 0 18px 0;width:100%;height:calc(100% - 18px);overflow:visible}
  .hit,.bars{position:absolute;inset:0 0 18px 0;display:flex;align-items:flex-end;gap:2px}
  .hit div{flex:1;height:100%}
  .hit div.on{background:var(--hover)}
  .col{flex:1;height:100%;display:flex;align-items:flex-end;min-width:1px}
  .col.on{background:var(--hover)}
  .stack{width:100%;display:flex;flex-direction:column-reverse;border-radius:2px 2px 0 0;overflow:hidden;min-height:0}
  .stack div{min-height:1px}
  .base{position:absolute;left:0;right:0;bottom:18px;height:1px;background:var(--line)}
  .xl{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;font-size:10.5px;color:var(--faint)}
  .tip{position:absolute;top:-6px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:8px;padding:6px 9px;font-size:12px;pointer-events:none;z-index:3;white-space:nowrap}
  .tip i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}
</style>
