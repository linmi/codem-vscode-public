import type { DesktopTheme } from "./types"
import { DEFAULT_THEMES as UPSTREAM_THEMES } from "./opencode-default-themes"
import desktopJson from "./themes/desktop.json"
import codemVscodeJson from "./themes/codem-vscode.json"

// Re-export all upstream theme constants
export {
  oc2Theme,
  tokyonightTheme,
  draculaTheme,
  monokaiTheme,
  solarizedTheme,
  nordTheme,
  catppuccinTheme,
  ayuTheme,
  oneDarkProTheme,
  shadesOfPurpleTheme,
  nightowlTheme,
  vesperTheme,
  carbonfoxTheme,
  gruvboxTheme,
  auraTheme,
} from "./opencode-default-themes"

export const desktopTheme = desktopJson as DesktopTheme
export const codemVscodeTheme = codemVscodeJson as DesktopTheme

export const CODEM_THEMES: Record<string, DesktopTheme> = {
  "codem-vscode": codemVscodeTheme,
}

export const DESKTOP_THEMES: Record<string, DesktopTheme> = {
  codem: desktopTheme,
}

// CodeM's VS Code bridge is the editor theme; the desktop theme is the
// default for Console and Storybook.
export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  ...CODEM_THEMES,
  ...DESKTOP_THEMES,
  ...UPSTREAM_THEMES,
}
