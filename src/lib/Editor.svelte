<script>
  import { app, commitEditor, deleteAnno, confirmBox, title, findAnno } from './state.svelte.js';
  import { md } from './md.js';
  import { newSched } from './sched.js';
  import { nextCard } from './review.svelte.js';

  const e = $derived(app.editor);
  const area = $derived(e?.a.kind === 'area');
  const s = $derived(e?.a.card?.s);
  let first = $state();
  $effect(() => { setTimeout(() => first?.focus(), 30); });

  const where = $derived(e ? `${title(app.docs[e.a.docId])} · p. ${e.a.page}` : '');
  const slotText = $derived(area ? '+ snipped image' : '+ highlighted text');

  function swap() {
    [e.front, e.back] = [e.back, e.front];
    e.side = e.side === 'front' ? 'back' : e.side === 'back' ? 'front' : 'none';
  }
  async function del() {
    if (e.isNew) { app.editor = null; return; }
    const a = findAnno(e.a.docId, e.a.id);
    if (!(await confirmBox('Delete this annotation' + (a?.card ? ' and its flashcard' : '') + '?'))) return;
    app.editor = null;
    if (a) deleteAnno(a);
    if (app.review?.cur?.id === e.a.id) nextCard();
  }
  async function reset() {
    if (!(await confirmBox('Reset this card to new? Its review history is discarded.', 'Reset'))) return;
    e.a.card.s = newSched();
  }
  function key(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); app.editor = null; }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.stopImmediatePropagation(); commitEditor(); }
  }
</script>

<svelte:window onkeydowncapture={key} />

<div class="overlay">
  <div class="modal" role="dialog" aria-label="Annotation">
    <header>
      <h2>{e.isNew ? (e.cardTitle ? 'New flashcard' : 'New annotation') : 'Edit annotation'}</h2>
      <span class="hint">{where}</span>
    </header>
    <div class="body">
      <div class="field">
        {#if area}
          <span class="lbl">Snipped region</span>
          <img class="snipImg" src={e.a.image} alt="Snipped region" />
        {:else}
          <span class="lbl">Highlighted text <span class="tl">— edit freely, e.g. retype a garbled formula as LaTeX</span></span>
          <textarea class="ed" rows="3" bind:value={e.quote}></textarea>
          <div class="preview md" style="margin-top:6px">{@html md(e.quote)}</div>
        {/if}
      </div>
      <div class="field row">
        <span class="lbl" style="margin:0">Colour</span>
        <div class="colors">
          {#each ['yellow', 'green', 'blue', 'pink'] as c}
            <button class:sel={e.color === c} style="background:var(--hl-{c})" aria-label={c} onclick={() => (e.color = c)}></button>
          {/each}
        </div>
      </div>
      <div class="field">
        <span class="lbl">Note</span>
        <div class="pair">
          <textarea class="ed" bind:this={first} bind:value={e.note} placeholder="Your thoughts. **bold**, *italic*, $LaTeX$."></textarea>
          <div class="preview md">{@html md(e.note)}</div>
        </div>
      </div>
      <div class="cardBox">
        <label class="toggle"><input type="checkbox" bind:checked={e.cardOn} /> Spaced-repetition card</label>
        {#if e.cardOn}
          <div class="sideSel">
            <span class="hint">Highlight goes on the</span>
            <div class="seg">
              {#each [['front', 'Front'], ['back', 'Back'], ['none', 'Neither']] as [v, l]}
                <button class:on={e.side === v} onclick={() => (e.side = v)}>{l}</button>
              {/each}
            </div>
            <button class="btn ghost" onclick={swap} title="Swap front and back">⇄ Swap</button>
          </div>
          <div class="pair">
            <div class="side">
              <span class="lbl">Front · prompt</span>
              {#if e.side === 'front'}<span class="slot">{slotText}</span>{/if}
              <textarea class="ed" bind:value={e.front} placeholder="e.g. State the divergence theorem."></textarea>
              <div class="preview md" style="margin-top:6px">{@html md(e.front)}</div>
            </div>
            <div class="side">
              <span class="lbl">Back · answer</span>
              {#if e.side === 'back'}<span class="slot">{slotText}</span>{/if}
              <textarea class="ed" bind:value={e.back} placeholder={'e.g. $$\\iiint_V \\nabla\\cdot\\mathbf F\\,dV=\\oint_S \\mathbf F\\cdot d\\mathbf S$$'}></textarea>
              <div class="preview md" style="margin-top:6px">{@html md(e.back)}</div>
            </div>
          </div>
          {#if s}
            <div class="hint" style="margin-top:8px">
              {#if s.state === 'new'}New card — not reviewed yet.{:else}Reviewed {s.reps}× · {s.lapses} lapse{s.lapses === 1 ? '' : 's'} · next {new Date(s.due).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>
    <footer>
      <button class="btn danger" onclick={del}>{e.isNew ? 'Discard' : 'Delete'}</button>
      {#if s && s.state !== 'new'}<button class="btn ghost" onclick={reset}>Reset progress</button>{/if}
      <span class="sp"></span>
      <span class="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel</span>
      <button class="btn" onclick={() => (app.editor = null)}>Cancel</button>
      <button class="btn primary" onclick={commitEditor}>Save</button>
    </footer>
  </div>
</div>

<style>
  .field{margin-bottom:14px}
  .row{display:flex;align-items:center;gap:12px}
  .tl{text-transform:none;letter-spacing:0;font-weight:400}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .colors{display:flex;gap:7px}
  .colors button{width:22px;height:22px;border-radius:50%}
  .colors button.sel{box-shadow:0 0 0 2px var(--card),0 0 0 4px var(--ink)}
  .cardBox{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:color-mix(in srgb,var(--input) 35%,transparent)}
  .toggle{display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer}
  .toggle input{width:16px;height:16px;accent-color:var(--accent)}
  .sideSel{display:flex;align-items:center;gap:10px;margin:12px 0}
  .side{border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--card)}
  .slot{font-size:12px;color:var(--accent);background:var(--accent-soft);border-radius:5px;padding:2px 7px;margin-bottom:6px;display:inline-block}
</style>
