<script>
  import Icon from './Icon.svelte';
  import { app, ctl, title, saveSettings, saveDocs, openEditor, deleteAnno, confirmBox } from './state.svelte.js';
  import { md, COLORS } from './md.js';
  import { isDue, fmtIvl } from './sched.js';
  import { coverUrl } from './backend.js';
  import { startReview } from './review.svelte.js';

  let { onclose } = $props();
  let searching = $state(false);
  let query = $state('');
  let filter = $state('all');
  let openIds = $state({});
  let bodyEl = $state();

  const doc = $derived(app.docs[app.docId]);
  const tab = $derived(app.settings.sideTab || 'toc');
  const setTab = (t) => { app.settings.sideTab = t; saveSettings(); };

  // ---- outline: give every node a stable id + depth
  const toc = $derived.by(() => {
    let n = 0;
    const walk = (nodes, depth) => nodes.map((x) => ({ id: 't' + n++, title: x.title, page: x.page, depth, kids: walk(x.kids || [], depth + 1) }));
    return walk(app.info?.outline || [], 0);
  });
  const path = $derived.by(() => {
    const out = []; let level = toc;
    while (level.length) {
      let best = null;
      for (const nd of level) if (nd.page != null && nd.page <= app.page) best = nd;
      if (!best) break;
      out.push(best); level = best.kids;
    }
    return out;
  });
  const leaf = $derived(path[path.length - 1]);
  const isOpen = (nd) => openIds[nd.id] ?? (path.includes(nd) && nd !== leaf);
  const q = $derived(query.trim().toLowerCase());
  const match = (nd) => !q || nd.title.toLowerCase().includes(q) || nd.kids.some(match);

  let scrolledOnce = false;
  $effect(() => {
    if (tab !== 'toc' || !bodyEl || scrolledOnce || !leaf) return;
    scrolledOnce = true;
    queueMicrotask(() => bodyEl.querySelector('.here')?.scrollIntoView({ block: 'center' }));
  });

  // ---- annotations
  const annos = $derived((app.annos[app.docId] || []).slice().sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y));
  const nCards = $derived(annos.filter((a) => a.card).length);
  const items = $derived(annos
    .filter((a) => filter === 'all' || (filter === 'notes' ? a.note?.trim() : a.card))
    .filter((a) => !q || [a.text, a.note, a.card?.front, a.card?.back].some((t) => t?.toLowerCase().includes(q))));
  function chip(a) {
    if (!a.card) return '';
    const s = a.card.s, now = Date.now();
    return s.state === 'new' ? ['card', 'card · new'] : isDue(a, now) ? ['due', 'card · due'] : ['card', 'card · ' + fmtIvl(s.due - now)];
  }
  async function del(a) { if (await confirmBox('Delete this annotation' + (a.card ? ' and its flashcard' : '') + '?')) deleteAnno(a); }

  // ---- bookmarks
  const bms = $derived((doc?.bookmarks || []).slice().sort((a, b) => a.page - b.page));
  function secOf(page) {
    let level = toc, best = null;
    while (level.length) { let b = null; for (const nd of level) if (nd.page != null && nd.page <= page) b = nd; if (!b) break; best = b; level = b.kids; }
    return best?.title;
  }
  function rmBm(p) { doc.bookmarks = doc.bookmarks.filter((b) => b.page !== p); saveDocs(); }
</script>

