<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import PdfPage from './PdfPage.svelte';
  import Sidebar from './Sidebar.svelte';
  import MainMenu from './MainMenu.svelte';
  import { app, ctl, title, saveDocs, saveSettings, closeDoc, makeAnno, saveAnno, openEditor, toast, dueCount, resolvedTheme } from './state.svelte.js';
  import { api } from './backend.js';
  import { startReview } from './review.svelte.js';
  import { getCurrentWindow } from '@tauri-apps/api/window';

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
    pop = null; if (boxSel) boxSel = null;
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
  // Ctrl+wheel and touchpad pinch (Windows reports a pinch as wheel events with ctrlKey set).
  // The pages are scaled with a CSS transform while the gesture runs, and re-rendered at the
  // new size once it pauses, keeping the point under the cursor fixed.
  let pinch = null, pinchT;
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    pop = null; boxSel = null;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (!pinch) {
      const pr = pagesEl.getBoundingClientRect();
      const el = [...pageEls()].find((p) => { const r = p.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom + 16; }) || pageEls()[currentPage() - 1];
      const r = el.getBoundingClientRect(), vr = viewer.getBoundingClientRect();
      pinch = { k: 1, el, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, cx: e.clientX - vr.left, cy: e.clientY - vr.top };
      pagesEl.style.transformOrigin = `${e.clientX - pr.left}px ${e.clientY - pr.top}px`;
    }
    const k = Math.min(5 / scale, Math.max(0.4 / scale, pinch.k * Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.003)));
    pinch.k = k;
    pagesEl.style.transform = `scale(${k})`;
    clearTimeout(pinchT); pinchT = setTimeout(commitPinch, 160);
  }
  function commitPinch() {
    const p = pinch; pinch = null; if (!p) return;
    const n = +p.el.dataset.i;
    scale = Math.min(5, Math.max(0.4, scale * p.k));
    if (doc) { doc.scale = scale; saveDocs(); }
    tick().then(() => {
      pagesEl.style.transform = ''; pagesEl.style.transformOrigin = '';
      const el = pageEls()[n]; if (!el) return;
      viewer.scrollTop = el.offsetTop + p.fy * el.offsetHeight - p.cy;
      viewer.scrollLeft = el.offsetLeft + p.fx * el.offsetWidth - p.cx;
    });
  }
  $effect(() => {
    if (!viewer) return;
    viewer.addEventListener('wheel', onWheel, { passive: false });
    return () => viewer.removeEventListener('wheel', onWheel);
  });

  // ------------------------------------------------ fullscreen
  let fullscreen = $state(false);
  async function toggleFullscreen() {
    try { const w = getCurrentWindow(); fullscreen = !(await w.isFullscreen()); await w.setFullscreen(fullscreen); }
    catch (err) { toast('Fullscreen failed: ' + err); }
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
    endSelecting();
    if (tool !== 'select' || e.button !== 0 || boxed) { boxed = false; return; }
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
      showPop(info);
    }, 0);
  }
  function showPop(info) {
    pending = info;
    const r = info.anchor, w = cardMode ? 380 : 330, h = 40;
    const x = Math.min(innerWidth - w - 8, Math.max(8, r.right - w / 2));
    let y = r.bottom + 8; if (y + h > innerHeight - 66) y = r.top - h - 8;
    pop = { x, y };
  }

  // ------------------------------------------------ text drag: keep the selection sane over gaps
  // While dragging, the page's end-of-content block (behind the spans) fills the page and is moved
  // to sit right after the span under the selection focus, so hovering a blank gap extends the
  // selection to the nearest text instead of jumping to the end of the page (pdf.js technique).
  let selecting = false;
  function startSelecting() { selecting = true; viewer.classList.add('selecting'); }
  function endSelecting() {
    if (!selecting) return;
    selecting = false; viewer.classList.remove('selecting');
    pagesEl.querySelectorAll('.tl').forEach((tl) => { const eoc = tl.querySelector(':scope > .eoc'); if (eoc && tl.lastChild !== eoc) tl.append(eoc); });
  }
  function onSelChange() {
    if (!selecting) return;
    const sel = getSelection(); if (!sel?.rangeCount) return;
    let n = sel.focusNode; if (n?.nodeType === 3) n = n.parentNode;
    const span = n?.closest?.('.tl > span'); if (!span) return;
    const eoc = span.parentNode.querySelector(':scope > .eoc');
    if (eoc && span.nextSibling !== eoc) span.after(eoc);
  }

  // ------------------------------------------------ box text selection (PDF-XChange style)
  // Dragging from blank page space draws a box; the text whose characters fall inside it is selected.
  let boxed = false;
  let boxSel = $state(null);          // client rects painted as the selection
  function collectBox(pg, box) {
    const b = pg.getBoundingClientRect(), i = +pg.dataset.i;
    const inside = (cx, cy) => cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
    const range = document.createRange();
    const lines = [], raw = [], paint = [];
    for (const span of pg.querySelectorAll('.tl > span')) {
      const sr = span.getBoundingClientRect();
      if (sr.right < box.left || sr.left > box.right || sr.bottom < box.top || sr.top > box.bottom) continue;
      const tn = span.firstChild; if (!tn || tn.nodeType !== 3) continue;
      const t = tn.data; let piece = '', lo = null, hi = null;
      for (let k = 0; k < t.length; k++) {
        range.setStart(tn, k); range.setEnd(tn, k + 1);
        const cr = range.getBoundingClientRect();
        if (cr.width <= 0 || !inside(cr.left + cr.width / 2, cr.top + cr.height / 2)) continue;
        piece += t[k];
        lo = lo ? { l: Math.min(lo.l, cr.left), t: Math.min(lo.t, cr.top) } : { l: cr.left, t: cr.top };
        hi = hi ? { r: Math.max(hi.r, cr.right), b: Math.max(hi.b, cr.bottom) } : { r: cr.right, b: cr.bottom };
      }
      if (!piece.trim()) continue;
      const rr = { left: lo.l, top: lo.t, right: hi.r, bottom: hi.b };
      paint.push(rr);
      raw.push({ p: i, x: (rr.left - b.left) / b.width, y: (rr.top - b.top) / b.height, w: (rr.right - rr.left) / b.width, h: (rr.bottom - rr.top) / b.height });
      const prev = lines[lines.length - 1];
      if (prev && Math.abs(prev.y - rr.top) < (rr.bottom - rr.top) * 0.5) prev.t += piece; else lines.push({ y: rr.top, t: piece });
    }
    const text = lines.map((l) => l.t.trim()).join('\n').replace(/­/g, '').replace(/-\s*\n\s*(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!text) return null;
    const last = paint[paint.length - 1];
    return { info: { text, rects: mergeRects(raw), anchor: last }, paint };
  }
  function startBox(e, pg) {
    const b = pg.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev) => {
      const x = Math.max(b.left, Math.min(b.right, ev.clientX)), y = Math.max(b.top, Math.min(b.bottom, ev.clientY));
      if (!moved && Math.hypot(x - x0, y - y0) < 4) return;
      moved = true;
      snipBox = { left: Math.min(x, x0), top: Math.min(y, y0), w: Math.abs(x - x0), h: Math.abs(y - y0), text: true };
    };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up, true);
      const s = snipBox; snipBox = null;
      if (!moved || !s) return;                 // a plain click — let onMouseUp handle highlight clicks
      boxed = true;
      const r = collectBox(pg, { left: s.left, top: s.top, right: s.left + s.w, bottom: s.top + s.h });
      if (!r) { toast('No text in that box — press S to snip it as an image'); return; }
      boxSel = r.paint;
      showPop(r.info);
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up, true);
  }
  async function popAction(act, color) {
    const info = pending; if (!info) return;
    if (act === 'copy') { try { await navigator.clipboard.writeText(info.text); toast('Copied'); } catch { toast('Copy blocked'); } return; }
    const a = makeAnno(app.docId, { kind: 'text', text: info.text, rects: info.rects, color: color || app.lastColor || 'yellow' });
    pop = null; pending = null; boxSel = null; getSelection().removeAllRanges();
    if (color) { app.lastColor = color; saveAnno(a); toast('Highlighted'); return; }
    if (act === 'cloze') return openEditor(a, { isNew: true, card: true, type: 'cloze' });
    if (act === 'as-front' || act === 'as-back') return openEditor(a, { isNew: true, card: true, side: act === 'as-front' ? 'front' : 'back' });
    openEditor(a, { isNew: true, card: act === 'card' });
  }

  // ------------------------------------------------ snip
  let snipBox = $state(null);
  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (tool === 'select') {
      boxSel = null;
      if (e.target.closest?.('.marker')) return;
      if (e.target.matches?.('.tl > span')) { startSelecting(); return; }
      const pg = e.target.closest?.('.page');
      if (pg) { e.preventDefault(); getSelection().removeAllRanges(); pop = null; viewer.focus({ preventScroll: true }); startBox(e, pg); }
      return;
    }
    const layer = e.target.closest?.('.snip-layer'); if (!layer) return;
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
    if (app.editor || app.dialog || app.stats || (app.review && !app.review.away) || menuAnchor) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (pop && pending && !e.ctrlKey && !e.metaKey) {
      const act = cardMode ? { f: 'as-front', b: 'as-back', c: 'cloze', n: 'note', h: 'hl' }[k] : { n: 'note', c: 'card' }[k];
      const col = !cardMode ? { 1: 'yellow', 2: 'green', 3: 'blue', 4: 'pink' }[k] : act === 'hl' ? 'yellow' : null;
      if (act || col) { e.preventDefault(); popAction(act === 'hl' ? null : act, col); return; }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoom(1); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoom(-1); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); zoom(0); return; }
    if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
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
    else if (e.key === 'Escape') {
      if (fullscreen && !pop && tool === 'select' && getSelection().isCollapsed) { toggleFullscreen(); return; }
      setTool('select'); pop = null; boxSel = null; getSelection().removeAllRanges();
    }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goToPage(currentPage() + 1, 0, false); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goToPage(currentPage() - 1, 0, false); }
    else if (e.key === 'Home') { e.preventDefault(); goToPage(1); }
    else if (e.key === 'End') { e.preventDefault(); goToPage(N); }
  }
  const anchorOf = (e) => e.currentTarget.getBoundingClientRect();
