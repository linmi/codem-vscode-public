/**
 * Renders New Task, History, Agent Manager, Profile, and
 * Settings inside the webview, as a fallback for Cursor only (see isCursorHost()
 * in src/utils.ts). Cursor's Secondary Side Bar support is unreliable for
 * extension-contributed `view/title` toolbars, which render outside the webview
 * DOM with no API to detect or work around the failure. Real VS Code renders the
 * native toolbar fine everywhere, so it keeps using that instead of this bar.
 */

import { Component, For } from "solid-js"
import { IconButton } from "@codem/ui/components/icon-button"
import { Tooltip } from "@codem/ui/components/tooltip"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"

export interface SidebarTopBarProps {
  onNewTask: () => void
  onHistory: () => void
}

interface Action {
  key: string
  icon: "plus" | "history" | "organization" | "user" | "settings-gear"
  run: () => void
}

export const SidebarTopBar: Component<SidebarTopBarProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()

  const open = (type: "openAgentManager" | "openProfilePanel" | "openSettingsPanel") => vscode.postMessage({ type })

  const actions: Action[] = [
    { key: "newTask", icon: "plus", run: () => props.onNewTask() },
    { key: "history", icon: "history", run: () => props.onHistory() },
    { key: "agentManager", icon: "organization", run: () => open("openAgentManager") },
    { key: "profile", icon: "user", run: () => open("openProfilePanel") },
    { key: "settings", icon: "settings-gear", run: () => open("openSettingsPanel") },
  ]

  return (
    <div class="sidebar-top-bar" role="toolbar" aria-label={language.t("sidebar.topBar.label")}>
      <For each={actions}>
        {(action) => {
          const label = language.t(`sidebar.topBar.${action.key}`)
          return (
            <Tooltip value={label} placement="bottom">
              <IconButton
                icon={action.icon}
                variant="ghost"
                size="small"
                aria-label={label}
                onClick={() => {
                  action.run()
                }}
              />
            </Tooltip>
          )
        }}
      </For>
    </div>
  )
}
