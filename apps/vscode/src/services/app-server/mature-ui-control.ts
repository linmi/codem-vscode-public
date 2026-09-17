import type {
  AppServerBackgroundTerminalClean,
  AppServerBackgroundTerminalList,
  AppServerConfigSnapshot,
  AppServerEnvironmentInfo,
  AppServerHookList,
  AppServerLoadedThreads,
  AppServerModelProviderCapabilities,
  AppServerPermissionProfile,
  AppServerPluginList,
  AppServerToolList,
} from "@codem/app-server"
import type { ExtensionMessage } from "../../../webview-ui/src/types/messages/extension-messages"
import type { WebviewMessage } from "../../../webview-ui/src/types/messages/webview-messages"
import {
  controlResultMessage,
  copyBackgroundTerminalClean,
  copyBackgroundTerminals,
  copyConfigSnapshot,
  copyEnvironmentInfo,
  copyHookList,
  copyLoadedThreads,
  copyModelProviderCapabilities,
  copyPermissionProfiles,
  copyPluginList,
  copyToolList,
} from "./codem-webview-dto.ts"

/** Host 已有、本 Cycle 新接到 Webview 的 CodeM 命令。不复用 Kilo requestConfig / clearSession / revertSession。 */
export const APP_SERVER_CONTROL_UI_COMMANDS = [
  "archiveThread",
  "cancelSideQuestion",
  "cleanBackgroundTerminals",
  "clearThread",
  "requestBackgroundTerminals",
  "requestConfigSnapshot",
  "requestEnvironmentInfo",
  "requestHooks",
  "requestLoadedThreadIds",
  "requestModelProviderCapabilities",
  "requestPermissionProfiles",
  "requestPlugins",
  "requestTools",
  "rewindThread",
  "runShellCommand",
  "terminateBackgroundTerminal",
  "unarchiveThread",
] as const

export type ControlUiCommand = (typeof APP_SERVER_CONTROL_UI_COMMANDS)[number]

export function isControlUiCommand(type: WebviewMessage["type"]): type is ControlUiCommand {
  return (APP_SERVER_CONTROL_UI_COMMANDS as readonly string[]).includes(type)
}

export interface ControlPlaneService {
  rewindThread(cwd: string, threadId: string): Promise<string>
  archiveThread(cwd: string, threadId: string): Promise<void>
  unarchiveThread(cwd: string, threadId: string): Promise<void>
  clearThread(cwd: string, threadId: string, operationId: string): Promise<void>
  listLoadedThreadIds(cwd: string): Promise<AppServerLoadedThreads>
  listHooks(cwd: string): Promise<AppServerHookList>
  listPlugins(cwd: string): Promise<AppServerPluginList>
  listTools(cwd: string, threadId: string): Promise<AppServerToolList>
  readEnvironmentInfo(cwd: string): Promise<AppServerEnvironmentInfo>
  readConfigSnapshot(cwd: string): Promise<AppServerConfigSnapshot>
  listPermissionProfiles(cwd: string): Promise<readonly AppServerPermissionProfile[]>
  readModelProviderCapabilities(cwd: string): Promise<AppServerModelProviderCapabilities>
  listBackgroundTerminals(cwd: string, threadId: string): Promise<AppServerBackgroundTerminalList>
  terminateBackgroundTerminal(cwd: string, threadId: string, processId: number): Promise<void>
  cleanBackgroundTerminals(cwd: string, threadId: string): Promise<AppServerBackgroundTerminalClean>
  runShellCommand(cwd: string, threadId: string, command: string): Promise<void>
  cancelSideQuestion(cwd: string, threadId: string, sideQuestionId: string): Promise<void>
}

export interface ControlPlaneContext {
  readonly service: ControlPlaneService
  readonly cwdForThread: (threadId?: string) => string
  readonly currentThreadId: () => string | null
  readonly loadedThreads: Set<string>
  readonly ensureLoaded: (cwd: string, threadId: string) => Promise<void>
  readonly forgetLoaded: (threadId: string) => void
  readonly post: (message: ExtensionMessage) => void
}

/**
 * 控制面命令：白名单拷贝 + 线程归属校验 + fail-closed 结果。
 * enhancePrompt 的 side question 也在这里对账，供 cancelSideQuestion 使用。
 */
export class MatureUiControlPlane {
  private readonly ctx: ControlPlaneContext
  private readonly sideQuestions = new Map<
    string,
    { readonly threadId: string; sideQuestionId: string | null; cancelled: boolean }
  >()

  constructor(ctx: ControlPlaneContext) {
    this.ctx = ctx
  }

  rememberSideQuestion(requestId: string, threadId: string): { cancelled: boolean; sideQuestionId: string | null } {
    const pending = { threadId, sideQuestionId: null as string | null, cancelled: false }
    this.sideQuestions.set(requestId, pending)
    return pending
  }

