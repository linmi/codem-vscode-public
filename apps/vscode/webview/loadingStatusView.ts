import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { LoadingState } from "./components/loadingState.tsx"

/** One React island per visible indicator; deltas do not restart its animation. */
export function createLoadingStatus(host: HTMLElement) {
  let root: Root | null = null
  let previous = ""
  function dispose() { root?.unmount(); root = null; previous = "" }
  return {
    set(label: string | null, animate = true) {
      if (label === null) { dispose(); return }
      const key = JSON.stringify([label, animate])
      if (previous === key) return
      previous = key
      root ??= createRoot(host)
      root.render(createElement(LoadingState, { label, animate }))
    },
    dispose,
  }
}
