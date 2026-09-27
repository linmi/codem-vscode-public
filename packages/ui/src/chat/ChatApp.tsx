import { PluginManagement } from "./pluginManagement.tsx"
import { ConversationSearch } from "./conversationSearch.tsx"
import { useEffect, useRef, useState } from "react"
import { MessageSquarePlusIcon, TerminalIcon, XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import {
  asSnapshot,
  isSignedIn,
  isThreadOperation,
  parseUiAction,
  visibleControls,
  type ChatSnapshot,
  type ComposerInputMode,
} from "../contract.ts"
import type { CodemUiHost } from "../host.ts"
import { AccountPage, AccountTrigger } from "./AccountPage.tsx"
import { AttachmentCard } from "./attachments.tsx"
import { CodeSelectionList } from "./codeSelection.tsx"
import { ComposerMenus, type MenuName } from "./composerMenus.tsx"
import { DecisionPanel } from "./decisionPanel.tsx"
import { draftRetention, type PendingSend } from "./draftRetention.ts"
import { FileMentions, useFileMentions } from "./FileMentions.tsx"
import { HistoryButton, HistoryPaging, HistoryPanel, HistoryResume } from "./HistoryPanel.tsx"
import { composerMessageAction, inputModeText, sendOnEnter } from "./composerInput.ts"
import { phaseFlags, sessionIdle } from "./chatPhase.ts"
import { LoadingState } from "./LoadingState.tsx"
import { MessageList } from "./MessageList.tsx"
import { ResourceTools } from "./resourceTools.tsx"
import { RewindPanel } from "./rewindPanel.tsx"
import { RuntimeDetails } from "./runtimeDetails.tsx"
import { SessionCommandPanel, type SessionRequest } from "./sessionCommandPanel.tsx"
import { SlashMenu } from "./SlashMenu.tsx"
import { TaskProgress } from "./taskProgress.tsx"
import { useTranscriptScroll } from "./transcriptScroll.ts"
import { WelcomeView } from "./WelcomeView.tsx"
import { workingStatus } from "./workingStatus.ts"
import { commandUnavailable, inputModes, inputUnavailable, slashQuery } from "./slashCommands.ts"
import { nextRequestId } from "./requestIds.ts"
import { uiIcon } from "./uiIcons.ts"

/** 在确认/目录面板里完成的斜杠命令；会话管理操作另由 isThreadOperation 判断。 */
const sessionPanelCommands: readonly string[] = ["skills", "catalog", "directories", "compact", "rewind", "clear"]

/**
 * 产品聊天壳：对照 VS Code 现网 html.ts + composerView，不是调试台。
 *
 * 更改要点：sessionHeader / 玻璃 composer / 左右菜单分区 / footerMeta；
 * connecting 露出「正在连接」与超时重试，不再只转 Logo。
 */
export function ChatApp({ host, initial }: { host: CodemUiHost; initial: ChatSnapshot }) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>(initial)
  const [draft, setDraft] = useState(() => String(host.getState()?.draft ?? ""))
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountFocus, setAccountFocus] = useState(0)
  const [inputMode, setInputMode] = useState<ComposerInputMode>("message")
  const [slashOpen, setSlashOpen] = useState(false)
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null)
  const [sessionRequest, setSessionRequest] = useState<SessionRequest | null>(null)
  const prompt = useRef<HTMLTextAreaElement>(null)
  const composer = useRef<HTMLFormElement>(null)
  const scroller = useRef<HTMLElement>(null)
  const accountStatus = useRef(initial.account.status)
  const accountRequest = useRef(initial.accountRequest)
  const permissionMenuRequest = useRef(initial.permissionMenuRequest)
  const { busy, turnActive, generating, connected, slashMenu } = phaseFlags(snapshot.phase)
  const idle = sessionIdle(snapshot)
  const modeText = inputModeText(inputMode)
  const messageAction = inputMode === "message" ? composerMessageAction(snapshot.phase) : null
  const account = snapshot.account
  const signedIn = isSignedIn(account)
  const slash = inputMode === "message" ? slashQuery(draft) : null
  const empty = snapshot.messages.length === 0 && !snapshot.assistantText
  const transcript = useTranscriptScroll(scroller, {
    context: `${snapshot.workspace}:${snapshot.space}:${snapshot.threadId}`,
    revision: snapshot,
    target: snapshot.conversationSearch?.target ?? null,
  })

  useEffect(() => {
    return host.subscribe((message) => {
      const next = asSnapshot(message)
      if (next) setSnapshot(next)
    })
  }, [host])

  useEffect(() => {
    if (!host.subscribeDraft) return
    return host.subscribeDraft((command) => {
      setInputMode(command.mode)
      setDraft(command.text)
      host.setState({ draft: command.text })
      if (command.pendingRequestId) {
        setPendingSend({ requestId: command.pendingRequestId, text: command.text })
      }
      if (command.focus) prompt.current?.focus()
    })
  }, [host])

  // Host 快照的 theme 写到 html/body，避免 :root 浅色把 IDEA 深色 LAF 盖成白页。
  useEffect(() => {
    const body = document.body
    if (body?.classList.contains("vscode-dark") || body?.classList.contains("vscode-light") || body?.classList.contains("vscode-high-contrast") || body?.classList.contains("vscode-high-contrast-light")) return
    const dark = snapshot.theme === "dark"
    const root = document.documentElement
    root.classList.toggle("codem-dark", dark)
    root.classList.toggle("codem-light", !dark)
    root.style.colorScheme = dark ? "dark" : "light"
  }, [snapshot.theme])

  // 账户页开合只归这里；Host 每请求一次就递增序号，返回聊天只改本地，下次请求照样打开。
  useEffect(() => {
    if (snapshot.accountRequest === accountRequest.current) return
    accountRequest.current = snapshot.accountRequest
    setAccountOpen(true)
  }, [snapshot.accountRequest])

  // 权限菜单同样按序号打开；忙碌、未登录时菜单本就不可用，这次请求直接作废，不留到之后补开。
  useEffect(() => {
    if (snapshot.permissionMenuRequest === permissionMenuRequest.current) return
    permissionMenuRequest.current = snapshot.permissionMenuRequest
    if (!isSignedIn(snapshot.account) || !sessionIdle(snapshot)) return
    setAccountOpen(false)
    setSlashOpen(false)
    setOpenMenu("permission")
  }, [snapshot])

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
    setSlashOpen(false)
    setInputMode("message")
  }, [snapshot.workspace, snapshot.space, snapshot.threadId])

  useEffect(() => {
    // 运行中可选 /steer，旁路提问中可选 /ask；其余忙碌阶段收起，规则见 phaseFlags。
    setSlashOpen(slash !== null && slashMenu)
  }, [slash, slashMenu])

  // 草稿只在宿主确认收下这条消息后才丢弃；没被受理就还回输入框。
  useEffect(() => {
    if (!pendingSend) return
    const retention = draftRetention(pendingSend, snapshot, draft)
    if (retention.kind === "waiting") return
    setPendingSend(null)
    if (retention.kind === "restore") saveDraft(retention.text)
    else if (retention.kind === "accepted" && draft === pendingSend.text) saveDraft("")
    if (retention.kind === "accepted") setInputMode("message")
  }, [snapshot, pendingSend, draft])

  useEffect(() => {
    const previous = accountStatus.current
    accountStatus.current = snapshot.account.status
    if (previous === "signedIn" && snapshot.account.status === "signingOut") saveDraft("")
    if (previous === "signingOut" && snapshot.account.status !== "signingOut" && snapshot.account.status !== "signedIn") {
      document.querySelector<HTMLButtonElement>(".accountLoginContent button")?.focus()
    }
  }, [snapshot.account.status])

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

  const mentions = useFileMentions({ draft, enabled: inputMode === "message" && !busy, prompt, fileSearch: snapshot.fileSearch, post, saveDraft })

  const themeClass = snapshot.theme === "dark" ? "codem-dark vscode-dark" : "codem-light"
  const showAccount = !signedIn || accountOpen
  const threadTitle = (snapshot.history.entries.find((entry) => entry.id === snapshot.threadId)?.title ?? snapshot.messages.find((message) => message.role === "user")?.text)?.slice(0, 30) || "新会话"
  const editorSurface = host.surface !== "sidebar"
  const activity = workingStatus(snapshot)
  const showWorking = activity !== null && !(snapshot.messages.length === 0 && snapshot.phase === "connecting")
  const modeHint = inputUnavailable(inputMode, snapshot) ?? modeText.hint
  const side = snapshot.sessionTools.sideQuestion
  const controls = visibleControls(snapshot)

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
    else if (id === "history") post({ type: snapshot.history.open ? "closeHistory" : "showHistory" })
    else if (id === "sendKey") post({ type: "setSendKey", sendKey: snapshot.sendKey === "enter" ? "modEnter" : "enter" })
    else if (sessionPanelCommands.includes(id) || isThreadOperation(id)) {
      setSessionRequest({ kind: "command", command: id })
    }
  }

  const submit = () => {
    if (pendingSend) return
    if (inputMode !== "shellCommand" && slash !== null) {
      setSlashOpen(true)
      return
    }
    const text = draft.trim()
    if (!text) return
    const id = nextRequestId("req")
    if (inputMode !== "message" && snapshot.threadId) {
      // Shell 先确认，确认前不发、不清草稿。
      if (inputMode === "shellCommand") {
        setSessionRequest({ kind: "shell", text })
        return
      }
      if (!tryPost({ type: inputMode, threadId: snapshot.threadId, text, requestId: id })) return
      setPendingSend({ requestId: id, text: draft })
      return
    }
    if (messageAction === "steer") {
      if (!snapshot.threadId) return
      if (!tryPost({ type: "steer", threadId: snapshot.threadId, text, requestId: id })) return
      setPendingSend({ requestId: id, text: draft })
      return
    }
    if (messageAction !== "send") return
    if (
      !tryPost({
        type: "send",
        text,
        requestId: id,
        ...(snapshot.selections.length ? { selectionIds: snapshot.selections.map((item) => item.id) } : {}),
        ...(snapshot.attachments.length ? { attachmentIds: snapshot.attachments.map((item) => item.id) } : {}),
      })
    ) return
    // 等待明确回执期间保留本地草稿，重载也不丢失。
    setPendingSend({ requestId: id, text: draft })
  }

  const confirmShell = (text: string) => {
    if (!snapshot.threadId || pendingSend) return
    const id = nextRequestId("req")
    if (!tryPost({ type: "shellCommand", threadId: snapshot.threadId, text, requestId: id })) {
      setSessionRequest({ kind: "shell", text })
      return
    }
    setPendingSend({ requestId: id, text: draft })
    setInputMode("message")
  }

  const pasteImages = (clipboard: DataTransfer | null) => {
    const files = Array.from(clipboard?.files ?? []).filter((file) => file.type.startsWith("image/"))
    if (files.length === 0) return
    if (inputMode !== "message" || turnActive) return
    const allowed = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
    if (files.some((file) => !allowed.has(file.type) || file.size === 0)) return
    if (files.reduce((size, file) => size + file.size, 0) > 20 * 1024 * 1024) return
    void Promise.all(
      files.map(
        (file) =>
          new Promise<{ mediaType: string; data: string }>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const value = String(reader.result ?? "")
              resolve({ mediaType: file.type, data: value.slice(value.indexOf(",") + 1) })
            }
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
          }),
      ),
    ).then((images) => post({ type: "pasteImages", requestId: nextRequestId("req"), images }))
  }

  return (
    <>
    {showAccount ? (
      <AccountPage account={account} brandMark={snapshot.brandMark} focusRequest={accountFocus} onBack={() => setAccountOpen(false)} post={post} />
    ) : null}
    <div className={`app ${themeClass}`} hidden={showAccount} data-codem-ui="shell" data-theme={snapshot.theme} data-phase={snapshot.phase} data-host="shared">
      <header className="sessionHeader">
        <span className="sessionTitle">
          <span className="sessionIcon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: uiIcon("chat") }} />
          <span id="sessionTitle">{threadTitle}</span>
          <span className="statusDot" data-connected={connected ? "true" : "false"} title="连接状态" />
        </span>
        <div className="headerActions">
          <ConversationSearch key={`${snapshot.workspace}:${snapshot.space}:${snapshot.threadId}`} snapshot={snapshot} post={post} />
          <PluginManagement key={`${snapshot.workspace}:${snapshot.space}`} snapshot={snapshot} post={post} />
          <ResourceTools snapshot={snapshot} post={post} />
          {isSignedIn(account) ? (
            <AccountTrigger
              account={account}
              onOpen={() => {
                setAccountFocus((value) => value + 1)
                setAccountOpen(true)
                post({ type: "refreshAccount" })
              }}
            />
          ) : null}
          {editorSurface ? (
            <div className="headerActions" id="standaloneActions">
              <HistoryButton snapshot={snapshot} post={post} />
              <Button type="button" variant="toolbar" size="toolbarIcon" id="newChat" title="新建会话" aria-label="新建会话" disabled={!idle} onClick={() => post({ type: "newChat" })} dangerouslySetInnerHTML={{ __html: uiIcon("plus") }} />
              <Button type="button" variant="toolbar" size="toolbarIcon" id="showOutput" title="查看 CodeM 日志" aria-label="查看 CodeM 日志" onClick={() => post({ type: "showOutput" })} dangerouslySetInnerHTML={{ __html: uiIcon("terminal") }} />
            </div>
          ) : null}
        </div>
      </header>
      <div className="timelineArea">
        <HistoryPanel snapshot={snapshot} post={post} />
        <main id="scrollArea" ref={scroller} onScroll={transcript.onScroll}>
          <section className="transcriptLoading" id="transcriptLoading" hidden={snapshot.phase !== "loadingHistory"} role="status" aria-live="polite">
            <span className="loadingSpinner" aria-hidden="true" />
            <span id="loadingLabel">正在恢复会话记录…</span>
            <div className="loadingLines" aria-hidden="true"><i /><i /><i /></div>
          </section>
          {snapshot.conversationSearch?.historical ? <div className="historyPaging"><span>正在查看搜索结果附近的历史消息</span><button type="button" className="textButton" disabled={busy} onClick={() => post({ type: "reloadHistory" })}>回到最新消息</button></div> : null}
          <HistoryPaging snapshot={snapshot} post={post} />
          <WelcomeView phase={snapshot.phase} hasMessages={!empty} hasWorkingStatus={activity !== null} brandMark={snapshot.brandMark} />
          <MessageList snapshot={snapshot} post={post} />
          <div id="workingRow" className="workingRow" role="status" aria-live="polite" hidden={!showWorking}>
            <span id="workingLabel">{activity ? <LoadingState label={activity.label} animate={activity.animate} /> : null}</span>
          </div>
        </main>
        <button type="button" className="jumpLatest" id="jumpLatest" hidden={!transcript.showJump} title="回到最新消息" aria-label="回到最新消息" onClick={transcript.jumpToLatest} dangerouslySetInnerHTML={{ __html: uiIcon("arrowUp") }} />
        <div id="taskProgressHost"><TaskProgress snapshot={snapshot} /></div>
      </div>
      <footer>
        <div id="connection" className="connection" hidden={!controls.retry}>
          <p>连接工作区，开始与 CodeM 协作。</p>
          <div><button id="connect" type="button" className="primaryButton" onClick={() => post({ type: "connect" })}>连接工作区</button></div>
        </div>
        <HistoryResume snapshot={snapshot} post={post} />
        <p id="notice" className="notice" role="status" hidden={!snapshot.notice}>{snapshot.notice ?? ""}</p>
        <DecisionPanel panel={snapshot.pendingPanel} post={post} />
        <RewindPanel panel={snapshot.pendingPanel} post={post} />
        {sessionRequest ? <SessionCommandPanel snapshot={snapshot} request={sessionRequest} close={() => setSessionRequest(null)} post={post} onShell={confirmShell} /> : null}
        <form
          ref={composer}
          id="composer"
          className="composer"
          data-testid="composerMenus"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div id="attachments" className="attachments" aria-label="待发送附件" hidden={inputMode !== "message"}>
            {inputMode === "message" ? <CodeSelectionList items={snapshot.selections} disabled={Boolean(snapshot.pendingPanel)} post={post} /> : null}
            {snapshot.attachments.map((item) => <AttachmentCard key={item.id} item={item} disabled={Boolean(snapshot.pendingPanel)} post={post} />)}
          </div>
          {inputMode !== "message" ? (
            <div className="composerModeBar" data-testid="inputMode">
              <span>
                {inputMode === "shellCommand" ? <TerminalIcon aria-hidden="true" /> : <MessageSquarePlusIcon aria-hidden="true" />}
                {modeText.label}
              </span>
              <Button type="button" variant="ghost" size="sm" aria-label="返回普通对话" onClick={() => setInputMode("message")}>
                <XIcon aria-hidden="true" />
                返回对话
              </Button>
              <p>{modeHint}{snapshot.attachments.length ? ` ${snapshot.attachments.length} 个附件保留给普通消息。` : ""}</p>
            </div>
          ) : null}
          {inputMode === "askSideQuestion" && side ? (
            <section className="composerSideAnswer" aria-label="旁路问答">
              <strong>{side.question}</strong>
              <pre>{side.answer}</pre>
              <div className="sessionToolActions">
                <span role="status">{{ starting: "正在提交", running: "正在回答", stopping: "正在取消", completed: "已完成", interrupted: "已取消", failed: "失败", incomplete: "连接中断，未完成" }[side.status]}</span>
                {side.status === "running" || side.status === "stopping" ? (
                  <Button type="button" variant="outline" size="sm" disabled={side.status === "stopping"} onClick={() => post({ type: "cancelSideQuestion" })}>取消旁路提问</Button>
                ) : null}
              </div>
            </section>
          ) : null}
          <label className="visuallyHidden" htmlFor="prompt">
            {modeText.field}
          </label>
          <textarea
            ref={prompt}
            id="prompt"
            data-testid="composer"
            rows={2}
            maxLength={32000}
            spellCheck={false}
            placeholder={modeText.placeholder}
            value={draft}
            disabled={snapshot.pendingPanel !== null}
            {...mentions.inputProps}
            onChange={(event) => saveDraft(event.target.value)}
            onPaste={(event) => pasteImages(event.clipboardData)}
            onKeyDown={(event) => {
              if (mentions.keyDown(event)) return
              if (
                event.key === "Enter" &&
                !slashOpen &&
                sendOnEnter(snapshot.sendKey, event.shiftKey, event.metaKey || event.ctrlKey, event.nativeEvent.isComposing)
              ) {
                event.preventDefault()
                submit()
              }
            }}
          />
          {mentions.menu ? <FileMentions menu={mentions.menu} anchor={composer} /> : null}
          {slashOpen && slash !== null ? (
            <SlashMenu snapshot={snapshot} query={slash} anchor={prompt} onClose={(focus) => {
              setSlashOpen(false)
              if (focus) prompt.current?.focus()
            }} onChoose={chooseSlash} />
          ) : null}
          <div className="composerToolbar">
            <div className="composerLeading">
              <ComposerMenus snapshot={snapshot} enabled={idle} openMenu={openMenu} setOpenMenu={setOpenMenu} post={post} region="leading" />
            </div>
            <div className="composerTrailing">
              <ComposerMenus snapshot={snapshot} enabled={idle} openMenu={openMenu} setOpenMenu={setOpenMenu} post={post} region="trailing" />
              <button type="submit" className="sendButton" id="send" data-testid="send" hidden={generating && inputMode !== "steer"} aria-label={modeText.submit} title={snapshot.sendKey === "modEnter" ? "发送消息 · Ctrl / Cmd + Enter" : "发送消息 · Enter"} disabled={Boolean(pendingSend) || (slash === null && (Boolean(inputUnavailable(inputMode, snapshot)) || !draft.trim() || snapshot.selections.some((item) => item.error)))} dangerouslySetInnerHTML={{ __html: uiIcon("arrowUp") }} />
              <button type="button" className="stopButton" id="stop" data-testid="stop" hidden={!generating} disabled={snapshot.phase === "stopping"} aria-label="停止生成" title="停止生成" onClick={() => post({ type: "stop" })} dangerouslySetInnerHTML={{ __html: uiIcon("stop") }} />
            </div>
          </div>
        </form>
        <div className="footerMeta">
          <span className="environment" dangerouslySetInnerHTML={{ __html: `${uiIcon("monitor")}<span>本地</span>` }} />
          <ComposerMenus snapshot={snapshot} enabled={idle} openMenu={openMenu} setOpenMenu={setOpenMenu} post={post} region="space" />
          <span className="workspaceLabel">
            <span dangerouslySetInnerHTML={{ __html: uiIcon("folder") }} />
            <span id="workspace">{snapshot.workspace ?? "未连接工作区"}</span>
          </span>
          <span id="runtimeDetailsHost"><RuntimeDetails snapshot={snapshot} /></span>
          <span className="visuallyHidden" id="status" role="status" aria-live="polite">{snapshot.phase === "sideQuestion" ? "正在旁路提问，输入 /ask 查看或取消…" : ""}</span>
        </div>
      </footer>
    </div>
    </>
  )
}

