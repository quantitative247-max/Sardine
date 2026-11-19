<script>
  import Menu from './Menu.svelte';
  import { app, saveSettings } from './state.svelte.js';
  import { exportCards, exportMarkdown, backup, restore } from './exporters.svelte.js';
  let { anchor, onclose, zoom } = $props();
  const run = (fn) => () => { onclose(); fn(); };
  const setTheme = (t) => { app.settings.theme = t; saveSettings(); };
</script>

<Menu {anchor} {onclose}>
  <div class="h">Theme</div>
  <div class="row">
    {#each [['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark'], ['system', 'Auto']] as [t, l]}
      <button class:on={app.settings.theme === t} onclick={() => setTheme(t)}>{l}</button>
    {/each}
  </div>
  <div class="row" style="padding-bottom:6px">
    <button class:on={app.settings.invertPages} style="flex:1" onclick={() => { app.settings.invertPages = !app.settings.invertPages; saveSettings(); }}>
      Dark pages in dark mode: {app.settings.invertPages ? 'on' : 'off'}
    </button>
  </div>
  {#if app.docId && zoom}
    <div class="sep"></div>
    <div class="h">Zoom</div>
    <div class="row"><button onclick={() => zoom(-1)}>−</button><button style="flex:1" onclick={() => zoom(0)}>Fit width</button><button onclick={() => zoom(1)}>+</button></div>
    <div class="sep"></div>
    <div class="h">Export this book</div>
    <button onclick={run(() => exportCards('anki', app.docId))}>Cards → Anki<small>.txt · in Anki: File ▸ Import</small></button>
    <button onclick={run(() => exportCards('mochi', app.docId))}>Cards → Mochi<small>CSV with Front/Back columns, $LaTeX$ kept</small></button>
    <button onclick={run(() => exportMarkdown(app.docId))}>Notes → Markdown</button>
  {/if}
  <div class="sep"></div>
  <div class="h">All books</div>
  <button onclick={run(() => exportCards('anki'))}>All cards → Anki</button>
  <button onclick={run(() => exportCards('mochi'))}>All cards → Mochi</button>
  <div class="sep"></div>
  <button onclick={run(backup)}>Back up annotations…</button>
  <button onclick={run(restore)}>Restore from backup…<small>Also accepts backups from the HTML version</small></button>
  <div class="sep"></div>
  <button onclick={run(() => (app.stats = true))}>Statistics</button>
  <button onclick={run(() => (app.dialog = { kind: 'settings' }))}>Settings: scheduler, LaTeX macros</button>
  <button onclick={run(() => (app.dialog = { kind: 'help' }))}>Keyboard shortcuts</button>
</Menu>
