import type { DesktopTheme } from "@opencode-ai/ui/theme/types"
import { DEFAULT_THEMES as UPSTREAM_THEMES } from "@opencode-ai/ui/theme/default-themes"
import kiloJson from "./themes/kilo.json"
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
} from "@opencode-ai/ui/theme/default-themes"

export const kiloTheme = kiloJson as DesktopTheme
export const codemVscodeTheme = codemVscodeJson as DesktopTheme

export const CODEM_THEMES: Record<string, DesktopTheme> = {
  "codem-vscode": codemVscodeTheme,
}

export const KILO_THEMES: Record<string, DesktopTheme> = {
  kilo: kiloTheme,
}

// CodeM's VS Code bridge is the editor theme; the retained Kilo theme remains
// available only for legacy web/desktop consumers.
export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  ...CODEM_THEMES,
  ...KILO_THEMES,
  ...UPSTREAM_THEMES,
}
