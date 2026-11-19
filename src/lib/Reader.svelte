<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import PdfPage from './PdfPage.svelte';
  import Sidebar from './Sidebar.svelte';
  import MainMenu from './MainMenu.svelte';
  import { app, ctl, title, saveDocs, saveSettings, closeDoc, makeAnno, saveAnno, openEditor, toast, dueCount, resolvedTheme } from './state.svelte.js';
  import { api } from './backend.js';
  import { startReview } from './review.svelte.js';

  const doc = $derived(app.docs[app.docId]);
  const sizes = $derived(app.info?.sizes || []);
  const N = $derived(sizes.length);

  let scale = $state(app.docs[app.docId]?.scale || 1.3);
  let visible = $state({});
  let tool = $state('select');
  let pending = $state(null);         // { text, rects, anchor }
  let pop = $state(null);             // { x, y }
  let hist = $state([]), fut = $state([]);
  let flashId = $state(null);
  let menuAnchor = $state(null);
  let editingPage = $state(false);
  let sliderVal = $state(1), sliding = $state(false);
  let viewer = $state(), pagesEl = $state();
  let scrolled = $state(false);

  const due = $derived(dueCount());
  const annosByPage = $derived.by(() => {
    const m = {};
    for (const a of app.annos[app.docId] || []) for (const p of new Set(a.rects.map((r) => r.p))) (m[p] ||= []).push(a);
    return m;
  });
  const bmSet = $derived(new Set((doc?.bookmarks || []).map((b) => b.page)));
  const cardMode = $derived(app.settings.cardMode);

  // ------------------------------------------------ visibility
  let io;
  function observe(node) {
    io?.observe(node);
    return { destroy: () => io?.unobserve(node) };
  }
  onMount(() => {
    const vis = {};
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const i = +en.target.dataset.i;
        if (en.isIntersecting) vis[i] = true; else delete vis[i];
      }
      visible = { ...vis };
    }, { root: viewer, rootMargin: '1200px 0px' });
    pagesEl.querySelectorAll('.page').forEach((n) => io.observe(n));
    ctl.goToPage = goToPage; ctl.flashTo = flashTo;
    tick().then(() => { goToPage(app.page || 1, 0, false); viewer.focus({ preventScroll: true }); });
    return () => { io.disconnect(); ctl.goToPage = ctl.flashTo = null; };
  });

  // ------------------------------------------------ navigation
  const pageEls = () => pagesEl?.children || [];
  function currentPage() {
    const els = pageEls(); if (!els.length) return 1;
    const mid = viewer.scrollTop + viewer.clientHeight * 0.35;
    let lo = 0, hi = els.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (els[m].offsetTop <= mid) lo = m; else hi = m - 1; }
    return lo + 1;
  }
  function goToPage(n, yFrac = 0, pushHist = true) {
    n = Math.min(N, Math.max(1, n | 0));
    const el = pageEls()[n - 1]; if (!el) return;
    if (pushHist) { const c = currentPage(); if (c !== n) { hist = [...hist.slice(-99), c]; fut = []; } }
    viewer.scrollTop = el.offsetTop + yFrac * el.offsetHeight - (yFrac ? viewer.clientHeight / 3 : 12);
    onScroll();
  }
  function histMove(dir) {
    const from = dir < 0 ? hist : fut; if (!from.length) return;
    const target = from[from.length - 1], c = currentPage();
    if (dir < 0) { hist = hist.slice(0, -1); fut = [...fut, c]; } else { fut = fut.slice(0, -1); hist = [...hist, c]; }
    goToPage(target, 0, false);
  }
  let saveT, raf;
  function onScroll() {
    pop = null;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const n = currentPage();
      scrolled = viewer.scrollTop > 4;
      if (!sliding) sliderVal = n;
      if (app.page !== n) {
        app.page = n;
        if (doc) { doc.lastPage = n; clearTimeout(saveT); saveT = setTimeout(saveDocs, 800); }
      }
    });
  }
  function flashTo(a) {
    const r = a.rects[0];
    goToPage(r.p + 1, r.y || 0.001);
    flashId = null;
    setTimeout(() => (flashId = a.id), 30);
    setTimeout(() => { if (flashId === a.id) flashId = null; }, 3000);
  }

  // ------------------------------------------------ zoom
  function setScale(s) {
    const n = currentPage(), el = pageEls()[n - 1];
    const f = el ? (viewer.scrollTop - el.offsetTop) / el.offsetHeight : 0;
    scale = Math.min(5, Math.max(0.4, s));
    if (doc) { doc.scale = scale; saveDocs(); }
    tick().then(() => { const e2 = pageEls()[n - 1]; if (e2) viewer.scrollTop = e2.offsetTop + f * e2.offsetHeight; });
  }
  const fitWidth = () => sizes[0] && setScale((viewer.clientWidth - 110) / sizes[0][0]);
  const zoom = (d) => (d === 0 ? fitWidth() : setScale(scale * (d > 0 ? 1.15 : 1 / 1.15)));

  // ------------------------------------------------ bookmarks, tools, modes
  function toggleBookmark(p = currentPage()) {
    const had = bmSet.has(p);
    doc.bookmarks = had ? doc.bookmarks.filter((b) => b.page !== p) : [...(doc.bookmarks || []), { page: p, at: Date.now() }];
    saveDocs(); toast(had ? `Bookmark removed · p. ${p}` : `Bookmarked p. ${p}`);
  }
  function setTool(t) {
    tool = t; pop = null;
    if (t === 'snip') { getSelection().removeAllRanges(); toast('Drag a box around an equation or figure'); }
  }
  function setCardMode(on) {
    app.settings.cardMode = on; saveSettings();
    toast(on ? 'Flashcard mode on — selections become cards (front or back)' : 'Flashcard mode off');
  }
  const setSide = (open) => { app.settings.sideOpen = open; saveSettings(); };
  function toggleDark() {
    app.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; saveSettings();
  }

  // ------------------------------------------------ selection → highlight
  function mergeRects(rs) {
    rs = rs.slice().sort((a, b) => a.p - b.p || a.y - b.y || a.x - b.x);
    const out = [];
    for (const r of rs) {
      const o = out.find((o) => o.p === r.p && Math.abs(o.y + o.h / 2 - (r.y + r.h / 2)) < Math.min(o.h, r.h) * 0.5 && r.x <= o.x + o.w + 0.012 && r.x + r.w >= o.x - 0.012);
      if (o) { const x1 = Math.min(o.x, r.x), y1 = Math.min(o.y, r.y), x2 = Math.max(o.x + o.w, r.x + r.w), y2 = Math.max(o.y + o.h, r.y + r.h); Object.assign(o, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }); }
      else out.push({ ...r });
    }
    return out.map((r) => ({ p: r.p, x: +r.x.toFixed(5), y: +r.y.toFixed(5), w: +r.w.toFixed(5), h: +r.h.toFixed(5) }));
  }
  function selectionInfo() {
    const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!pagesEl.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString().replace(/­/g, '').replace(/-\s*\n\s*(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!text) return null;
    const boxes = [...pageEls()].filter((el) => visible[+el.dataset.i]).map((el) => ({ i: +el.dataset.i, b: el.getBoundingClientRect() }));
    const raw = [];
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      const hit = boxes.find(({ b }) => cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom);
      if (!hit) continue;
      const { i, b } = hit;
      if (cr.height > b.height * 0.15 || (cr.width > b.width * 0.97 && cr.height > b.height * 0.05)) continue;
      raw.push({ p: i, x: (cr.left - b.left) / b.width, y: (cr.top - b.top) / b.height, w: cr.width / b.width, h: cr.height / b.height });
    }
    const rects = mergeRects(raw);
    if (!rects.length) return null;
    const last = [...range.getClientRects()].filter((r) => r.width > 0).pop() || range.getBoundingClientRect();
    return { text, rects, anchor: { left: last.left, right: last.right, top: last.top, bottom: last.bottom } };
  }
  function onMouseUp(e) {
    if (tool !== 'select' || e.button !== 0) return;
    setTimeout(() => {
      const info = selectionInfo();
      if (!info) {
        pop = null;
        const pg = e.target.closest?.('.page');
        if (pg && getSelection().isCollapsed) {
          const i = +pg.dataset.i, b = pg.getBoundingClientRect();
          const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
          const a = (annosByPage[i] || []).find((a) => a.rects.some((r) => r.p === i && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h));
          if (a) openEditor(a);
        }
        return;
      }
      pending = info;
      const r = info.anchor, w = cardMode ? 300 : 330, h = 40;
      const x = Math.min(innerWidth - w - 8, Math.max(8, r.right - w / 2));
      let y = r.bottom + 8; if (y + h > innerHeight - 66) y = r.top - h - 8;
      pop = { x, y };
    }, 0);
  }
  async function popAction(act, color) {
    const info = pending; if (!info) return;
    if (act === 'copy') { try { await navigator.clipboard.writeText(info.text); toast('Copied'); } catch { toast('Copy blocked'); } return; }
    const a = makeAnno(app.docId, { kind: 'text', text: info.text, rects: info.rects, color: color || app.lastColor || 'yellow' });
    pop = null; pending = null; getSelection().removeAllRanges();
    if (color) { app.lastColor = color; saveAnno(a); toast('Highlighted'); return; }
    if (act === 'as-front' || act === 'as-back') return openEditor(a, { isNew: true, card: true, side: act === 'as-front' ? 'front' : 'back' });
    openEditor(a, { isNew: true, card: act === 'card' });
  }

  // ------------------------------------------------ snip
  let snipBox = $state(null);
  function onMouseDown(e) {
    const layer = e.target.closest?.('.snip-layer'); if (!layer || e.button !== 0) return;
    e.preventDefault();
    const pg = layer.closest('.page'), i = +pg.dataset.i, b = pg.getBoundingClientRect();
    const x0 = e.clientX - b.left, y0 = e.clientY - b.top;
    const move = (ev) => {
      const x = Math.max(0, Math.min(b.width, ev.clientX - b.left)), y = Math.max(0, Math.min(b.height, ev.clientY - b.top));
      snipBox = { left: b.left + Math.min(x, x0), top: b.top + Math.min(y, y0), w: Math.abs(x - x0), h: Math.abs(y - y0), rx: Math.min(x, x0), ry: Math.min(y, y0) };
    };
    const up = async () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      const s = snipBox; snipBox = null;
      if (!s || s.w < 8 || s.h < 8) return;
      const rect = [s.rx / b.width, s.ry / b.height, s.w / b.width, s.h / b.height];
      setTool('select');
      try {
        const image = await api.snip(app.docId, i, rect, Math.round(b.width * 3));
        const a = makeAnno(app.docId, { kind: 'area', text: '', image, color: app.lastColor || 'blue', rects: [{ p: i, x: rect[0], y: rect[1], w: rect[2], h: rect[3] }] });
        openEditor(a, { isNew: true, card: true });
      } catch (err) { toast('Snip failed: ' + err); }
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  // ------------------------------------------------ keyboard
  function onKey(e) {
    if (app.editor || app.dialog || (app.review && !app.review.away) || menuAnchor) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (pop && pending && !e.ctrlKey && !e.metaKey) {
      const act = cardMode ? { f: 'as-front', b: 'as-back', n: 'note', h: 'hl' }[k] : { n: 'note', c: 'card' }[k];
      const col = !cardMode ? { 1: 'yellow', 2: 'green', 3: 'blue', 4: 'pink' }[k] : act === 'hl' ? 'yellow' : null;
      if (act || col) { e.preventDefault(); popAction(act === 'hl' ? null : act, col); return; }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoom(1); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoom(-1); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); zoom(0); return; }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); histMove(-1); return; }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); histMove(1); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 's') setTool(tool === 'snip' ? 'select' : 'snip');
    else if (k === 'v') setTool('select');
    else if (k === 'f') setCardMode(!cardMode);
    else if (k === 'r') startReview(null);
    else if (k === 'b') toggleBookmark();
    else if (k === 't') setSide(!app.settings.sideOpen);
    else if (k === 'd') toggleDark();
    else if (e.key === 'Escape') { setTool('select'); pop = null; getSelection().removeAllRanges(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goToPage(currentPage() + 1, 0, false); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goToPage(currentPage() - 1, 0, false); }
    else if (e.key === 'Home') { e.preventDefault(); goToPage(1); }
    else if (e.key === 'End') { e.preventDefault(); goToPage(N); }
  }
  const anchorOf = (e) => e.currentTarget.getBoundingClientRect();
