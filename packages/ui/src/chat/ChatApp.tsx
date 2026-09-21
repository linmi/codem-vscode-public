import { useEffect, useRef, useState } from "react"
import { ArrowUpIcon, MessageSquarePlusIcon, SquareIcon, SquarePenIcon, XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import {
  asSnapshot,
  isBusy,
  isSignedIn,
  parseUiAction,
  visibleControls,
  type ChatSnapshot,
  type ComposerInputMode,
} from "../contract.ts"
import type { CodemUiHost } from "../host.ts"
import { AccountPage, AccountTrigger } from "./AccountPage.tsx"
import { ComposerMenus } from "./composerMenus.tsx"
import { draftRetention, type PendingSend } from "./draftRetention.ts"
import { MessageList } from "./MessageList.tsx"
import { SlashMenu } from "./SlashMenu.tsx"
import { WelcomeView } from "./WelcomeView.tsx"
import { commandUnavailable, inputModes, slashQuery } from "./slashCommands.ts"

/**
 * 产品聊天壳：对照 VS Code 现网 html.ts + composerView，不是调试台。
 *
 * 更改要点：sessionHeader / 玻璃 composer / 左右菜单分区 / footerMeta；
 * connecting 露出「正在连接」与超时重试，不再只转 Logo。
 */
export function ChatApp({ host, initial }: { host: CodemUiHost; initial: ChatSnapshot }) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>(initial)
  const [draft, setDraft] = useState(() => String(host.getState()?.draft ?? ""))
  const [panelText, setPanelText] = useState("")
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [accountOpen, setAccountOpen] = useState(initial.accountOpen)
  const [accountFocus, setAccountFocus] = useState(0)
  const [inputMode, setInputMode] = useState<ComposerInputMode>("message")
  const [slashOpen, setSlashOpen] = useState(false)
  const [connectStale, setConnectStale] = useState(false)
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null)
  const prompt = useRef<HTMLTextAreaElement>(null)
  const controls = visibleControls(snapshot)
  const busy = isBusy(snapshot.phase)
  const running = snapshot.phase === "running" || snapshot.phase === "sending" || snapshot.phase === "stopping"
  const canSendMessage = snapshot.phase === "ready" || snapshot.phase === "disconnected"
  const account = snapshot.account
  const signedIn = isSignedIn(account)
  const slash = inputMode === "message" ? slashQuery(draft) : null
  const empty = snapshot.messages.length === 0 && !snapshot.assistantText

  useEffect(() => {
    return host.subscribe((message) => {
      const next = asSnapshot(message)
      if (next) setSnapshot(next)
    })
  }, [host])

  // Host 快照的 theme 写到 html/body，避免 :root 浅色把 IDEA 深色 LAF 盖成白页。
  useEffect(() => {
    const dark = snapshot.theme === "dark"
    const root = document.documentElement
    root.classList.toggle("codem-dark", dark)
    root.classList.toggle("vscode-dark", dark)
    root.classList.toggle("codem-light", !dark)
    root.style.colorScheme = dark ? "dark" : "light"
    if (document.body) {
      document.body.classList.toggle("codem-dark", dark)
      document.body.classList.toggle("vscode-dark", dark)
      document.body.classList.toggle("codem-light", !dark)
    }
  }, [snapshot.theme])

  useEffect(() => {
    setAccountOpen(snapshot.accountOpen)
  }, [snapshot.accountOpen])

  useEffect(() => {
    if (snapshot.account.status !== "signedIn") setAccountOpen(false)
  }, [snapshot.account.status])

  useEffect(() => {
    if (busy) {
      setOpenMenu(null)
      setSlashOpen(false)
    }
  }, [busy])

  useEffect(() => {
    setOpenMenu(null)
    setPanelText("")
    setSlashOpen(false)
    setInputMode("message")
  }, [snapshot.workspace, snapshot.space, snapshot.threadId])

  useEffect(() => {
    setSlashOpen(slash !== null && !busy)
  }, [slash, busy])

  // 草稿只在宿主确认收下这条消息后才丢弃；没被受理就还回输入框。
  useEffect(() => {
    if (!pendingSend) return
    const retention = draftRetention(pendingSend, snapshot, draft)
    if (retention.kind === "waiting") return
    setPendingSend(null)
    if (retention.kind === "restore") saveDraft(retention.text)
  }, [snapshot, pendingSend, draft])

  useEffect(() => {
    if (snapshot.phase !== "connecting") {
      setConnectStale(false)
      return
    }
    const timer = window.setTimeout(() => setConnectStale(true), 12_000)
    return () => window.clearTimeout(timer)
  }, [snapshot.phase])

  useEffect(() => {
    const node = prompt.current
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${Math.min(220, Math.max(59, node.scrollHeight))}px`
  }, [draft])

  const post = (action: Record<string, unknown>) => {
    host.postAction(parseUiAction(action))
  }

  /** 校验或投递失败时返回 false，调用方据此保留输入内容。 */
  const tryPost = (action: Record<string, unknown>) => {
    try {
      post(action)
      return true
    } catch {
      return false
    }
  }

  const saveDraft = (text: string) => {
    setDraft(text)
    host.setState({ draft: text })
  }

  const requestId = () => `req-${Date.now().toString(36)}`
  const themeClass = snapshot.theme === "dark" ? "codem-dark vscode-dark" : "codem-light"
  const showAccount = !signedIn || accountOpen
  const threadTitle = snapshot.messages.find((message) => message.role === "user")?.text.slice(0, 160) || "新会话"
  const connected = snapshot.phase !== "disconnected" && snapshot.phase !== "failed" && snapshot.phase !== "closing"

  const chooseSlash = (id: string) => {
    if (commandUnavailable(id, snapshot)) return
    setSlashOpen(false)
    saveDraft("")
    const mode = inputModes[id]
    if (mode) {
      setInputMode(mode)
      return
    }
    if (id === "files") post({ type: "pickAttachment", kind: "file" })
    else if (id === "model") setOpenMenu("model")
    else if (id === "mode") setOpenMenu("workMode")
    else if (id === "history") post({ type: "showHistory" })
    else if (id === "compact" && snapshot.threadId) post({ type: "compactThread", threadId: snapshot.threadId, requestId: requestId() })
    else if (id === "rewind" && snapshot.threadId) post({ type: "rewindThread", threadId: snapshot.threadId, requestId: requestId() })
    else if (id === "clear" && snapshot.threadId) post({ type: "clearThread", threadId: snapshot.threadId, requestId: requestId() })
    else if (["rename", "fork", "archive", "unarchive", "delete"].includes(id) && snapshot.threadId) {
      post({
        type: "manageThread",
        operation: id,
        threadId: snapshot.threadId,
        name: id === "rename" ? threadTitle : "",
        requestId: requestId(),
      })
    }
  }

  const submit = () => {
    if (slashOpen && slash !== null) return
    const text = draft.trim()
    if (!text) return
    const id = requestId()
    if (inputMode !== "message" && snapshot.threadId) {
      // 动作没被宿主接住就保留原文，不让用户重打一遍。
      if (!tryPost({ type: inputMode, threadId: snapshot.threadId, text, requestId: id })) return
      saveDraft("")
      setInputMode("message")
      return
    }
    if (!canSendMessage || running) return
    if (
      !tryPost({
        type: "send",
        text,
        requestId: id,
        ...(snapshot.selections.length ? { selectionIds: snapshot.selections.map((item) => item.id) } : {}),
        ...(snapshot.attachments.length ? { attachmentIds: snapshot.attachments.map((item) => item.id) } : {}),
      })
    ) return
    // 宿主用 requestId 作为这条用户消息的 id；快照出现它才算受理。
    setPendingSend({ requestId: id, text, version: snapshot.version })
    saveDraft("")
  }

  if (showAccount) {
    return (
      <div className={themeClass} data-codem-ui="shell" data-theme={snapshot.theme} data-host="shared" data-account="page">
        <AccountPage
          account={account}
          brandMark={snapshot.brandMark}
          focusRequest={accountFocus}
          onBack={() => setAccountOpen(false)}
          post={post}
        />
      </div>
    )
  }

  return (
    <div className={`app ${themeClass}`} data-codem-ui="shell" data-theme={snapshot.theme} data-phase={snapshot.phase} data-host="shared">
      <header className="sessionHeader">
        <span className="sessionTitle">
          <span className="sessionIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
            </svg>
          </span>
          <span id="sessionTitle">{threadTitle}</span>
          <span className="statusDot" data-connected={connected ? "true" : "false"} title="连接状态" />
        </span>
        <div className="headerActions">
          <Button
            type="button"
            variant="ghost"
            className="iconButton"
            data-testid="newChat"
            aria-label="新建会话"
            title="新建会话"
            disabled={!snapshot.threadId || running}
            onClick={() => post({ type: "newChat" })}
          >
            <SquarePenIcon aria-hidden="true" />
          </Button>
          <AccountTrigger
            account={account}
            onOpen={() => {
              setAccountFocus((value) => value + 1)
              setAccountOpen(true)
              post({ type: "refreshAccount" })
            }}
          />
        </div>
      </header>
      <div className="timelineArea">
        <main id="scrollArea">
          <Button
            type="button"
            variant="ghost"
            className="loadOlder"
            data-testid="olderMessages"
            hidden={!controls.older}
            disabled={!controls.older}
            onClick={() => post({ type: "olderMessages" })}
          >
            更早消息
          </Button>
          {empty ? <WelcomeView phase={snapshot.phase} hasMessages={false} brandMark={snapshot.brandMark} /> : <MessageList snapshot={snapshot} />}
        </main>
      </div>
      <footer>
        <div className="connection" hidden={!controls.retry && !controls.resume && !connectStale}>
          <p>{controls.retry || connectStale ? "连接中断，可重试。" : "可以恢复上一次会话。"}</p>
          <div>
            <Button
              type="button"
              className="primaryButton"
              data-testid="retryConnect"
              hidden={!controls.retry && !connectStale}
              disabled={!controls.retry && !connectStale}
              onClick={() => post({ type: "connect" })}
            >
              重试连接
            </Button>
            <Button
              type="button"
              className="textButton"
              data-testid="resumeThread"
              hidden={!controls.resume}
              disabled={!controls.resume || !snapshot.resumeThreadId}
              onClick={() => {
                if (snapshot.resumeThreadId) post({ type: "resumeThread", threadId: snapshot.resumeThreadId })
              }}
            >
              恢复会话
            </Button>
          </div>
        </div>
        {snapshot.notice || snapshot.phase === "connecting" ? (
          <p data-testid="notice" id="notice" className="notice" role="status">
            {snapshot.notice || "正在连接 CodeM…"}
          </p>
        ) : (
          <p data-testid="notice" id="notice" className="notice" hidden />
        )}
        <InteractionPanel snapshot={snapshot} text={panelText} setText={setPanelText} post={post} />
        <form
          id="composer"
          className="composer"
          data-testid="composerMenus"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          {snapshot.selections.length > 0 || snapshot.attachments.length > 0 ? (
            <ul data-testid="contextChips" className="attachments">
              {snapshot.selections.map((item) => (
                <li key={item.id} className="attachmentCard">
                  <span className="attachmentName">{item.label}</span>
                </li>
              ))}
              {snapshot.attachments.map((item) => (
                <li key={item.id} className="attachmentCard">
                  <span className="attachmentName">{item.label}</span>
                  <Button type="button" variant="ghost" className="attachmentRemove" disabled={busy} aria-label={`移除附件 ${item.label}`} onClick={() => post({ type: "removeAttachment", id: item.id })}>
                    <XIcon aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {inputMode !== "message" ? (
            <div className="composerModeBar" data-testid="inputMode">
              <span>
                <MessageSquarePlusIcon aria-hidden="true" />
                {inputMode === "askSideQuestion" ? "旁路提问" : inputMode === "steer" ? "补充指令" : "Shell 命令"}
              </span>
              <Button type="button" variant="ghost" size="sm" aria-label="返回普通对话" onClick={() => setInputMode("message")}>
                <XIcon aria-hidden="true" />
                返回对话
              </Button>
            </div>
          ) : null}
          <label className="visuallyHidden" htmlFor="prompt">
            {inputMode === "message" ? "发送给 CodeM 的消息" : "会话命令输入"}
          </label>
          <textarea
            ref={prompt}
            id="prompt"
            data-testid="composer"
            rows={2}
            maxLength={32000}
            spellCheck={false}
            placeholder={inputMode === "message" ? "提出问题，或输入 / 选择会话操作…" : "输入内容后发送"}
            value={draft}
            disabled={running && inputMode !== "steer"}
            onChange={(event) => saveDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && slashOpen) {
                event.preventDefault()
                setSlashOpen(false)
                return
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !slashOpen) {
                event.preventDefault()
                submit()
              }
            }}
          />
          {slashOpen && slash !== null ? (
            <SlashMenu snapshot={snapshot} query={slash} onClose={(focus) => {
              setSlashOpen(false)
              if (focus) prompt.current?.focus()
            }} onChoose={chooseSlash} />
          ) : null}
          <div className="composerToolbar">
            <div className="composerLeading">
              <ComposerMenus snapshot={snapshot} enabled={!busy} openMenu={openMenu} setOpenMenu={setOpenMenu} post={post} region="leading" />
            </div>
            <div className="composerTrailing">
              <ComposerMenus snapshot={snapshot} enabled={!busy} openMenu={openMenu} setOpenMenu={setOpenMenu} post={post} region="trailing" />
              {running && inputMode !== "steer" ? (
                <Button type="button" className="stopButton" data-testid="stop" aria-label="停止生成" title="停止生成" onClick={() => post({ type: "stop" })}>
                  <SquareIcon aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="sendButton"
                  data-testid="send"
                  aria-label="发送消息"
                  title="发送消息 · Enter"
                  disabled={!draft.trim() || (inputMode === "message" && (!canSendMessage || running))}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </form>
        <div className="footerMeta">
          <span className="environment">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8 21h8m-4-4v4" />
            </svg>
            <span>本地</span>
          </span>
          <ComposerMenus snapshot={snapshot} enabled={!busy} openMenu={openMenu} setOpenMenu={setOpenMenu} post={post} region="space" />
          <span className="workspaceLabel">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 7V5h6l2 2h10v13H3z" />
            </svg>
            <span id="workspace">{snapshot.workspace ?? "未连接工作区"}</span>
          </span>
        </div>
      </footer>
    </div>
  )
}

function InteractionPanel({
  snapshot,
  text,
  setText,
  post,
}: {
  snapshot: ChatSnapshot
  text: string
  setText: (value: string) => void
  post: (action: Record<string, unknown>) => void
}) {
  const panel = snapshot.pendingPanel
  if (!panel) return <form data-testid="approval" hidden />
  const reply = (choiceIds: string[], cancelled: boolean, extra = "") => {
    post({ type: "panelReply", id: panel.id, choiceIds, text: cancelled ? "" : extra, cancelled })
  }
  return (
    <form data-testid="approval" className="decisionPanel" aria-label={panel.title} onSubmit={(event) => event.preventDefault()}>
      <h2>{panel.title}</h2>
      <p className="decisionDescription">{panel.description}</p>
      <div className="decisionChoices">
        {panel.choices.map((choice) => (
          <Button key={choice.id} type="button" className="decisionChoice" data-testid={`choice-${choice.id}`} onClick={() => reply([choice.id], false, text)}>
            {choice.label}
          </Button>
        ))}
      </div>
      {panel.allowText ? (
        <textarea className="decisionAnswer" data-testid="panelText" aria-label="补充说明" value={text} onChange={(event) => setText(event.target.value)} />
      ) : null}
      {panel.kind !== "approval" ? (
        <Button type="button" variant="ghost" data-testid="cancelApproval" onClick={() => reply([], true)}>取消</Button>
      ) : null}
    </form>
  )
}
