import { createRoot } from "react-dom/client"
import { ChatApp } from "./chat/ChatApp.tsx"
import { asSnapshot, initialSnapshot } from "./contract.ts"
import type { CodemUiHost, MountHandle } from "./host.ts"

/**
 * 首屏在挂载前就按 initialSnapshot 画好：分页/重试/恢复默认隐藏。
 * 产品壳：登录 / 欢迎 / composer。分页、重试、恢复在 initialSnapshot 上默认隐藏。
 */
export function mountCodemUi(root: HTMLElement, host: CodemUiHost): MountHandle {
  const initial = asSnapshot(host.getState()) ?? initialSnapshot()
  root.replaceChildren()
  root.dataset.codemUi = "shell"
  const reactRoot = createRoot(root)
  reactRoot.render(<ChatApp host={host} initial={initial} />)
  host.postAction({ type: "ready" })
  return {
    dispose() {
      reactRoot.unmount()
      root.replaceChildren()
    },
  }
}
