import { type Accessor, type Component } from "solid-js"
import { PromptOptionSelector } from "./PromptOptionSelector"
import { useSession } from "../../context/session"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"

// ---------------------------------------------------------------------------
// Chat thinking effort
// ---------------------------------------------------------------------------

interface ThinkingSelectorProps {
  sessionID?: Accessor<string | undefined>
  blocked?: boolean
}

export const ThinkingSelector: Component<ThinkingSelectorProps> = (props) => {
  const session = useSession()
  const { settings } = useConfig()
  const id = () => props.sessionID?.()
  const language = useLanguage()

  return (
    <PromptOptionSelector
      variants={session.variantList(id())}
      value={session.currentVariant(id())}
      label={language.t("prompt.thinking.tooltip")}
      blocked={props.blocked}
      onSelect={(value) => session.selectVariant(value, id())}
      cycleHint={settings()["chat.shiftTabCyclesVariant"] !== false}
    />
  )
}
