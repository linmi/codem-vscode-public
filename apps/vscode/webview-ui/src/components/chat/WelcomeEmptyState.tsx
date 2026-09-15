import { type Component, type JSX, For, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { recentSessions } from "../../context/session-utils"
import { formatRelativeDate } from "../../utils/date"

const COMMUNITY_URL = "https://example.invalid/join-chatjdeec-7f17-4869-a491-59d27094164f"

interface WelcomeEmptyStateProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  footer?: JSX.Element
}

export const CodeMLogo = () => {
  const icons = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""

  return (
    <div class="codem-logo">
      <img src={`${icons}/codem-mark.svg`} alt="CodeM" />
    </div>
  )
}

export const WelcomeEmptyState: Component<WelcomeEmptyStateProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const vscode = useVSCode()
  const recent = () => recentSessions(session.sessions())

  return (
    <div class="message-list-empty">
      <CodeMLogo />
      <p class="kilo-about-text">{language.t("session.messages.welcome")}</p>
      <Show when={recent().length > 0 && props.onSelectSession}>
        <div class="recent-sessions">
          <span class="recent-sessions-label">{language.t("session.recent")}</span>
          <For each={recent()}>
            {(item) => (
              <button class="recent-session-item" onClick={() => props.onSelectSession?.(item.id)}>
                <span class="recent-session-title" dir="auto">
                  {item.title || language.t("session.untitled")}
                </span>
                <span class="recent-session-date">{formatRelativeDate(item.updatedAt)}</span>
              </button>
            )}
          </For>
          <Show when={props.onShowHistory}>
            <button class="show-history-btn" onClick={() => props.onShowHistory?.()}>
              <Icon name="history" size="small" />
              {language.t("session.showHistory")}
            </button>
          </Show>
        </div>
      </Show>
      <button
        class="community-button"
        onClick={() => vscode.postMessage({ type: "openExternal", url: COMMUNITY_URL })}
      >
        <Icon name="bubble-5" size="small" />
        {language.t("community.button")}
      </button>
      {props.footer}
    </div>
  )
}
