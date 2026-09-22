import { useEffect, useState } from "react"
import type { PendingPanel } from "../contract.ts"
import { SafeMarkdown } from "./SafeMarkdown.tsx"
import { uiIcon } from "./uiIcons.ts"

/**
 * 对照 VS Code panelView：编号选项、键盘 1-9、上一题和确认。
 * 回退不走这条窄条，仍用原来的对话框。
 */
export function DecisionPanel({
  panel,
  text,
  setText,
  post,
}: {
  panel: PendingPanel | null
  text: string
  setText: (value: string) => void
  post: (action: Record<string, unknown>) => void
}) {
  const active = panel && panel.kind !== "rewind" ? panel : null
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  useEffect(() => {
    setSelected(active?.choices.filter((choice) => choice.selected).map((choice) => choice.id) ?? [])
    setPending(false)
    setText(active?.initialText ?? "")
  }, [active?.id])
  const submit = (choiceIds: string[], cancelled = false) => {
    if (!active || pending) return
    setPending(true)
    const back = active.backChoiceId !== null && choiceIds.includes(active.backChoiceId)
    post({
      type: "panelReply",
      id: active.id,
      choiceIds,
      text: cancelled || !active.allowText || back ? "" : text,
      cancelled,
    })
  }
  const confirmDisabled = !selected.length && !text.trim()
  return (
    <section
      className="decisionPanel"
      data-testid="approval"
      hidden={!active}
      tabIndex={-1}
      role="dialog"
      aria-labelledby="decisionTitle"
      data-kind={active?.kind}
      aria-busy={pending}
      onKeyDown={(event) => {
        if (!active || event.nativeEvent.isComposing) return
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          submit([], true)
          return
        }
        if (event.target instanceof HTMLTextAreaElement) return
        const visible = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".decisionChoice:not([disabled])")]
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          const index = visible.indexOf(document.activeElement as HTMLButtonElement)
          visible[(index + (event.key === "ArrowDown" ? 1 : visible.length - 1) + visible.length) % visible.length]?.focus()
        } else if (!(event.target instanceof HTMLInputElement) && /^[1-9]$/.test(event.key)) {
          event.preventDefault()
          visible[Number(event.key) - 1]?.click()
        }
      }}
    >
      {active ? (
        <>
          <div className="decisionHeading">
            <h2 id="decisionTitle">{active.title}</h2>
            <button type="button" className="iconButton" aria-label="取消当前请求" disabled={pending} onClick={() => submit([], true)} dangerouslySetInnerHTML={{ __html: uiIcon("close") }} />
          </div>
          {active.description ? <p className="decisionDescription">{active.description}</p> : null}
          {active.detail ? (
            active.kind === "plan"
              ? <div className="decisionDetail chatMarkdown"><SafeMarkdown text={active.detail} /></div>
              : <div className="decisionDetail">{active.detail}</div>
          ) : null}
          <div className="decisionChoices">
            {active.choices.map((choice, index) => {
              const pressed = Boolean(active.confirmLabel) && selected.includes(choice.id)
              return (
                <button
                  key={choice.id}
                  type="button"
                  className={choice.icon === "shieldAlert" ? "decisionChoice permissionWarning" : "decisionChoice"}
                  data-id={choice.id}
                  data-testid={`choice-${choice.id}`}
                  data-selected={String(pressed)}
                  aria-pressed={active.confirmLabel ? pressed : undefined}
                  disabled={pending}
                  onClick={() => {
                    if (!active.confirmLabel) {
                      submit([choice.id])
                      return
                    }
                    setSelected((current) => {
                      if (current.includes(choice.id)) return current.filter((id) => id !== choice.id)
                      return active.multiple ? [...current, choice.id] : [choice.id]
                    })
                  }}
                >
                  <span className="decisionNumber">{index + 1}</span>
                  {choice.icon ? <span className="decisionChoiceIcon" dangerouslySetInnerHTML={{ __html: uiIcon(choice.icon) }} /> : null}
                  <span className="decisionChoiceContent">
                    <span className="decisionLabel">{choice.label}</span>
                    {choice.description ? <span className="decisionChoiceDescription">{choice.description}</span> : null}
                  </span>
                  <span className="decisionCheck" dangerouslySetInnerHTML={{ __html: uiIcon("check") }} />
                </button>
              )
            })}
          </div>
          {active.allowText ? (
            <textarea
              className="decisionAnswer"
              data-testid="panelText"
              rows={2}
              maxLength={16000}
              aria-label={active.kind === "plan" ? "修改意见" : "补充回答"}
              placeholder={active.kind === "plan" ? "需要调整的地方（可选）…" : "输入自己的回答…"}
              value={text}
              disabled={pending}
              onChange={(event) => setText(event.target.value)}
            />
          ) : null}
          {active.confirmLabel || active.backChoiceId ? (
            <div className="decisionActions">
              {active.backChoiceId ? (
                <button type="button" className="decisionPrevious" disabled={pending} onClick={() => submit([active.backChoiceId!])}>上一题</button>
              ) : null}
              {active.confirmLabel ? (
                <button type="button" className="decisionSubmit" data-testid="confirmPanel" disabled={pending || confirmDisabled} onClick={() => submit(selected)}>{active.confirmLabel}</button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
