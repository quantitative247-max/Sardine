<script>
  import { app, saveSettings, allCards, saveAnnos, toast } from './state.svelte.js';
  import { setSchedConfig, parseWeights, FSRS5_DEFAULT, fsrsMemory, DAY } from './sched.js';
  import { variants, getS, setS } from './cards.js';
  import { setMacros } from './md.js';
  import { api } from './backend.js';

  const d = $derived(app.dialog);
  let form = $state({});
  let dir = $state('');
  $effect(() => {
    if (d?.kind === 'settings') {
      form = { macros: app.settings.macros, newPerDay: app.settings.newPerDay, defaultSide: app.settings.defaultSide,
               algorithm: app.settings.algorithm, retention: Math.round(app.settings.retention * 100), maxIvl: app.settings.maxIvl, fsrsWeights: app.settings.fsrsWeights };
      api.dataDir().then((x) => (dir = x)).catch(() => {});
    }
  });

  function close(v) { d?.resolve?.(v); app.dialog = null; }
  const weightsOk = $derived(!form.fsrsWeights?.trim() || !!parseWeights(form.fsrsWeights));
  function saveSet() {
    if (!weightsOk) return toast('FSRS parameters must be 19 (FSRS-5) or 21 (FSRS-6) numbers');
    const switching = form.algorithm === 'fsrs' && app.settings.algorithm !== 'fsrs';
    Object.assign(app.settings, {
      macros: form.macros, newPerDay: Math.max(0, +form.newPerDay || 0), defaultSide: form.defaultSide,
      algorithm: form.algorithm, retention: Math.min(0.99, Math.max(0.7, (+form.retention || 90) / 100)),
      maxIvl: Math.max(1, Math.round(+form.maxIvl || 36500)), fsrsWeights: form.fsrsWeights.trim(),
    });
    setMacros(app.settings.macros); setSchedConfig(app.settings); saveSettings();
    if (switching) rebuild(true);
    close();
  }
  /** Derive FSRS stability/difficulty for every card from its review history (like Mochi does when switching). */
  function rebuild(quiet) {
    setSchedConfig({ ...app.settings, algorithm: 'fsrs' });
    const byCard = new Map();
    for (const e of app.revlog) { const k = e.a + ':' + e.k; (byCard.get(k) || byCard.set(k, []).get(k)).push(e); }
    let n = 0; const touched = new Set();
    for (const a of allCards()) for (const v of variants(a)) {
      const hist = (byCard.get(a.id + ':' + v.key) || []).sort((x, y) => x.t - y.t);
      if (!hist.length) continue;
      let mem = null, last = null;
      for (const e of hist) { mem = fsrsMemory(mem, e.g, last ? (e.t - last) / DAY : 0); last = e.t; }
      setS(a, v.key, { ...getS(a, v.key), S: mem.S, D: mem.D, last });
      n++; touched.add(a.docId);
    }
    setSchedConfig(app.settings);
    touched.forEach(saveAnnos);
    toast(`FSRS memory computed for ${n} card${n === 1 ? '' : 's'} from your review history` + (quiet ? '; cards without history are estimated from their intervals' : ''), 4500);
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
    <div class="modal" style="width:min(680px,100%)">
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
        <div class="sched">
          <span class="lbl">Scheduler</span>
          <div class="seg" style="margin-bottom:10px">
            <button class:on={form.algorithm === 'sm2'} onclick={() => (form.algorithm = 'sm2')}>SM-2 (Anki classic)</button>
            <button class:on={form.algorithm === 'fsrs'} onclick={() => (form.algorithm = 'fsrs')}>FSRS</button>
          </div>
          {#if form.algorithm === 'fsrs'}
            <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:10px">
              <div><span class="lbl">Desired retention</span><input class="ed" type="number" min="70" max="99" style="width:90px" bind:value={form.retention} /> %</div>
              <div><span class="lbl">Maximum interval (days)</span><input class="ed" type="number" min="1" style="width:110px" bind:value={form.maxIvl} /></div>
            </div>
            <span class="lbl">Parameters <span style="text-transform:none;font-weight:400;letter-spacing:0">— optional; paste 19 (FSRS-5) or 21 (FSRS-6) numbers from an FSRS optimizer</span></span>
            <textarea class="ed" rows="2" bind:value={form.fsrsWeights} placeholder={FSRS5_DEFAULT.join(', ')} style={weightsOk ? '' : 'border-color:var(--danger)'}></textarea>
            <div class="hint">
              Higher retention means more reviews. 90% is a good default. When you switch, each card's memory is rebuilt from your review history; progress isn't lost and you can switch back any time.
              <button class="btn ghost" style="padding:2px 8px;font-size:12px" onclick={() => rebuild(false)}>Rebuild from history now</button>
            </div>
          {:else}
            <div class="hint">Classic intervals: 1 m → 10 m learning steps, then interval × ease.</div>
          {/if}
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
        <kbd>1</kbd>–<kbd>4</kbd> colour · <kbd>N</kbd> note · <kbd>C</kbd> card — in flashcard mode: <kbd>F</kbd> as front · <kbd>B</kbd> as back · <kbd>C</kbd> cloze · <kbd>H</kbd> highlight<br />
        <b>Card editor</b><br />
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> cloze selection (new card) · add <kbd>Alt</kbd> for same card · <kbd>Ctrl</kbd>+<kbd>V</kbd> paste an image · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save<br />
        <b>Review</b><br />
        <kbd>Space</kbd> reveal / Good · <kbd>1</kbd>–<kbd>4</kbd> grade · <kbd>U</kbd> undo · <kbd>E</kbd> edit · <kbd>Esc</kbd> exit<br />
        <b>LaTeX</b><br />
        <code>$…$</code> inline · <code>$$…$$</code> display · <code>\begin{'{'}align{'}'}…\end{'{'}align{'}'}</code>
      </div>
      <footer><span class="sp"></span><button class="btn primary" onclick={() => close()}>Close</button></footer>
    </div>
  </div>
{/if}

<style>
  .sched{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:14px}
</style>