<aside class="side">
  <div class="sideTop">
    <button class="ib" title="Hide sidebar (T)" onclick={onclose}><Icon name="sidebar" /></button>
    <span class="sp"></span>
    <button class="ib" class:on={searching} title="Filter" onclick={() => { searching = !searching; if (!searching) query = ''; }}><Icon name="search" /></button>
  </div>
  <div class="bookCard">
    <div class="cv"><img src="{coverUrl(app.docId)}?v={app.coverBust}" alt="" onerror={(e) => (e.currentTarget.style.visibility = 'hidden')} /></div>
    <div style="min-width:0"><div class="tt">{title(doc)}</div><div class="au">{doc?.author || ''}</div></div>
  </div>
  {#if searching}
    <div class="sSearch"><Icon name="search" size={16} /><!-- svelte-ignore a11y_autofocus --><input autofocus placeholder="Filter…" bind:value={query} /></div>
  {/if}

  <div class="sBody" bind:this={bodyEl}>
    {#if tab === 'toc'}
      {#if !toc.length}
        <div class="empty">This PDF has no table of contents.<br /><br />Use the page bar below, or bookmarks (<kbd>B</kbd>).</div>
      {:else}
        {#snippet node(nd)}
          {#if match(nd)}
            {@const open = isOpen(nd) || (q && nd.kids.some(match))}
            <div class="row" class:open style="--d:{nd.depth}" role="button" tabindex="-1"
                 onclick={() => nd.page && ctl.goToPage?.(nd.page)} onkeydown={() => {}}>
              {#if nd.kids.length}
                <button class="car" aria-label="Expand" onclick={(e) => { e.stopPropagation(); openIds[nd.id] = !open; }}><Icon name="caret" size={12} /></button>
              {:else}<span class="car"></span>{/if}
              <span class="nm">{nd.title}</span><span class="pg">{nd.page ?? ''}</span>
            </div>
            {#if nd === leaf && !q}
              <div class="row here" style="--d:{nd.depth + (open && nd.kids.length ? 1 : 0)}">
                <span class="car"></span><span class="nm"><Icon name="book" size={18} />Current position</span><span class="pg">{app.page}</span>
              </div>
            {/if}
            {#if open}{#each nd.kids as k (k.id)}{@render node(k)}{/each}{/if}
          {/if}
        {/snippet}
        {#each toc as nd (nd.id)}{@render node(nd)}{/each}
      {/if}
    {:else if tab === 'notes'}
      <div class="nHead">
        <div class="seg">
          <button class:on={filter === 'all'} onclick={() => (filter = 'all')}>All {annos.length}</button>
          <button class:on={filter === 'notes'} onclick={() => (filter = 'notes')}>Notes</button>
          <button class:on={filter === 'cards'} onclick={() => (filter = 'cards')}>Cards {nCards}</button>
        </div>
        <span class="sp"></span>
        {#if nCards}<button class="btn ghost" style="padding:4px 8px;font-size:12.5px" onclick={() => startReview(app.docId)}>Review</button>{/if}
      </div>
      {#if !items.length}
        <div class="empty">{#if annos.length}Nothing matches.{:else}Select text to highlight it, or press <kbd>S</kbd> to snip an equation.<br /><br />Turn on <b>Flashcard mode</b> (top right) to make a card from every selection.{/if}</div>
      {/if}
      {#each items as a (a.id)}
        {@const c = chip(a)}
        <div class="anno" style="--c:{COLORS[a.color]}" role="button" tabindex="-1" onclick={() => ctl.flashTo?.(a)} ondblclick={() => openEditor(a)} onkeydown={() => {}}>
          <div class="meta">p. {a.page} {#if c}<span class="chip {c[0]}">{c[1]}</span>{/if}</div>
          <div class="quote">{#if a.kind === 'area'}<img src={a.image} alt="" />{:else}<div class="md">{@html md(a.text)}</div>{/if}</div>
          {#if a.note?.trim()}<div class="note md">{@html md(a.note)}</div>{/if}
          {#if a.card && (a.card.front.trim() || a.card.back.trim())}
            <div class="note md" style="font-size:12.5px">
              {#if a.card.front.trim()}<b>Q</b> {@html md(a.card.front)}{/if}
              {#if a.card.back.trim()}{#if a.card.front.trim()}<br />{/if}<b>A</b> {@html md(a.card.back)}{/if}
            </div>
          {/if}
          <div class="acts">
            <button onclick={(e) => { e.stopPropagation(); openEditor(a); }}>Edit</button>
            <button title="Delete" onclick={(e) => { e.stopPropagation(); del(a); }}>✕</button>
          </div>
        </div>
      {/each}
    {:else}
      {#if !bms.length}<div class="empty">No bookmarks yet.<br />Press the bookmark icon or <kbd>B</kbd>.</div>{/if}
      {#each bms as b (b.page)}
        <div class="bm" role="button" tabindex="-1" onclick={() => ctl.goToPage?.(b.page)} onkeydown={() => {}}>
          <Icon name="bookmark" fill="var(--accent)" style="color:var(--accent)" />
          <div style="min-width:0"><div style="font-weight:500">Page {b.page}</div>{#if secOf(b.page)}<div class="muted sec">{secOf(b.page)}</div>{/if}</div>
          <button class="x" title="Remove" onclick={(e) => { e.stopPropagation(); rmBm(b.page); }}>✕</button>
        </div>
      {/each}
    {/if}
  </div>

  <div class="tabs">
    <button class:on={tab === 'toc'} title="Contents" onclick={() => setTab('toc')}><Icon name="list" /></button>
    <button class:on={tab === 'notes'} title="Annotations & cards" onclick={() => setTab('notes')}><Icon name="pen" /></button>
    <button class:on={tab === 'bookmarks'} title="Bookmarks" onclick={() => setTab('bookmarks')}><Icon name="bookmark" /></button>
  </div>
</aside>

<style>
  .side{width:300px;background:var(--side);display:flex;flex-direction:column;flex:none;border-right:1px solid var(--line);min-width:0}
  .sideTop{display:flex;align-items:center;padding:8px 10px 4px 12px}
  .bookCard{display:flex;align-items:center;gap:12px;padding:10px 14px 14px;border-bottom:1px solid var(--line);box-shadow:0 6px 8px -8px rgba(0,0,0,.15)}
  .cv{width:42px;height:60px;border-radius:2px;overflow:hidden;flex:none;box-shadow:0 1px 3px rgba(0,0,0,.25);background:var(--input)}
  .cv img{width:100%;height:100%;object-fit:cover;display:block}
  .tt{font-weight:600;font-size:16px;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical}
  .au{color:var(--muted);font-size:13.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sSearch{margin:8px 12px 0;display:flex;align-items:center;gap:8px;background:var(--input);border-radius:8px;padding:0 10px;height:32px;color:var(--muted)}
  .sSearch input{flex:1;border:0;background:transparent;outline:none;min-width:0;color:var(--ink)}
  .sBody{flex:1;overflow:auto;padding:8px 10px}
  .tabs{display:flex;padding:8px 8px 10px;gap:4px;border-top:1px solid var(--line)}
  .tabs button{flex:1;height:44px;border-radius:9px;display:flex;align-items:center;justify-content:center;opacity:.8}
  .tabs button:hover{background:var(--hover)}
  .tabs button.on{background:var(--active);opacity:1}
  .row{display:flex;align-items:center;gap:6px;min-height:44px;padding:4px 10px 4px calc(10px + var(--d,0)*16px);border-radius:8px;cursor:pointer;font-size:15px}
  .row:hover{background:var(--hover)}
  .car{width:16px;height:16px;flex:none;display:flex;align-items:center;justify-content:center;transition:transform .15s;opacity:.8}
  .row.open>.car{transform:rotate(90deg)}
  .nm{flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;line-height:1.3}
  .pg{color:var(--faint);font-size:13.5px;flex:none;font-variant-numeric:tabular-nums}
  .here{background:var(--active);cursor:default}
  .here .nm{display:flex;align-items:center;gap:8px}
  .empty{color:var(--muted);text-align:center;padding:36px 14px;font-size:13.5px}
  .nHead{display:flex;align-items:center;gap:6px;margin:2px 2px 10px}
  .anno{background:var(--card);border-radius:10px;padding:10px 12px 10px 14px;margin-bottom:8px;cursor:pointer;position:relative;box-shadow:0 1px 2px rgba(0,0,0,.06)}
  .anno::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:2px;background:var(--c,#ccc)}
  .anno:hover{box-shadow:0 0 0 1px var(--line)}
  .meta{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted);margin-bottom:4px}
  .quote{font-size:13.5px;max-height:7.5em;overflow:hidden}
  .quote img{max-width:100%;max-height:110px;display:block;filter:var(--page-filter)}
  .note{margin-top:6px;font-size:13px;border-top:1px dashed var(--line);padding-top:6px}
  .acts{position:absolute;top:6px;right:6px;display:none;gap:2px;background:var(--card)}
  .anno:hover .acts{display:flex}
  .acts button{border-radius:5px;padding:2px 7px;font-size:12px;color:var(--muted)}
  .acts button:hover{background:var(--hover)}
  .bm{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer}
  .bm:hover{background:var(--hover)}
  .sec{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .x{margin-left:auto;opacity:0;color:var(--muted);border-radius:5px;padding:0 6px}
  .bm:hover .x{opacity:1}
</style>
