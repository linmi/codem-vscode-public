/** Static, shared Webview icons. Never interpolate model or workspace content here. */
const paths = {
  space: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  effort: '<path stroke-width="3" d="M4 19v-1m4 1v-4m4 4v-7m4 7V9m4 10V5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c6 5 6 13 0 18-6-5-6-13 0-18"/>',
  plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0zm6 9v4"/>',
  tool: '<path d="m14 5 5 5m-7-7a6 6 0 0 0-7 8l-3 7 4 4 7-7a6 6 0 0 0 8-7l-5 4-4-4z"/>',
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
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 4-3 7-7 7-3 0-5-2-7-5l-3-4a1.7 1.7 0 0 1 2.5-2z"/>',
  shieldCheck: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  shieldAlert: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M12 8v5m0 3h.01"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>',
  file: '<path d="M14 3H5v18h14V8zm0 0v5h5M8 12h8m-8 4h6"/>',
  thought: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>',
} as const

export function uiIcon(name: keyof typeof paths): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`
}

export const permissionIcons = { default: "hand", auto: "shieldCheck", yolo: "shieldAlert" } as const
