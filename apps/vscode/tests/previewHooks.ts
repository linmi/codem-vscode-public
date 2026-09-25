import type { ChatSnapshot } from "../src/shared/messages.ts"

/**
 * @codem/ui DOM that the preview runtime drives. Only ids, attributes and roles rendered by
 * @codem/ui or its cmdk/Radix primitives belong here. tests/previewHooks.test.ts renders every
 * scenario through the VS Code bridge and checks the fixture and entry hooks against that markup.
 */
const quote = JSON.stringify
export const localMenuTriggers: Record<string, string> = { effort: "#selectEffort", workMode: "#selectWorkMode", permissionMode: "#selectPermission", model: "#selectModel", space: "#selectSpace" }

/**
 * The committed render shows this fixture: phase on the shell, thread on the runtime-details trigger,
 * and the workspace label. Thread and workspace scope the composer's menus and slash state.
 */
export function fixtureHooks(state: Pick<ChatSnapshot, "phase" | "threadId" | "workspace">) {
  return {
    selector: `.app[data-codem-ui="shell"][data-phase=${quote(state.phase)}] #runtimeDetails[data-thread-id=${quote(state.threadId ?? "")}]`,
    workspace: state.workspace ?? "未连接工作区",
  }
}

/** First element each surface waits for; the rest of its flow opens from there. */
export function surfaceEntry(surface: string): string {
  if (Object.hasOwn(localMenuTriggers, surface)) return `${localMenuTriggers[surface]}:not(:disabled)`
  if (surface === "sessionTools") return "#prompt:not(:disabled)"
  if (surface === "capabilities") return '#runtimeDetails[data-state="closed"]'
  if (surface === "activities") return ".workGroup, .activityMessage details"
  return '#toggleResources[data-state="closed"]'
}

/** Slash command whose panel a session-tools fixture shows. */
export function sessionCommand(scenario: string, state: Pick<ChatSnapshot, "sessionTools">): string {
  const kind = state.sessionTools.catalog?.kind
  if (state.sessionTools.sideQuestion) return "ask"
  if (scenario === "sessionDirectories") return "directories"
  if (kind || scenario.startsWith("catalog")) return kind && kind !== "skills" ? "catalog" : "skills"
  return "rename"
}

/** An available command in the slash menu, which opens as soon as the composer holds a slash draft. */
export const slashItem =(command: string) => `[data-testid="slashMenu"] [cmdk-item][data-value=${quote(command)}][aria-disabled="false"]`
/** /ask switches the composer to the side answer; the other session commands open the command dialog. */
export const sessionPanel = (command: string) => command === "ask" ? '.composerSideAnswer[aria-label="旁路问答"]' : ".sessionCommandDialog"
export const catalogKindTrigger = '.sessionCommandDialog [aria-label="目录类型"]'
/** Options of the one open select, listed in catalogKinds order. */
export const catalogKindOptions = '[data-slot="select-content"] [role="option"]'
export const catalogRows = ".sessionCommandDialog .catalogRows"
export const resourceTab = (tab: string) => `[data-resource-tab=${quote(tab)}]`
