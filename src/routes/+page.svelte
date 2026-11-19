<script>
  import { onMount } from 'svelte';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { app, boot, importPaths, resolvedTheme, ctl } from '$lib/state.svelte.js';
  import Stats from '$lib/Stats.svelte';
  import { api } from '$lib/backend.js';
  import Library from '$lib/Library.svelte';
  import Reader from '$lib/Reader.svelte';
  import Review from '$lib/Review.svelte';
  import Editor from '$lib/Editor.svelte';
  import Dialogs from '$lib/Dialogs.svelte';

  let dragging = $state(false);

  onMount(() => {
    boot().then(async () => { const f = await api.startupFiles(); if (f.length) importPaths(f, true); }).catch((e) => { console.error(e); app.toast = 'Startup failed: ' + e; });
    let un;
    getCurrentWebview().onDragDropEvent((ev) => {
      const t = ev.payload.type;
      if (t === 'enter' || t === 'over') dragging = true;
      else if (t === 'leave') dragging = false;
      else if (t === 'drop') {
        dragging = false;
        const paths = ev.payload.paths || [];
        if (app.editor && ctl.editorDropImages) { ctl.editorDropImages(paths); return; }
        const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
        if (pdfs.length) importPaths(pdfs, app.view === 'reader' && pdfs.length === 1);
      }
    }).then((f) => (un = f));
    return () => un?.();
  });

  $effect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme();
    root.dataset.invert = app.settings.invertPages ? '1' : '0';
  });
</script>

{#if app.ready}
  {#if app.view === 'reader' && app.docId}
    <Reader />
  {:else}
    <Library />
  {/if}
  {#if app.stats}<Stats />{/if}
  {#if app.review}<Review />{/if}
  {#if app.editor}<Editor />{/if}
  <Dialogs />
{/if}

{#if dragging}<div class="dropzone">Drop PDFs to add them to your library</div>{/if}
{#if app.toast}<div id="toast">{app.toast}</div>{/if}

<style>
  .dropzone{position:fixed;inset:12px;border:2px dashed var(--accent);border-radius:16px;background:color-mix(in srgb,var(--accent) 7%,transparent);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--accent);z-index:99;pointer-events:none}
</style>
