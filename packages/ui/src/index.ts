//
// @codem/ui
//
// Solid design-system for CodeM editor webviews. OpenCode primitives live in
// this package; CodeM overlays (message-part, theme, overlay CSS) win on conflict.
//
// Two themes are provided:
// - codem:        For web/desktop (light + dark variants) [DEFAULT]
// - codem-vscode: For the CodeM VS Code extension (adapts to the user's VS Code theme)

export { CODEM_THEMES, DESKTOP_THEMES, codemVscodeTheme, desktopTheme } from "./theme/default-themes"

export type { DesktopTheme } from "./theme/types"