  /** 可按 enhance requestId 或 Core sideQuestionId 忘记对账。 */
  forgetSideQuestion(id: string): void {
    if (this.sideQuestions.delete(id)) return
    for (const [requestId, pending] of this.sideQuestions) {
      if (pending.sideQuestionId === id) this.sideQuestions.delete(requestId)
    }
  }

  forgetThread(threadId: string): void {
    for (const [requestId, pending] of this.sideQuestions) {
      if (pending.threadId === threadId) this.sideQuestions.delete(requestId)
    }
  }

  async handle(message: Extract<WebviewMessage, { readonly type: ControlUiCommand }>): Promise<void> {
    switch (message.type) {
      case "rewindThread":
        return this.rewindThread(message.sessionID, message.requestID)
      case "archiveThread":
        return this.archiveThread(message.sessionID, message.requestID)
      case "unarchiveThread":
        return this.unarchiveThread(message.sessionID, message.requestID)
      case "clearThread":
        return this.clearThread(message.sessionID, message.requestID)
      case "requestLoadedThreadIds":
        return this.requestLoadedThreadIds(message.requestID)
      case "requestHooks":
        return this.requestHooks(message.requestID)
      case "requestPlugins":
        return this.requestPlugins(message.requestID)
      case "requestTools":
        return this.requestTools(message.sessionID, message.requestID)
      case "requestEnvironmentInfo":
        return this.requestEnvironmentInfo(message.requestID)
      case "requestConfigSnapshot":
        return this.requestConfigSnapshot(message.requestID)
      case "requestPermissionProfiles":
        return this.requestPermissionProfiles(message.requestID)
      case "requestModelProviderCapabilities":
        return this.requestModelProviderCapabilities(message.requestID)
      case "requestBackgroundTerminals":
        return this.requestBackgroundTerminals(message.sessionID, message.requestID)
      case "terminateBackgroundTerminal":
        return this.terminateBackgroundTerminal(message.sessionID, message.requestID, message.processId)
      case "cleanBackgroundTerminals":
        return this.cleanBackgroundTerminals(message.sessionID, message.requestID)
      case "runShellCommand":
        return this.runShellCommand(message.sessionID, message.requestID, message.command)
      case "cancelSideQuestion":
        return this.cancelSideQuestion(message.sessionID, message.requestID)
    }
  }

  failure(message: Extract<WebviewMessage, { readonly type: ControlUiCommand }>, error: string): ExtensionMessage {
    const requestID = message.requestID
    const sessionID = "sessionID" in message ? message.sessionID : undefined
    const result = { error }
    switch (message.type) {
      case "rewindThread":
        return { type: "rewindThreadResult", sessionID: sessionID!, requestID, result }
      case "archiveThread":
        return { type: "archiveThreadResult", sessionID: sessionID!, requestID, result }
      case "unarchiveThread":
        return { type: "unarchiveThreadResult", sessionID: sessionID!, requestID, result }
      case "clearThread":
        return { type: "clearThreadResult", sessionID: sessionID!, requestID, result }
      case "requestLoadedThreadIds":
        return { type: "loadedThreadIdsLoaded", requestID, result }
      case "requestHooks":
        return { type: "hooksLoaded", requestID, result }
      case "requestPlugins":
        return { type: "pluginsLoaded", requestID, result }
      case "requestTools":
        return { type: "toolsLoaded", sessionID: sessionID!, requestID, result }
      case "requestEnvironmentInfo":
        return { type: "environmentInfoLoaded", requestID, result }
      case "requestConfigSnapshot":
        return { type: "configSnapshotLoaded", requestID, result }
      case "requestPermissionProfiles":
        return { type: "permissionProfilesLoaded", requestID, result }
      case "requestModelProviderCapabilities":
        return { type: "modelProviderCapabilitiesLoaded", requestID, result }
      case "requestBackgroundTerminals":
        return { type: "backgroundTerminalsLoaded", sessionID: sessionID!, requestID, result }
      case "terminateBackgroundTerminal":
        return { type: "terminateBackgroundTerminalResult", sessionID: sessionID!, requestID, result }
      case "cleanBackgroundTerminals":
        return { type: "cleanBackgroundTerminalsResult", sessionID: sessionID!, requestID, result }
      case "runShellCommand":
        return { type: "runShellCommandResult", sessionID: sessionID!, requestID, result }
      case "cancelSideQuestion":
        return { type: "cancelSideQuestionResult", sessionID: sessionID!, requestID, result }
    }
  }

