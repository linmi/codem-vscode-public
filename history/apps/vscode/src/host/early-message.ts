import * as ModelState from "./model-state"
import { routeAutocompleteMessage } from "../services/autocomplete/settings"
import type { KiloClient } from "../services/cli-backend/leftover-sdk"
import { buildChatSettingsMessage } from "./chat-settings"
import { buildThroughputSettingMessage } from "./throughput-settings"
import { buildAutoApprovalReasonSettingMessage } from "./auto-approval-reason-settings"
import { handleModelUsageMessage, type ModelUsageMessage } from "./model-usage"

type Ctx = {
  client: KiloClient | null
  post: (msg: unknown) => void
  browserSettings: () => void
  exportTranscript: (sessionID: string) => Promise<void>
  copy: (text: string) => PromiseLike<void>
  openSessions: (ids: string[]) => void
  activity: (state: unknown) => void
  modelUsage: (message: ModelUsageMessage) => Promise<void>
  backgroundJobs: (sessionID: string, requestID: string) => Promise<void>
  board: (message: Record<string, unknown>) => Promise<boolean>
  cancelBackgroundJob: (jobID: string, sessionID: string, requestID: string) => Promise<void>
  caffeination: () => void
}

async function routeBackgroundMessage(
  message: { type: string; sessionID?: unknown; jobID?: unknown; requestID?: unknown },
  ctx: Ctx,
): Promise<boolean | undefined> {
  if (message.type === "toggleCaffeination") {
    ctx.caffeination()
    return true
  }
  if (message.type === "requestSessionBoard" || message.type === "resetSessionBoard") return ctx.board(message)
  if (message.type === "requestBackgroundJobs") {
    if (typeof message.sessionID === "string" && typeof message.requestID === "string") {
      await ctx.backgroundJobs(message.sessionID, message.requestID)
    }
    return true
  }
  if (message.type === "cancelBackgroundJob") {
    if (
      typeof message.jobID === "string" &&
      typeof message.sessionID === "string" &&
      typeof message.requestID === "string"
    ) {
      await ctx.cancelBackgroundJob(message.jobID, message.sessionID, message.requestID)
    }
    return true
  }
  return undefined
}

export async function routeEarlyMessage(
  message: { type: string; id?: unknown; text?: unknown; state?: unknown },
  ctx: Ctx,
): Promise<boolean> {
  if (message.type === "copyToClipboard") {
    if (typeof message.id !== "string") return true
    if (typeof message.text !== "string") {
      ctx.post({ type: "clipboardWriteResult", id: message.id, ok: false, error: "Invalid clipboard text" })
      return true
    }
    await ctx.copy(message.text).then(
      () => ctx.post({ type: "clipboardWriteResult", id: message.id, ok: true }),
      (err) =>
        ctx.post({
          type: "clipboardWriteResult",
          id: message.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
    )
    return true
  }
  if (message.type === "recordModelUsage" || message.type === "requestModelUsage") {
    await ctx.modelUsage(message as ModelUsageMessage)
    return true
  }
  if (await ModelState.handleMessage(message.type, message, ctx.client, ctx.post)) return true
  if (message.type === "exportSessionTranscript") {
    const input = message as { sessionID?: unknown }
    if (typeof input.sessionID === "string") await ctx.exportTranscript(input.sessionID)
    return true
  }
  if (message.type === "sessionActivity") {
    ctx.activity(message.state)
    return true
  }
  if (message.type === "sidebar.openSessions") {
    const input = message as { sessionIDs?: unknown }
    const ids = Array.isArray(input.sessionIDs)
      ? input.sessionIDs.filter((id): id is string => typeof id === "string")
      : []
    ctx.openSessions(ids)
    return true
  }
  if (message.type === "requestChatSettings") {
    ctx.post(buildChatSettingsMessage())
    return true
  }
  if (message.type === "requestThroughputSetting") {
    ctx.post(buildThroughputSettingMessage())
    return true
  }
  if (message.type === "requestAutoApprovalReasonSetting") {
    ctx.post(buildAutoApprovalReasonSettingMessage())
    return true
  }
  if (message.type === "requestBrowserSettings") {
    ctx.browserSettings()
    return true
  }
  const background = await routeBackgroundMessage(message, ctx)
  return background ?? (await routeAutocompleteMessage(message, ctx.post))
}
