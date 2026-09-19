/** Static, shared Webview icons. Never interpolate model or workspace content here. */
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowUp: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7m2-5v6l4 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M15 3v18"/>',
  terminal: '<path d="m5 6 6 6-6 6m8 0h6"/>',
  folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>',
  file: '<path d="M14 3H5v18h14V8zm0 0v5h5M8 12h8m-8 4h6"/>',
  thought: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>',
} as const

export function uiIcon(name: keyof typeof paths): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`
}
