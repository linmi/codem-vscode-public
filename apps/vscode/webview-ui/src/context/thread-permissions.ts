import type { CodemPermissionMode, CodemPermissionProfile } from "@codem/protocol"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"
import {
  acceptThreadPermissionMessage,
  emptyThreadPermissionView,
  type ThreadPermissionView,
} from "../utils/thread-permission-state"

const TYPED_PERMISSION_MODES = ["default", "auto", "yolo"] as const satisfies readonly CodemPermissionMode[]

interface Options {
  views: () => Record<string, ThreadPermissionView>
  setView: (id: string, view: ThreadPermissionView) => void
  drafts: () => Record<string, CodemPermissionMode>
  setDraft: (id: string, mode: CodemPermissionMode) => void
  deleteDraft: (id: string) => void
  defaultMode: () => CodemPermissionMode
  post: (message: WebviewMessage) => void
  profiles?: () => readonly CodemPermissionProfile[]
  setProfiles?: (profiles: readonly CodemPermissionProfile[]) => void
}

/** One owner per webview, independent of composer mounts and tab selection. */
export function createThreadPermissions(options: Options) {
  let localProfiles: readonly CodemPermissionProfile[] = []
  let profileRequestID: string | null = null
  const listedProfiles = () => options.profiles?.() ?? localProfiles
  const storeProfiles = (profiles: readonly CodemPermissionProfile[]) => {
    localProfiles = profiles
    options.setProfiles?.(profiles)
  }
  const view = (id: string) => options.views()[id] ?? emptyThreadPermissionView(id)
  const draftMode = (id?: string) => options.drafts()[id ?? ""] ?? options.defaultMode()
  /** 现有选择器只展示 default/auto/yolo，且只保留 settableAtRuntime。 */
  const settableModes = (): CodemPermissionMode[] =>
    TYPED_PERMISSION_MODES.filter((mode) => {
      const profile = listedProfiles().find((entry) => entry.id === mode)
      return !profile || profile.settableAtRuntime
    })
  const selectDraft = (mode: CodemPermissionMode, id?: string) => {
    if (!settableModes().includes(mode)) return
    options.setDraft(id ?? "", mode)
  }

  function submitDraft(source?: string, target?: string) {
    const mode = draftMode(source)
    if (target) {
      options.setDraft(target, mode)
      if (!source) options.deleteDraft("")
    }
    return mode
  }

  function requestProfiles() {
    if (profileRequestID || listedProfiles().length > 0) return
    const requestID = crypto.randomUUID()
    profileRequestID = requestID
    options.post({ type: "requestPermissionProfiles", requestID })
  }

  function read(id: string, retry = false) {
    const current = view(id)
    if (current.requestID || (!retry && (current.state || current.error))) return
    const requestID = crypto.randomUUID()
    options.setView(id, { ...current, requestID, error: null })
    options.post({ type: "requestThreadModes", sessionID: id, requestID })
  }

  function select(id: string, permissionMode: CodemPermissionMode) {
    const current = view(id)
    if (!settableModes().includes(permissionMode)) return
    if (!current.state || current.requestID || current.error || current.state.permissionMode === permissionMode) return
    const requestID = crypto.randomUUID()
    options.setView(id, { ...current, requestID, error: null })
    options.post({
      type: "setThreadPermissionMode",
      sessionID: id,
      requestID,
      expectedRevision: current.state.revision,
      permissionMode,
    })
  }

  function accept(message: ExtensionMessage) {
    if (message.type === "sessionCreated" && message.draftID) options.deleteDraft(message.draftID)
    if (message.type === "permissionProfilesLoaded") {
      if (profileRequestID && message.requestID !== profileRequestID) return
      profileRequestID = null
      if ("error" in message.result) return
      storeProfiles(message.result.profiles)
      return
    }
    if (message.type !== "threadModesChanged" && message.type !== "threadModesResult") return
    const current = view(message.sessionID)
    const next = acceptThreadPermissionMessage(current, message)
    if (next !== current) options.setView(message.sessionID, next)
  }

  return { view, draftMode, selectDraft, submitDraft, read, select, accept, settableModes, requestProfiles }
}