  private async rewindThread(threadId: string, requestId: string): Promise<void> {
    const sessionID = exactId(threadId, "rewindThread sessionID")
    const requestID = exactId(requestId, "rewindThread requestID")
    const cwd = this.ctx.cwdForThread(sessionID)
    await this.ctx.ensureLoaded(cwd, sessionID)
    const turnId = await this.ctx.service.rewindThread(cwd, sessionID)
    this.ctx.post(controlResultMessage("rewindThreadResult", requestID, { turnId }, sessionID))
  }

  private async archiveThread(threadId: string, requestId: string): Promise<void> {
    const sessionID = exactId(threadId, "archiveThread sessionID")
    const requestID = exactId(requestId, "archiveThread requestID")
    const cwd = this.ctx.cwdForThread(sessionID)
    await this.ctx.service.archiveThread(cwd, sessionID)
    this.ctx.forgetLoaded(sessionID)
    this.ctx.post({ type: "sessionUpdated", session: { id: sessionID, archived: true } })
    this.ctx.post(controlResultMessage("archiveThreadResult", requestID, { archived: true }, sessionID))
  }

  private async unarchiveThread(threadId: string, requestId: string): Promise<void> {
    const sessionID = exactId(threadId, "unarchiveThread sessionID")
    const requestID = exactId(requestId, "unarchiveThread requestID")
    const cwd = this.ctx.cwdForThread(sessionID)
    await this.ctx.service.unarchiveThread(cwd, sessionID)
    this.ctx.post({ type: "sessionUpdated", session: { id: sessionID, archived: false } })
    this.ctx.post(controlResultMessage("unarchiveThreadResult", requestID, { archived: false }, sessionID))
  }

  /** thread/clear，不是 Webview clearSession。 */
  private async clearThread(threadId: string, requestId: string): Promise<void> {
    const sessionID = exactId(threadId, "clearThread sessionID")
    const requestID = exactId(requestId, "clearThread requestID")
    const cwd = this.ctx.cwdForThread(sessionID)
    await this.ctx.service.clearThread(cwd, sessionID, requestID)
    this.ctx.post(controlResultMessage("clearThreadResult", requestID, { cleared: true }, sessionID))
  }

  private async requestLoadedThreadIds(requestId: string): Promise<void> {
    const requestID = exactId(requestId, "requestLoadedThreadIds requestID")
    const cwd = this.ctx.cwdForThread(this.ctx.currentThreadId() ?? undefined)
    this.ctx.post(
      controlResultMessage("loadedThreadIdsLoaded", requestID, copyLoadedThreads(await this.ctx.service.listLoadedThreadIds(cwd))),
    )
  }

  private async requestHooks(requestId: string): Promise<void> {
    const requestID = exactId(requestId, "requestHooks requestID")
    const cwd = this.ctx.cwdForThread(this.ctx.currentThreadId() ?? undefined)
    this.ctx.post(controlResultMessage("hooksLoaded", requestID, copyHookList(await this.ctx.service.listHooks(cwd))))
  }

  private async requestPlugins(requestId: string): Promise<void> {
    const requestID = exactId(requestId, "requestPlugins requestID")
    const cwd = this.ctx.cwdForThread(this.ctx.currentThreadId() ?? undefined)
    this.ctx.post(controlResultMessage("pluginsLoaded", requestID, copyPluginList(await this.ctx.service.listPlugins(cwd))))
  }

  private async requestTools(threadId: string, requestId: string): Promise<void> {
    const sessionID = exactId(threadId, "requestTools sessionID")
    const requestID = exactId(requestId, "requestTools requestID")
    const cwd = this.ctx.cwdForThread(sessionID)
    await this.ctx.ensureLoaded(cwd, sessionID)
    this.ctx.post(
      controlResultMessage("toolsLoaded", requestID, copyToolList(await this.ctx.service.listTools(cwd, sessionID)), sessionID),
    )
  }

  private async requestEnvironmentInfo(requestId: string): Promise<void> {
    const requestID = exactId(requestId, "requestEnvironmentInfo requestID")
    const cwd = this.ctx.cwdForThread(this.ctx.currentThreadId() ?? undefined)
    this.ctx.post(
      controlResultMessage("environmentInfoLoaded", requestID, copyEnvironmentInfo(await this.ctx.service.readEnvironmentInfo(cwd))),
    )
  }

  /** 去密钥快照，不是 Kilo requestConfig / configLoaded。 */
  private async requestConfigSnapshot(requestId: string): Promise<void> {
    const requestID = exactId(requestId, "requestConfigSnapshot requestID")
    const cwd = this.ctx.cwdForThread(this.ctx.currentThreadId() ?? undefined)
    this.ctx.post(
      controlResultMessage("configSnapshotLoaded", requestID, copyConfigSnapshot(await this.ctx.service.readConfigSnapshot(cwd))),
    )
  }