</script>

<svelte:window onkeydown={onKey} onresize={() => { pop = null; boxSel = null; }} />
<svelte:document onselectionchange={onSelChange} />

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
      <button class="ib" title={fullscreen ? 'Exit full screen (F11)' : 'Full screen (F11)'} onclick={toggleFullscreen}><Icon name={fullscreen ? 'shrink' : 'expand'} /></button>
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
      <button class="cb" title="Turn the passage into a cloze — hide key words (C)" onclick={() => popAction('cloze')}>Cloze</button>
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
{#if boxSel}{#each boxSel as r}<div class="boxSel" style="left:{r.left}px;top:{r.top}px;width:{r.right - r.left}px;height:{r.bottom - r.top}px"></div>{/each}{/if}
{#if snipBox}<div class="snipBox" class:text={snipBox.text} style="left:{snipBox.left}px;top:{snipBox.top}px;width:{snipBox.w}px;height:{snipBox.h}px"></div>{/if}
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
  .viewer{flex:1;overflow:auto;position:relative;background:var(--viewer);outline:none;
    --box-cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cg fill='none' stroke-linecap='square'%3E%3Cpath stroke='white' stroke-width='3' d='M8 1v5M8 10v5M1 8h5M10 8h5M17 13v8M15 13h4M15 21h4'/%3E%3Cpath stroke='black' stroke-width='1' d='M8 1v5M8 10v5M1 8h5M10 8h5M17 13v8M15 13h4M15 21h4'/%3E%3C/g%3E%3C/svg%3E") 8 8, crosshair}
  .pages{transform-origin:0 0}
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
  .boxSel{position:fixed;background:rgba(47,124,246,.32);z-index:15;pointer-events:none;border-radius:1px}
  .snipBox.text{border:1px dashed var(--accent);background:color-mix(in srgb,var(--accent) 6%,transparent)}
  .snipBox{position:fixed;border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);z-index:30;pointer-events:none}
  @media (max-width:900px){ .title{display:none} .mode .tx{display:none} }
</style>
