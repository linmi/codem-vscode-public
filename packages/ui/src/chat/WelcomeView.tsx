import { useRef } from "react"
import type { ChatPhase } from "../contract.ts"
import { welcomeState, type WelcomeMotion } from "./welcomeState.ts"

/**
 * 对照 VS Code welcomeView：codemMark 七分块 +「我们一起做点什么？」。
 * connecting 播同款动效；未 ready 不露欢迎标题，但必须露出「正在连接」。
 */
export function WelcomeView({
  phase,
  hasMessages,
  hasWorkingStatus,
  brandMark,
}: {
  phase: ChatPhase
  hasMessages: boolean
  hasWorkingStatus: boolean
  brandMark: string | null
}) {
  const previous = useRef<WelcomeMotion>("idle")
  const next = welcomeState(phase, hasMessages, hasWorkingStatus, previous.current)
  previous.current = next.motion
  if (!next.visible) return null
  return (
    <section className="welcome" id="welcome" data-testid="welcome" data-motion={next.motion} aria-label="CodeM" aria-busy={next.motion === "initializing"}>
      {brandMark ? (
        <span className="brandMark welcomeMark" role="img" aria-label="CodeM">
          {Array.from({ length: 7 }, (_, index) => (
            <img key={index} className="welcomePixel" src={brandMark} alt="" aria-hidden="true" width="40" height="40" />
          ))}
        </span>
      ) : null}
      <h1 id="welcomeTitle">我们一起做点什么？</h1>
      <span className="visuallyHidden" role="status">{next.motion === "initializing" ? "正在初始化 CodeM…" : next.motion === "settled" ? "初始化完成" : ""}</span>
    </section>
  )
}