  private async requestPermissionProfiles(requestId: string): Promise<void> {
    const requestID = exactId(requestId, "requestPermissionProfiles requestID")
    const cwd = this.ctx.cwdForThread(this.ctx.currentThreadId() ?? undefined)
    this.ctx.post(
      controlResultMessage("permissionProfilesLoaded", requestID, {
        profiles: copyPermissionProfiles(await this.ctx.service.listPermissionProfiles(cwd)),
      }),
    )
  }

  private async requestModelProviderCapabilities(requestId: string): Promise<void> {
    const requestID = exactId(requestId, "requestModelProviderCapabilities requestID")
    const cwd = this.ctx.cwdForThread(this.ctx.currentThreadId() ?? undefined)
    this.ctx.post(
      controlResultMessage(
        "modelProviderCapabilitiesLoaded",
        requestID,
        copyModelProviderCapabilities(await this.ctx.service.readModelProviderCapabilities(cwd)),
      ),
    )
  }

  private async requestBackgroundTerminals(threadId: string, requestId: string): Promise<void> {
    const sessionID = exactId(threadId, "requestBackgroundTerminals sessionID")
    const requestID = exactId(requestId, "requestBackgroundTerminals requestID")
    const cwd = this.ctx.cwdForThread(sessionID)
    await this.ctx.ensureLoaded(cwd, sessionID)
    this.ctx.post(
      controlResultMessage(
        "backgroundTerminalsLoaded",
        requestID,
        copyBackgroundTerminals(await this.ctx.service.listBackgroundTerminals(cwd, sessionID)),
        sessionID,
      ),
    )
  }

  private async terminateBackgroundTerminal(threadId: string, requestId: string, processId: number): Promise<void> {
    const sessionID = exactId(threadId, "terminateBackgroundTerminal sessionID")
    const requestID = exactId(requestId, "terminateBackgroundTerminal requestID")
    const pid = requireProcessId(processId)
    this.requireLoaded(sessionID)
    const cwd = this.ctx.cwdForThread(sessionID)
    await this.ctx.service.terminateBackgroundTerminal(cwd, sessionID, pid)
    this.ctx.post(controlResultMessage("terminateBackgroundTerminalResult", requestID, { processId: pid }, sessionID))
  }

  private async cleanBackgroundTerminals(threadId: string, requestId: string): Promise<void> {
    const sessionID = exactId(threadId, "cleanBackgroundTerminals sessionID")
    const requestID = exactId(requestId, "cleanBackgroundTerminals requestID")
    this.requireLoaded(sessionID)
    const cwd = this.ctx.cwdForThread(sessionID)
    this.ctx.post(
      controlResultMessage(
        "cleanBackgroundTerminalsResult",
        requestID,
        copyBackgroundTerminalClean(await this.ctx.service.cleanBackgroundTerminals(cwd, sessionID)),
        sessionID,
      ),
    )
  }

  /** 必须已由本控制器加载该线程，禁止仅凭 threadId 对未归属会话发 shell。 */
  private async runShellCommand(threadId: string, requestId: string, command: string): Promise<void> {
    const sessionID = exactId(threadId, "runShellCommand sessionID")
    const requestID = exactId(requestId, "runShellCommand requestID")
    const text = exactId(command, "runShellCommand command")
    this.requireLoaded(sessionID)
    const cwd = this.ctx.cwdForThread(sessionID)
    await this.ctx.service.runShellCommand(cwd, sessionID, text)
    this.ctx.post(controlResultMessage("runShellCommandResult", requestID, { ran: true }, sessionID))
  }

  private async cancelSideQuestion(threadId: string, requestId: string): Promise<void> {
    const requestID = exactId(requestId, "cancelSideQuestion requestID")
    const sessionID = exactId(threadId, "cancelSideQuestion sessionID")
    const pending = this.sideQuestions.get(requestID)
    if (!pending || pending.threadId !== sessionID) {
      throw new Error(`CodeM side question ${requestID} is not active on thread ${sessionID}`)
    }
    pending.cancelled = true
    if (pending.sideQuestionId) {
      const cwd = this.ctx.cwdForThread(sessionID)
      await this.ctx.service.cancelSideQuestion(cwd, sessionID, pending.sideQuestionId)
    }
    this.ctx.post(controlResultMessage("cancelSideQuestionResult", requestID, { cancelled: true }, sessionID))
  }

  private requireLoaded(threadId: string): void {
    if (!this.ctx.loadedThreads.has(threadId)) {
      throw new Error(`CodeM thread ${threadId} is not loaded in this editor`)
    }
  }
}

function exactId(value: string, label: string): string {
  if (!value.trim() || value !== value.trim()) throw new Error(`Invalid CodeM ${label}`)
  return value
}

function requireProcessId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("CodeM processId must be a positive integer")
  return value
}
