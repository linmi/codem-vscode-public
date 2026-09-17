import { useVSCode } from "./vscode"
import { useServer } from "./server"
import { createEffect, createSignal, on, type Accessor } from "solid-js"
import type { CodemPermissionMode } from "@codem/protocol"
import { DEFAULT_PROMPT_SETTINGS, type PromptDefaults } from "../../../src/shared/prompt-defaults"
import type { ExtensionMessage } from "../types/messages"
import type { ThreadPermissionView } from "../utils/thread-permission-state"
import { createThreadPermissions } from "./thread-permissions"

export function createPromptSettings(current: Accessor<string | undefined>, draft: Accessor<string | undefined>) {
  const vscode = useVSCode()
  const server = useServer()
  const [defaults, setDefaults] = createSignal<PromptDefaults>(DEFAULT_PROMPT_SETTINGS)
  const [views, setViews] = createSignal<Record<string, ThreadPermissionView>>({})
  const [drafts, setDrafts] = createSignal<Record<string, CodemPermissionMode>>({})
  const permissions = createThreadPermissions({
    views,
    setView: (id, view) => setViews((current) => ({ ...current, [id]: view })),
    drafts,
    setDraft: (id, mode) => setDrafts((current) => ({ ...current, [id]: mode })),
    deleteDraft: (id) =>
      setDrafts((current) => {
        const next = { ...current }
        delete next[id]
        return next
      }),
    defaultMode: () => defaults().permissionMode,
    post: vscode.postMessage,
  })
  createEffect(
    on([current, server.isConnected], ([id, connected]) => {
      if (id && connected) permissions.read(id)
    }),
  )

  function accept(message: ExtensionMessage) {
    if (message.type === "promptDefaults") setDefaults(message.defaults)
    permissions.accept(message)
  }

  function initialMode(
    sessionID?: string,
    draftID?: string,
    submissionDraftID?: string,
  ): { permissionMode?: CodemPermissionMode } {
    if (sessionID) return {}
    return { permissionMode: permissions.submitDraft(draftID ?? draft(), submissionDraftID) }
  }

  return { defaults, permissions, accept, initialMode }
}
