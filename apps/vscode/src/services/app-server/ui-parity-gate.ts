import { APP_SERVER_MATURE_UI_COMMANDS } from "./mature-ui-controller.ts"
import { CODEM_UI_INTERACTION_OWNERS } from "./ui-parity.ts"

export const APP_SERVER_V1_PROTOCOL_GAPS = {
  authenticateMcp: "Core v1 accepts MCP launch settings but has no MCP authentication control method.",
  authorizeProviderOAuth: "Core v1 model/list is read-only and exposes no provider OAuth flow.",
  completeProviderOAuth: "Core v1 model/list is read-only and exposes no provider OAuth completion method.",
  connectMcp: "Core v1 accepts MCP launch settings but has no mutable MCP connection method.",
  connectProvider: "Core v1 model/list is read-only and exposes no provider connection method.",
  deleteMessage: "Core v1 has no message-scoped delete operation.",
  disconnectMcp: "Core v1 accepts MCP launch settings but has no mutable MCP disconnection method.",
  disconnectProvider: "Core v1 model/list is read-only and exposes no provider disconnection method.",
  fetchCustomProviderModels: "Core v1 model/list has no custom-provider credential or discovery request.",
  memoryOperation: "Core v1 exposes no memory mutation method.",
  memoryShow: "Core v1 exposes no memory presentation method.",
  promoteBackgroundJob: "Core v1 can cancel a background task but cannot promote it to foreground.",
  removeAgent: "Core v1 exposes no agent mutation method.",
  removeMcp: "Core v1 accepts MCP launch settings but has no MCP removal method.",
  removeSkill: "Core v1 skills/list is read-only.",
  requestAgents: "Core v1 exposes skills/list but no equivalent agent catalog.",
  requestConfig: "Core config/read is a redacted snapshot, not the Kilo Config schema consumed by Settings.",
  requestGlobalConfig: "Core config/read is not the Kilo global Config schema; writing it would dual-store.",
  requestImageModels: "Core v1 model/list does not expose the image-model catalog required by this UI.",
  requestIndexingSettings: "Core v1 exposes no indexing settings method.",
  requestIndexingStatus: "Core v1 exposes no indexing status method.",
  requestKiloEmbeddingModels: "Core v1 exposes no embedding-model catalog.",
  requestMcpStatus: "Core v1 accepts MCP launch settings but exposes no MCP status method.",
  requestMemory: "Core v1 exposes no memory read method.",
  requestSandboxDefault: "Core v1 thread modes do not expose Kilo's persisted sandbox default.",
  requestSandboxStatus: "Core v1 thread modes do not expose Kilo's sandbox availability/status.",
  requestSessionModelUsage: "Core v1 emits live usage deltas but has no durable usage read method.",
  resumeSession: "Core v1 has no message-scoped resume-from-point operation.",
  revertSession: "Core rewind is an interactive checkpoint turn, not message/part-scoped revert.",
  saveCustomProvider: "Core v1 exposes no custom-provider mutation method.",
  setIndexingConsent: "Core v1 exposes no indexing consent method.",
  setSandboxDefault: "Core v1 thread modes cannot persist Kilo's sandbox default semantics.",
  suggestionAccept: "Core v1 has user questions and approvals but no Kilo suggestion decision method.",
  suggestionDismiss: "Core v1 has user questions and approvals but no Kilo suggestion decision method.",
  toggleSandbox: "Core v1 thread modes cannot reproduce Kilo's sandbox transition semantics.",
  unrevertSession: "Core v1 has no redo operation after rewind.",
  updateConfig: "Core v1 exposes no project/global configuration mutation method.",
} as const satisfies Partial<Record<keyof typeof CODEM_UI_INTERACTION_OWNERS, string>>

export interface MatureUiParityReport {
  readonly totalCommands: number
  readonly preservedHostCommands: number
  readonly appServerCommands: number
  readonly controllerReady: readonly string[]
  readonly controllerPending: readonly string[]
  readonly protocolGaps: readonly { readonly command: string; readonly reason: string }[]
  readonly ready: boolean
}

/**
 * Executable production cutover gate for the mature Webview command surface.
 * Ownership alone is insufficient: every App Server-owned command must either
 * have a controller mapping or remain an explicit protocol gap.
 */
export function matureUiParityReport(): MatureUiParityReport {
  const commands = Object.entries(CODEM_UI_INTERACTION_OWNERS)
  const appServer = commands.filter(([, owner]) => owner === "app-server-live" || owner === "app-server-control")
  const ready = new Set<string>(APP_SERVER_MATURE_UI_COMMANDS)
  const protocolGaps = Object.entries(APP_SERVER_V1_PROTOCOL_GAPS).map(([command, reason]) => ({ command, reason }))
  const gaps = new Set(protocolGaps.map((gap) => gap.command))
  const controllerPending = appServer
    .map(([command]) => command)
    .filter((command) => !ready.has(command) && !gaps.has(command))
  return {
    totalCommands: commands.length,
    preservedHostCommands: commands.length - appServer.length,
    appServerCommands: appServer.length,
    controllerReady: [...ready].sort(),
    controllerPending: controllerPending.sort(),
    protocolGaps,
    ready: controllerPending.length === 0 && protocolGaps.length === 0 && ready.size === appServer.length,
  }
}

export function assertMatureUiProductionReady(): void {
  const report = matureUiParityReport()
  if (report.ready) return
  const pending = report.controllerPending.length > 0 ? ` pending=${report.controllerPending.join(",")}` : ""
  const gaps =
    report.protocolGaps.length > 0 ? ` protocolGaps=${report.protocolGaps.map((gap) => gap.command).join(",")}` : ""
  throw new Error(`CodeM mature UI parity gate failed:${pending}${gaps}`)
}