</script>

<svelte:window onkeydown={onKey} onresize={() => (pop = null)} />

<div class="reader" class:snipping={tool === 'snip'}>
  {#if app.settings.sideOpen}<Sidebar onclose={() => setSide(false)} />{/if}

  <div class="col">
    <div class="top" class:scrolled>
      {#if !app.settings.sideOpen}<button class="ib" title="Sidebar (T)" onclick={() => setSide(true)}><Icon name="sidebar" /></button>{/if}
      <button class="ib" title="Library" onclick={closeDoc}><Icon name="library" /></button>
      <button class="ib" class:on={bmSet.has(app.page)} title="Bookmark this page (B)" onclick={() => toggleBookmark()}>
        <Icon name="bookmark" fill={bmSet.has(app.page) ? 'var(--accent)' : 'none'} style={bmSet.has(app.page) ? 'color:var(--accent)' : ''} />
      </button>
      <span class="vsep"></span>
      <button class="ib" class:on={tool === 'select'} title="Highlight text (V)" onclick={() => setTool('select')}><Icon name="highlighter" /></button>
      <button class="ib" class:on={tool === 'snip'} title="Snip a region — equations, figures (S)" onclick={() => setTool(tool === 'snip' ? 'select' : 'snip')}><Icon name="crop" /></button>
      <div class="title">{title(doc)}</div>
      <span class="sp"></span>
      <button class="mode" class:on={cardMode} title="Flashcard mode: selecting text makes cards (F)" onclick={() => setCardMode(!cardMode)}>
        <Icon name="cards" size={18} /><span class="tx">Flashcard mode</span><span class="sw"></span>
      </button>
      <button class="ib" title="Review due cards (R)" onclick={() => startReview(null)}>
        <Icon name="review" />{#if due}<span class="dot">{due > 99 ? '99+' : due}</span>{/if}
      </button>
      <button class="ib" title="Dark mode (D)" onclick={toggleDark}><Icon name={resolvedTheme() === 'dark' ? 'sun' : 'moon'} /></button>
      <button class="ib" title="Menu" onclick={(e) => (menuAnchor = anchorOf(e))}><Icon name="menu" /></button>
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
    <div class="viewer" bind:this={viewer} tabindex="0" onscroll={onScroll} onmouseup={onMouseUp} onmousedown={onMouseDown}>
      <div class="pages" bind:this={pagesEl}>
        {#each sizes as sz, i (i)}
          <PdfPage id={app.docId} index={i} w={Math.floor(sz[0] * scale)} h={Math.floor(sz[1] * scale)}
                   visible={!!visible[i]} annos={annosByPage[i] || []} {flashId} bookmarked={bmSet.has(i + 1)}
                   onmarker={(a) => openEditor(a)} {observe} />
        {/each}
      </div>
    </div>

    <div class="bot">
      <button class="ib" title="First page (Home)" onclick={() => goToPage(1)}><Icon name="chevs-left" /></button>
      <button class="ib" title="Previous page (←)" onclick={() => goToPage(currentPage() - 1, 0, false)}><Icon name="chev-left" /></button>
      <button class="ib" title="Back (Alt ←)" disabled={!hist.length} onclick={() => histMove(-1)}><Icon name="undo" /></button>
      <button class="ib" title="Forward (Alt →)" disabled={!fut.length} onclick={() => histMove(1)}><Icon name="redo" /></button>
      {#if editingPage}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="pageEdit" autofocus value={app.page} onblur={() => (editingPage = false)}
               onkeydown={(e) => { if (e.key === 'Enter') { goToPage(+e.currentTarget.value); editingPage = false; } if (e.key === 'Escape') editingPage = false; }} />
      {:else}
        <button class="pageLbl" title="Jump to page" onclick={() => (editingPage = true)}>{sliding ? sliderVal : app.page} / {N}</button>
      {/if}
      <input type="range" class="slider" min="1" max={N} bind:value={sliderVal} style="--p:{N > 1 ? ((sliderVal - 1) / (N - 1)) * 100 : 0}%"
             oninput={() => (sliding = true)} onchange={() => { sliding = false; goToPage(+sliderVal); }} />
      <button class="ib" title="Zoom out (Ctrl −)" onclick={() => zoom(-1)}><Icon name="minus" /></button>
      <button class="zoomLbl" title="Fit width (Ctrl 0)" onclick={fitWidth}>{Math.round((scale / 1.3) * 100)}%</button>
      <button class="ib" title="Zoom in (Ctrl +)" onclick={() => zoom(1)}><Icon name="plus" /></button>
      <button class="ib" title="Next page (→)" onclick={() => goToPage(currentPage() + 1, 0, false)}><Icon name="chev-right" /></button>
      <button class="ib" title="Last page (End)" onclick={() => goToPage(N)}><Icon name="chevs-right" /></button>
    </div>
  </div>
</div>

{#if pop}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="pop" style="left:{pop.x}px;top:{pop.y}px" onmousedown={(e) => e.preventDefault()}>
    {#if cardMode}
      <span class="lab">Card</span>
      <button class="cb" title="Highlight on the front — you recall the answer (F)" onclick={() => popAction('as-front')}>As front</button>
      <button class="cb" title="Highlight on the back — you recall the passage (B)" onclick={() => popAction('as-back')}>As back</button>
      <span class="psep"></span>
      <button title="Just highlight (H)" onclick={() => popAction(null, 'yellow')}><Icon name="highlighter" size={16} /></button>
      <button title="Note (N)" onclick={() => popAction('note')}><Icon name="pen" size={16} /></button>
    {:else}
      {#each [['yellow', 1], ['green', 2], ['blue', 3], ['pink', 4]] as [c, n]}
        <button class="dot" title="{c} ({n})" aria-label={c} style="background:var(--hl-{c})" onclick={() => popAction(null, c)}></button>
      {/each}
      <span class="psep"></span>
      <button title="Note (N)" onclick={() => popAction('note')}><Icon name="pen" size={16} />Note</button>
      <button title="Flashcard (C)" onclick={() => popAction('card')}><Icon name="cards" size={16} />Card</button>
    {/if}
    <span class="psep"></span>
    <button title="Copy" onclick={() => popAction('copy')}><Icon name="copy" size={16} /></button>
  </div>
{/if}
{#if snipBox}<div class="snipBox" style="left:{snipBox.left}px;top:{snipBox.top}px;width:{snipBox.w}px;height:{snipBox.h}px"></div>{/if}
{#if menuAnchor}<MainMenu anchor={menuAnchor} onclose={() => (menuAnchor = null)} {zoom} />{/if}

<style>
  .reader{position:fixed;inset:0;display:flex;background:var(--paper)}
  .col{flex:1;display:flex;flex-direction:column;min-width:0;position:relative}
  .top{height:54px;display:flex;align-items:center;padding:0 12px;gap:2px;background:var(--paper);position:relative;z-index:20;border-bottom:1px solid transparent;transition:border-color .2s}
  .top.scrolled{border-bottom-color:var(--line)}
  .title{position:absolute;left:50%;transform:translateX(-50%);font-weight:600;font-size:14.5px;max-width:36%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}
  .vsep{width:1px;height:20px;background:var(--line);margin:0 6px}
  .dot{position:absolute;top:4px;right:2px;min-width:16px;height:16px;border-radius:8px;background:var(--danger);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px}
  .mode{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 10px 0 9px;border-radius:9px;font-size:13.5px;color:var(--muted);margin-right:4px}
  .mode:hover{background:var(--hover)}
  .sw{width:30px;height:18px;border-radius:9px;background:var(--line);position:relative;transition:background .15s}
  .sw::after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}
  .mode.on{color:var(--accent);background:var(--accent-soft)}
  .mode.on .sw{background:var(--accent)}
  .mode.on .sw::after{left:14px}
  .viewer{flex:1;overflow:auto;position:relative;background:var(--viewer);outline:none}
  .pages{padding:16px 44px 50vh}
  .bot{height:58px;display:flex;align-items:center;padding:0 14px;gap:2px;background:var(--paper);border-top:1px solid var(--line)}
  .pageLbl{min-width:96px;text-align:center;font-size:15px;font-variant-numeric:tabular-nums;border-radius:6px;padding:4px 6px}
  .pageLbl:hover{background:var(--hover)}
  .pageEdit{width:96px;text-align:center;border:1px solid var(--accent);border-radius:6px;padding:3px;outline:none;font-size:15px;background:var(--field)}
  .slider{flex:1;margin:0 14px;-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:linear-gradient(to right,var(--accent) var(--p,0%),var(--line) var(--p,0%));outline:none;cursor:pointer}
  .slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:var(--accent);border:3px solid var(--paper);box-shadow:0 1px 3px rgba(0,0,0,.3)}
  .zoomLbl{font-size:12.5px;color:var(--muted);min-width:46px;text-align:center;border-radius:6px;padding:4px 2px}
  .zoomLbl:hover{background:var(--hover)}
  .pop{position:fixed;z-index:50;display:flex;background:#262626;color:#fff;border-radius:10px;padding:4px;gap:2px;align-items:center;box-shadow:var(--shadow)}
  .pop button{color:#fff;padding:6px 9px;border-radius:7px;font-size:13px;display:inline-flex;align-items:center;gap:6px}
  .pop button:hover{background:#ffffff1f}
  .pop .dot{position:static;width:18px;height:18px;min-width:0;border-radius:50%;padding:0;margin:0 3px;border:2px solid #ffffff38}
  .pop .psep{width:1px;height:18px;background:#ffffff30;margin:0 3px}
  .pop .cb{background:#ffffff14;font-weight:600}
  .pop .cb:hover{background:var(--accent)}
  .lab{font-size:11px;color:#ffffff90;padding:0 4px 0 6px;text-transform:uppercase;letter-spacing:.5px}
  .snipBox{position:fixed;border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);z-index:30;pointer-events:none}
  @media (max-width:900px){ .title{display:none} .mode .tx{display:none} }
</style>
