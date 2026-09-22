import type { AppServerHost, AppServerModeState } from "@codem/app-server"

export async function enterPlanMode(
  host: AppServerHost, cwd: string, threadId: string,
  displayedState: AppServerModeState,
) {
  return host.setModes({
    cwd, threadId,
    expectedRevision: displayedState.revision,
    workMode: "plan",
  })
}
// displayedState 来自用户实际看到的 readModes / 模式事件。
// 冲突时展示最新状态，让用户重新决定，不自动覆盖。
