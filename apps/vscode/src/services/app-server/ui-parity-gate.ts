import { APP_SERVER_MATURE_UI_COMMANDS } from "./mature-ui-controller.ts"
import { CODEM_UI_INTERACTION_OWNERS } from "./ui-parity.ts"

/**
 * Core v1 protocol gaps that used to block production cutover.
 * Those commands were product-cut from WebviewMessage and the ownership table.
 * Do not reintroduce them without a real Core RPC.
 */
export const APP_SERVER_V1_PROTOCOL_GAPS: Partial<Record<keyof typeof CODEM_UI_INTERACTION_OWNERS, string>> = {}

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
