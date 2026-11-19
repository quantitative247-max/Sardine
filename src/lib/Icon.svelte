<script>
  let { name, size = 20, fill = 'none', style = '' } = $props();
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
    library: '<path d="M5 4v16M9.5 4v16M14 5l4.5 15"/>',
    bookmark: '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>',
    highlighter: '<path d="M9 11l-5.5 5.5V20h7.5l2.5-2.5"/><path d="M20.5 9.5l-5 5a1.8 1.8 0 0 1-2.5 0L9.5 11a1.8 1.8 0 0 1 0-2.5l5-5"/>',
    crop: '<path d="M6 2.5V16a2 2 0 0 0 2 2h13.5"/><path d="M18 21.5V8a2 2 0 0 0-2-2H2.5"/>',
    cards: '<rect x="3" y="7" width="13" height="14" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v12"/>',
    review: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M10.5 9l4.5 3-4.5 3z"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6"/>',
    pen: '<path d="M12 20h8.5"/><path d="M16.5 3.6a2.1 2.1 0 0 1 3 3L7.5 18.6 3.5 19.5l.9-4z"/>',
    'chev-left': '<path d="M15 18l-6-6 6-6"/>', 'chev-right': '<path d="M9 18l6-6-6-6"/>',
    'chevs-left': '<path d="M11.5 17l-5-5 5-5M18 17l-5-5 5-5"/>', 'chevs-right': '<path d="M12.5 17l5-5-5-5M6 17l5-5-5-5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    book: '<path d="M2.5 5.5c2.5-1 6-1 9.5 1 3.5-2 7-2 9.5-1V19c-2.5-1-6-1-9.5 1-3.5-2-7-2-9.5-1z"/><path d="M12 6.5V20"/>',
    caret: '<path d="M8 5l9 7-9 7z" fill="currentColor" stroke="none"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/>',
    brackets: '<path d="M8 4H6a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-2"/>',
    folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  };
</script>

<svg class="ic" viewBox="0 0 24 24" width={size} height={size} style="fill:{fill};{style}" aria-hidden="true">{@html P[name] || ''}</svg>
