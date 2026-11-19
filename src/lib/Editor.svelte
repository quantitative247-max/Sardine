<script>
  import { app, commitEditor, deleteAnno, confirmBox, title, findAnno } from './state.svelte.js';
  import { open } from '@tauri-apps/plugin-dialog';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { md, clozeHTML } from './md.js';
  import { newSched } from './sched.js';
  import { nextCard } from './review.svelte.js';
  import { clozeKeys, parseClozes, variants } from './cards.js';
  import { api } from './backend.js';
  import { ctl, toast } from './state.svelte.js';

  const e = $derived(app.editor);
  const area = $derived(e?.a.kind === 'area');
  const vs = $derived(e?.a.card ? variants(e.a) : []);
  const s = $derived(vs.length === 1 ? vs[0].s : null);
  const nCloze = $derived(e ? clozeKeys(e.clozeText).length : 0);
  const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

  // ---- images: paste, drop, or pick; inserted as ![](media/<file>) at the cursor
  const els = {};
  let lastField = $state('note');
  function insertAt(field, text) {
    const ta = els[field];
    const v = e[field] || '';
    const at = ta ? ta.selectionStart : v.length, to = ta ? ta.selectionEnd : v.length;
    const pre = v.slice(0, at), post = v.slice(to);
    const sep = pre && !pre.endsWith('\n') ? '\n' : '';
    e[field] = pre + sep + text + (post.startsWith('\n') ? '' : '\n') + post;
    queueMicrotask(() => { if (ta) { const p = (pre + sep + text).length; ta.focus(); ta.setSelectionRange(p, p); } });
  }
  const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
  async function onPaste(ev, field) {
    const files = [...(ev.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (!files.length) return;
    ev.preventDefault();
    for (const f of files) {
      try { insertAt(field, `![](media/${await api.saveMedia(await toB64(f), f.type.split('/')[1] || 'png')})`); }
      catch (err) { toast('Image paste failed: ' + err); }
    }
  }
  async function addImages(paths, field = lastField) {
    for (const p of paths.filter((x) => IMG_EXT.test(x))) {
      try { insertAt(field, `![](media/${await api.importMedia(p)})`); } catch (err) { toast('Image failed: ' + err); }
    }
  }
  async function pickImage(field) {
    const p = await open({ multiple: true, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }] });
    if (p) addImages(Array.isArray(p) ? p : [p], field);
  }
  onMount(() => { ctl.editorDropImages = (paths) => addImages(paths); return () => (ctl.editorDropImages = null); });

  // ---- cloze wrapping (Ctrl+Shift+C = new group, Ctrl+Shift+Alt+C = same group)
  function wrapCloze(same = false, numbered = true) {
    const ta = els.clozeText; if (!ta) return;
    const v = e.clozeText, a = ta.selectionStart, b = ta.selectionEnd;
    const groups = parseClozes(v).map((c) => c.group);
    const max = groups.length ? Math.max(...groups) : 0;
    const n = same ? Math.max(1, max) : max + 1;
    const sel = v.slice(a, b) || '…';
    const ins = numbered ? `{{${n}::${sel}}}` : `{{${sel}}}`;
    e.clozeText = v.slice(0, a) + ins + v.slice(b);
    queueMicrotask(() => { ta.focus(); const p = a + ins.length; ta.setSelectionRange(p, p); });
  }
  function clozeKey(ev) {
    if (ev.key.toLowerCase() === 'c' && (ev.ctrlKey || ev.metaKey) && ev.shiftKey) { ev.preventDefault(); wrapCloze(ev.altKey); }
  }
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
    if (e.a.card.type === 'cloze') for (const k of Object.keys(e.a.card.cs || {})) e.a.card.cs[k] = newSched();
    else e.a.card.s = newSched();
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
          <textarea class="ed" bind:this={first} bind:value={e.note} onfocus={() => (lastField = 'note')} onpaste={(ev) => { els.note = ev.currentTarget; onPaste(ev, 'note'); }} placeholder="Your thoughts. **bold**, *italic*, $LaTeX$."></textarea>
          <div class="preview md">{@html md(e.note)}</div>
        </div>
      </div>
      <div class="cardBox">
        <label class="toggle"><input type="checkbox" bind:checked={e.cardOn} /> Spaced-repetition card</label>
        {#if e.cardOn}
          <div class="sideSel">
            <div class="seg">
              <button class:on={e.type === 'basic'} onclick={() => (e.type = 'basic')}>Front / Back</button>
              <button class:on={e.type === 'cloze'} onclick={() => { e.type = 'cloze'; if (!e.clozeText && e.a.kind !== 'area') e.clozeText = e.quote; }}>Cloze</button>
            </div>
            {#if e.type === 'basic'}
              <span class="hint" style="margin-left:6px">Highlight on</span>
              <div class="seg">
                {#each [['front', 'Front'], ['back', 'Back'], ['none', 'Neither']] as [v, l]}
                  <button class:on={e.side === v} onclick={() => (e.side = v)}>{l}</button>
                {/each}
              </div>
              <button class="btn ghost" onclick={swap} title="Swap front and back">⇄ Swap</button>
            {/if}
          </div>
          {#if e.type === 'basic'}
            <div class="pair">
              <div class="side">
                <div class="sh"><span class="lbl">Front · prompt</span><button class="mini" title="Add image (or paste one)" onclick={() => pickImage('front')}><Icon name="image" size={15} /></button></div>
                {#if e.side === 'front'}<span class="slot">{slotText}</span>{/if}
                <textarea class="ed" bind:this={els.front} bind:value={e.front} onfocus={() => (lastField = 'front')} onpaste={(ev) => onPaste(ev, 'front')} placeholder="e.g. State the divergence theorem."></textarea>
                <div class="preview md" style="margin-top:6px">{@html md(e.front)}</div>
              </div>
              <div class="side">
                <div class="sh"><span class="lbl">Back · answer</span><button class="mini" title="Add image (or paste one)" onclick={() => pickImage('back')}><Icon name="image" size={15} /></button></div>
                {#if e.side === 'back'}<span class="slot">{slotText}</span>{/if}
                <textarea class="ed" bind:this={els.back} bind:value={e.back} onfocus={() => (lastField = 'back')} onpaste={(ev) => onPaste(ev, 'back')} placeholder={'e.g. $$\\iiint_V \\nabla\\cdot\\mathbf F\\,dV=\\oint_S \\mathbf F\\cdot d\\mathbf S$$'}></textarea>
                <div class="preview md" style="margin-top:6px">{@html md(e.back)}</div>
              </div>
            </div>
          {:else}
            <div class="side">
              <div class="sh">
                <span class="lbl">Text · wrap what to hide in {'{{'}double braces{'}}'}</span>
                <span class="sp"></span>
                <button class="btn ghost tb" title="New group: its own card (Ctrl+Shift+C)" onclick={() => wrapCloze(false)}>{'{{'}1::…{'}}'} new card</button>
                <button class="btn ghost tb" title="Same group as the last one (Ctrl+Shift+Alt+C)" onclick={() => wrapCloze(true)}>same card</button>
                <button class="mini" title="Add image (or paste one)" onclick={() => pickImage('clozeText')}><Icon name="image" size={15} /></button>
              </div>
              <textarea class="ed" rows="4" bind:this={els.clozeText} bind:value={e.clozeText} onfocus={() => (lastField = 'clozeText')} onkeydown={clozeKey} onpaste={(ev) => onPaste(ev, 'clozeText')}
                placeholder={'The hormone {{insulin}} is produced by the {{pancreas}}.\nOr separate cards: {{1::insulin}} … {{2::pancreas}}'}></textarea>
              <div class="preview md cz" style="margin-top:6px">{@html clozeHTML(e.clozeText, null)}</div>
              <div class="hint" style="margin-top:6px">
                {#if nCloze}Makes {nCloze} card{nCloze === 1 ? '' : 's'}.{:else}No clozes yet: select words and press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>.{/if}
                Unnumbered <code>{'{{…}}'}</code> are hidden together on one card; <code>{'{{1::…}}'}</code>, <code>{'{{2::…}}'}</code> each get their own card and schedule. Add a hint with <code>{'{{1::insulin::hormone}}'}</code>.
              </div>
            </div>
            <div class="side" style="margin-top:10px">
              <div class="sh"><span class="lbl">Extra · shown on the back</span><span class="sp"></span><button class="mini" title="Add image (or paste one)" onclick={() => pickImage('extra')}><Icon name="image" size={15} /></button></div>
              <textarea class="ed" bind:this={els.extra} bind:value={e.extra} onfocus={() => (lastField = 'extra')} onpaste={(ev) => onPaste(ev, 'extra')} placeholder="Optional: explanation, source, a diagram…"></textarea>
              {#if e.extra.trim()}<div class="preview md" style="margin-top:6px">{@html md(e.extra)}</div>{/if}
            </div>
          {/if}
          {#if s}
            <div class="hint" style="margin-top:8px">
              {#if s.state === 'new'}New card — not reviewed yet.{:else}Reviewed {s.reps}× · {s.lapses} lapse{s.lapses === 1 ? '' : 's'} · next {new Date(s.due).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{#if s.S != null} · stability {s.S.toFixed(1)}d · difficulty {s.D.toFixed(1)}{/if}{/if}
            </div>
          {:else if vs.length > 1}
            <div class="hint" style="margin-top:8px">{vs.length} cloze cards · {vs.filter((v) => v.s.state !== 'new').length} started</div>
          {/if}
        {/if}
      </div>
    </div>
    <footer>
      <button class="btn danger" onclick={del}>{e.isNew ? 'Discard' : 'Delete'}</button>
      {#if vs.some((v) => v.s.state !== 'new')}<button class="btn ghost" onclick={reset}>Reset progress</button>{/if}
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
  .sh{display:flex;align-items:center;gap:6px;margin-bottom:6px}
  .sh .lbl{margin:0}
  .mini{width:26px;height:24px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:var(--muted);margin-left:auto}
  .mini:hover{background:var(--hover);color:var(--ink)}
  .tb{padding:3px 8px;font-size:12px;font-family:ui-monospace,Consolas,monospace}
  .slot{font-size:12px;color:var(--accent);background:var(--accent-soft);border-radius:5px;padding:2px 7px;margin-bottom:6px;display:inline-block}
</style>
