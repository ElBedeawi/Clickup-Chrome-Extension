// Small inline SVG icon set (24×24, 2px strokes, currentColor). Use `icon(name)` for markup,
// or put <span data-icon="name"></span> in HTML and call `hydrateIcons()`.

const PATHS = {
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  window: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/>',
  tab: '<rect x="2" y="5" width="20" height="15" rx="2"/><path d="M2 9h8V5"/>',
  shrink: '<path d="m15 15 6 6M15 21v-6h6M9 9 3 3M9 3v6H3M15 9l6-6M15 3v6h6M9 15l-6 6M3 15h6v6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
  micOff:
    '<path d="m2 2 20 20M18.9 13.4A7 7 0 0 0 19 11v-1M5 10v1a7 7 0 0 0 11.1 5.7M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M12 18v4"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3.5v11L16 14"/>',
  camera:
    '<path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="3.5"/>',
  paperclip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  // Description editor toolbar
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  listOrdered: '<path d="M10 6h11M10 12h11M10 18h11M4 4h1v5M4 9h2M6 19H4c0-1 2-1.5 2-3s-2-1.5-2-.5"/>',
  listChecks: '<path d="m3 6 2 2 3-3M3 17l2 2 3-3M12 6h9M12 12h9M12 18h9"/>',
  quote: '<path d="M17 6H3M21 12H8M21 18H8M3 12v6"/>',
  codeBlock: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 9-3 3 3 3M14 15l3-3-3-3"/>',
  minus: '<path d="M4 12h16"/>',
  clearFormat: '<path d="M4 7V4h16v3M9 20h4M13 4 9 20M15 15l5 5M20 15l-5 5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
};

export function icon(name, size = 16) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16);
  });
}
