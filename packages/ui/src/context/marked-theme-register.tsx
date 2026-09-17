import { registerCustomTheme } from "@pierre/diffs"
import { OpenCodeTheme } from "./marked-theme"
import { DIFF_THEME } from "../pierre/diff-theme"

let registered = false

export function registerOpenCodeTheme() {
  if (registered) return
  registered = true
  registerCustomTheme(DIFF_THEME, () => Promise.resolve(OpenCodeTheme))
}
