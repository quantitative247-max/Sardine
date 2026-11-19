<script>
  import { open } from '@tauri-apps/plugin-dialog';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import MainMenu from './MainMenu.svelte';
  import { app, title, importPaths, openDoc, removeDoc, dueCount, toast } from './state.svelte.js';
  import { coverUrl, api } from './backend.js';
  import { isDue } from './sched.js';
  import { startReview } from './review.svelte.js';

  let query = $state('');
  let menu = $state(null);       // { anchor, id }
  let mainMenu = $state(null);
  let broken = $state({});

  const docs = $derived(Object.values(app.docs).sort((a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt)));
  const shown = $derived(docs.filter((d) => !query || (title(d) + ' ' + (d.author || '')).toLowerCase().includes(query.toLowerCase())));
  const due = $derived(dueCount());

  function stats(d) {
    const cards = (app.annos[d.id] || []).filter((a) => a.card);
    const now = Date.now();
    return {
      cards: cards.length,
      due: cards.filter((a) => isDue(a, now)).length,
      pct: d.numPages ? Math.round(((d.lastPage || 1) / d.numPages) * 100) : 0,
      fin: d.numPages > 1 && (d.lastPage || 1) >= d.numPages,
    };
  }
  const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;

  async function add() {
    const paths = await open({ multiple: true, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (paths) importPaths(Array.isArray(paths) ? paths : [paths]);
  }
  async function locate(id) {
    const p = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!p) return;
    const res = await api.importPdfs([p]).catch((e) => (toast('Import failed: ' + e), null));
    if (!res?.length) return;
    if (res[0].id !== id) {
      toast("That file isn't the same PDF (its fingerprint differs) — added it as a separate book.", 5000);
      importPaths([p]);
    } else { app.present[id] = true; app.coverBust++; toast('File found'); }
  }
  function onBook(d) { app.present[d.id] ? openDoc(d.id) : locate(d.id); }
  const anchorOf = (e) => e.currentTarget.getBoundingClientRect();
</script>

<div class="lib">
  <div class="top">
    <div class="search">
      <Icon name="search" size={18} />
      <input placeholder="Search in {docs.length} book{docs.length === 1 ? '' : 's'}…" bind:value={query} />
      <span class="vr"></span>
      <button class="ib sm" title="Add PDFs" onclick={add}><Icon name="plus" /></button>
    </div>
    <button class="reviewPill" class:zero={!due} title="Review due flashcards (R)" onclick={() => startReview(null)}>
      <Icon name="cards" size={18} />Review<span class="n">{due}</span>
    </button>
    <button class="ib" title="Menu" onclick={(e) => (mainMenu = anchorOf(e))}><Icon name="menu" /></button>
  </div>

  <div class="body">
    {#if !docs.length}
      <div class="empty">
        <h1>Your library is empty</h1>
        <p>Drop PDFs anywhere in this window, or press <b>+</b>. Highlight passages, write notes in LaTeX, and turn any of them into flashcards.</p>
        <button class="btn primary" onclick={add}>Add PDF</button>
      </div>
    {:else}
      <div class="grid">
        {#each shown as d (d.id)}
          {@const s = stats(d)}
          <div class="book" role="listitem" title="{title(d)}{d.author ? ' — ' + d.author : ''}"
               oncontextmenu={(e) => { e.preventDefault(); menu = { id: d.id, anchor: { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY } }; }}>
            <button class="cover" class:missing={!app.present[d.id]} onclick={() => onBook(d)}>
              {#if app.present[d.id] && !broken[d.id]}
                {#key app.coverBust}<img src="{coverUrl(d.id)}?v={app.coverBust}" alt="" loading="lazy" onerror={() => (broken[d.id] = true)} />{/key}
              {:else}
                <div class="gen" style="--c1:hsl({hue(d.id)} 45% 42%);--c2:hsl({(hue(d.id) + 40) % 360} 50% 28%)">{title(d)}</div>
              {/if}
              {#if !app.present[d.id]}<span class="locate"><Icon name="folder" size={16} />Locate file…</span>{/if}
              {#if s.due}<span class="dueTag">{s.due}</span>{/if}
            </button>
            <div class="t">{title(d)}</div>
            <div class="m">
              {#if s.fin}<span class="fin">FINISHED</span>{:else}<span>{s.pct}%</span>{/if}
              {#if s.cards}<span class="cc" title="{s.cards} flashcards"><Icon name="cards" size={13} />{s.cards}</span>{/if}
              <span class="sp"></span>
              <button class="more" title="More" onclick={(e) => (menu = { id: d.id, anchor: anchorOf(e) })}><Icon name="more" size={16} /></button>
            </div>
          </div>
        {/each}
        {#if !query}<button class="addTile" title="Add PDFs" onclick={add}><Icon name="plus" size={44} /></button>{/if}
      </div>
    {/if}
  </div>
</div>

{#if menu}
  <Menu anchor={menu.anchor} align="left" onclose={() => (menu = null)}>
    {@const id = menu.id}
    <button onclick={() => { menu = null; onBook(app.docs[id]); }}>{app.present[id] ? 'Open' : 'Locate file…'}</button>
    <button onclick={() => { menu = null; startReview(id); }}>Review this book's cards</button>
    <div class="sep"></div>
    <button style="color:var(--danger)" onclick={() => { menu = null; removeDoc(id); }}>Remove from library</button>
  </Menu>
{/if}
{#if mainMenu}<MainMenu anchor={mainMenu} onclose={() => (mainMenu = null)} />{/if}

<svelte:window onkeydown={(e) => { if (!app.editor && !app.review && !app.dialog && e.key.toLowerCase() === 'r' && e.target.tagName !== 'INPUT') startReview(null); }} />

<style>
  .lib{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--lib)}
  .top{display:flex;align-items:center;gap:10px;padding:10px 24px 10px 30px}
  .search{flex:1;display:flex;align-items:center;gap:10px;background:var(--input);border-radius:10px;height:36px;padding:0 6px 0 14px;color:var(--muted)}
  .search input{flex:1;border:0;background:transparent;outline:none;font-size:15px;color:var(--ink)}
  .vr{width:1px;height:20px;background:var(--line)}
  .ib.sm{width:30px;height:30px}
  .reviewPill{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:10px;background:var(--primary-bg);color:var(--primary-ink);font-weight:600;font-size:13.5px}
  .reviewPill:hover{opacity:.9}
  .reviewPill .n{background:var(--primary-ink);color:var(--primary-bg);border-radius:9px;min-width:20px;height:18px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px}
  .reviewPill.zero .n{opacity:.45}
  .body{flex:1;overflow:auto;padding:14px 30px 40px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(122px,1fr));gap:26px 32px;max-width:1500px}
  .book{min-width:0;position:relative}
  .cover{aspect-ratio:118/172;width:100%;border-radius:3px;overflow:hidden;background:var(--card);box-shadow:0 1px 2px rgba(0,0,0,.1),0 4px 10px rgba(0,0,0,.08);display:block;position:relative;transition:transform .15s,box-shadow .15s}
  .book:hover .cover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(0,0,0,.12),0 10px 22px rgba(0,0,0,.14)}
  .cover img{width:100%;height:100%;object-fit:cover;display:block}
  .gen{width:100%;height:100%;background:linear-gradient(160deg,var(--c1),var(--c2));color:#fff;padding:12px;display:flex;align-items:center;justify-content:center;text-align:center;font:600 14px/1.25 Georgia,serif;word-break:break-word}
  .cover.missing .gen{filter:grayscale(.7) opacity(.6)}
  .locate{position:absolute;left:6px;right:6px;bottom:8px;background:rgba(0,0,0,.65);color:#fff;border-radius:6px;font-size:11.5px;padding:4px 6px;display:flex;gap:5px;align-items:center;justify-content:center}
  .dueTag{position:absolute;top:6px;right:6px;background:var(--danger);color:#fff;border-radius:10px;font-size:10.5px;font-weight:700;padding:1px 7px;box-shadow:0 1px 3px rgba(0,0,0,.25)}
  .t{margin-top:9px;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .m{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);height:22px}
  .cc{display:inline-flex;align-items:center;gap:3px}
  .fin{background:var(--green);color:#fff;font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 4px;border-radius:2px}
  .more{opacity:0;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--muted)}
  .book:hover .more{opacity:1}
  .more:hover{background:var(--hover)}
  .addTile{aspect-ratio:118/172;width:100%;border-radius:3px;background:color-mix(in srgb,var(--card) 60%,transparent);display:flex;align-items:center;justify-content:center;color:var(--faint)}
  .addTile:hover{background:var(--card);color:var(--muted)}
  .empty{max-width:520px;margin:10vh auto 0;text-align:center;color:var(--muted)}
  .empty h1{color:var(--ink);font-size:22px;margin:0 0 8px;font-weight:600}
</style>
