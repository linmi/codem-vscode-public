import { createRoot } from "react-dom/client"
import type { ChatPhase } from "../../src/shared/messages.ts"
import { welcomeState, type WelcomeMotion } from "./welcomeState.ts"

/** Welcome motion follows Host state; no timers, connection requests or persisted animation state. */
export function createWelcomeView(host: HTMLElement) {
  const logo = host.querySelector("img")?.getAttribute("src")
  if (!logo) throw new Error("Missing welcome logo")
  const root = createRoot(host)
  let motion: WelcomeMotion = "idle"
  let rendered = false
  return (phase: ChatPhase, hasMessages: boolean, hasWorkingStatus: boolean): boolean => {
    const { visible, motion: next } = welcomeState(phase, hasMessages, hasWorkingStatus, motion)
    host.hidden = !visible
    host.dataset.motion = next
    host.setAttribute("aria-busy", String(next === "initializing"))
    if (!rendered || next !== motion) {
      rendered = true
      motion = next
      root.render(<>
        <span className="brandMark welcomeMark" role="img" aria-label="CodeM">
          {Array.from({ length: 7 }, (_, index) => <img key={index} className="welcomePixel" src={logo} alt="" aria-hidden="true" width="40" height="40" />)}
        </span>
        <h1 id="welcomeTitle">我们一起做点什么？</h1>
        <span className="visuallyHidden" role="status">{next === "initializing" ? "正在初始化 CodeM…" : next === "settled" ? "初始化完成" : ""}</span>
      </>)
    }
    return next === "initializing"
  }
}
