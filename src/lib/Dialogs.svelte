<script>
  import { app, saveSettings } from './state.svelte.js';
  import { setMacros } from './md.js';
  import { api } from './backend.js';

  const d = $derived(app.dialog);
  let form = $state({});
  let dir = $state('');
  $effect(() => {
    if (d?.kind === 'settings') {
      form = { macros: app.settings.macros, newPerDay: app.settings.newPerDay, defaultSide: app.settings.defaultSide };
      api.dataDir().then((x) => (dir = x)).catch(() => {});
    }
  });

  function close(v) { d?.resolve?.(v); app.dialog = null; }
  function saveSet() {
    Object.assign(app.settings, { macros: form.macros, newPerDay: Math.max(0, +form.newPerDay || 0), defaultSide: form.defaultSide });
    setMacros(app.settings.macros); saveSettings(); close();
  }
  function key(e) { if (d && e.key === 'Escape') { e.stopImmediatePropagation(); close(false); } }
</script>

<svelte:window onkeydowncapture={key} />

{#if d?.kind === 'confirm'}
  <div class="overlay">
    <div class="modal" style="width:min(420px,100%)">
      <div class="body" style="padding:22px 20px">{@html d.html}</div>
      <footer><span class="sp"></span><button class="btn" onclick={() => close(false)}>Cancel</button><button class="btn danger" onclick={() => close(true)}>{d.yes}</button></footer>
    </div>
  </div>
{:else if d?.kind === 'settings'}
  <div class="overlay">
    <div class="modal" style="width:min(640px,100%)">
      <header><h2>Settings</h2></header>
      <div class="body">
        <div style="margin-bottom:14px">
          <span class="lbl">LaTeX macros</span>
          <textarea class="ed" rows="7" bind:value={form.macros} placeholder={'\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}\n\\vb: \\mathbf'}></textarea>
          <div class="hint">One per line: <code>\newcommand{'{'}\R{'}{'}\mathbb{'{'}R{'}}'}</code> or <code>\R: \mathbb{'{'}R{'}'}</code>. Exports don't expand macros — define them in Anki/Mochi too.</div>
        </div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:14px">
          <div><span class="lbl">New cards per day</span><input class="ed" type="number" min="0" max="9999" style="width:100px" bind:value={form.newPerDay} /></div>
          <div><span class="lbl">Default highlight side</span>
            <select class="ed" bind:value={form.defaultSide}><option value="front">Front</option><option value="back">Back</option><option value="none">Neither</option></select></div>
        </div>
        <div class="hint">Your books and notes are stored in <code class="selectable">{dir}</code></div>
      </div>
      <footer><span class="sp"></span><button class="btn" onclick={() => close()}>Cancel</button><button class="btn primary" onclick={saveSet}>Save</button></footer>
    </div>
  </div>
{:else if d?.kind === 'help'}
  <div class="overlay">
    <div class="modal" style="width:min(580px,100%)">
      <header><h2>Keyboard shortcuts</h2></header>
      <div class="body" style="line-height:2">
        <b>Reading</b><br />
        <kbd>←</kbd> <kbd>→</kbd> page · <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> back/forward · <kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> zoom · <kbd>B</kbd> bookmark · <kbd>T</kbd> sidebar · <kbd>D</kbd> dark mode<br />
        <kbd>V</kbd> highlight tool · <kbd>S</kbd> snip tool · <kbd>F</kbd> flashcard mode · <kbd>R</kbd> review<br />
        <b>After selecting text</b><br />
        <kbd>1</kbd>–<kbd>4</kbd> colour · <kbd>N</kbd> note · <kbd>C</kbd> card — in flashcard mode: <kbd>F</kbd> as front · <kbd>B</kbd> as back · <kbd>H</kbd> highlight<br />
        <b>Review</b><br />
        <kbd>Space</kbd> reveal / Good · <kbd>1</kbd>–<kbd>4</kbd> grade · <kbd>U</kbd> undo · <kbd>E</kbd> edit · <kbd>Esc</kbd> exit<br />
        <b>LaTeX</b><br />
        <code>$…$</code> inline · <code>$$…$$</code> display · <code>\begin{'{'}align{'}'}…\end{'{'}align{'}'}</code>
      </div>
      <footer><span class="sp"></span><button class="btn primary" onclick={() => close()}>Close</button></footer>
    </div>
  </div>
{/if}
