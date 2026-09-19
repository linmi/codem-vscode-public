/** Display-only DTOs. Core IDs, option values, credentials and RPC frames remain in Host. */
export type PanelKind = "space" | "model" | "effort" | "permissionMode" | "workMode" | "approval" | "question" | "plan"
export interface PanelChoice { id: string; label: string; description: string; selected: boolean }
export interface PanelView {
  id: string
  kind: PanelKind
  title: string
  description: string
  detail: string | null
  choices: readonly PanelChoice[]
  backChoiceId: string | null
  initialText: string
  multiple: boolean
  allowText: boolean
  confirmLabel: string | null
}
export interface PanelMessage { type: "panel"; panel: PanelView | null }
export interface PanelReply { type: "panelReply"; id: string; choiceIds: string[]; text: string; cancelled: boolean }

export function parsePanelReply(record: Record<string, unknown>): PanelReply {
  if (Object.keys(record).length !== 5 || record.type !== "panelReply" || typeof record.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(record.id) || !Array.isArray(record.choiceIds) || record.choiceIds.length > 100 || !record.choiceIds.every(id => typeof id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(id)) || new Set(record.choiceIds).size !== record.choiceIds.length || typeof record.text !== "string" || record.text.length > 16000 || typeof record.cancelled !== "boolean" || (record.cancelled && (record.choiceIds.length > 0 || record.text !== ""))) throw new Error("Invalid CodeM panel reply")
  return record as unknown as PanelReply
}
