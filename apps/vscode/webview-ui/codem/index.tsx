/** @jsxImportSource react */
import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { Button } from "@codem/ui/components/button"
import type {
  CodeMHostToWebviewMessage,
  CodeMWebviewState,
  CodeMWebviewToHostMessage,
} from "../../src/shared/codem-webview"
import "./style.css"

declare function acquireVsCodeApi(): { postMessage(message: CodeMWebviewToHostMessage): void }

const vscode = acquireVsCodeApi()
const initialState: CodeMWebviewState = {
  authenticated: false,
  trusted: true,
  workspaceName: null,
  threadId: null,
  threads: [],
  messages: [],
  running: false,
  error: null,
  interaction: null,
}

function App(): React.ReactElement {
  const [state, setState] = useState(initialState)
  const [prompt, setPrompt] = useState("")
  const canSend =
    state.authenticated && state.trusted && Boolean(state.workspaceName) && !state.running && prompt.trim().length > 0

  useEffect(() => {
    const listener = (event: MessageEvent<CodeMHostToWebviewMessage>) => {
      if (event.data.type === "state") setState(event.data.state)
    }
    window.addEventListener("message", listener)
    vscode.postMessage({ type: "ready" })
    return () => window.removeEventListener("message", listener)
  }, [])

  const activeTitle = useMemo(
    () => state.threads.find((thread) => thread.id === state.threadId)?.preview || "New task",
    [state.threadId, state.threads],
  )

  const send = () => {
    const text = prompt.trim()
    if (!text || !canSend) return
    setPrompt("")
    vscode.postMessage({ type: "send", submissionId: crypto.randomUUID(), text })
  }

  if (!state.trusted) {
    return (
      <Empty
        title="Workspace Trust required"
        detail="Trust this workspace before CodeM can start Core or read project files."
      />
    )
  }
  if (!state.workspaceName) return <Empty title="Open a folder" detail="CodeM threads belong to a workspace folder." />
  if (!state.authenticated) {
    return (
      <Empty title="Sign in to CodeM" detail="Use the browser flow to sign in or create an account.">
        <Button onClick={() => vscode.postMessage({ type: "sign-in" })}>Sign in or register</Button>
      </Empty>
    )
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">M</span>
          <strong>CodeM</strong>
        </div>
        <div className="actions">
          <Button variant="ghost" size="sm" onClick={() => vscode.postMessage({ type: "open-settings" })}>
            Settings
          </Button>
          <Button variant="ghost" size="sm" onClick={() => vscode.postMessage({ type: "sign-out" })}>
            Sign out
          </Button>
        </div>
      </header>
      <section className="taskbar">
        <select
          aria-label="Thread"
          value={state.threadId ?? ""}
          onChange={(event) =>
            event.target.value && vscode.postMessage({ type: "open-thread", threadId: event.target.value })
          }
        >
          <option value="">{activeTitle}</option>
          {state.threads.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.preview || thread.id}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => vscode.postMessage({ type: "new-thread" })}>
          New task
        </Button>
      </section>
      <section className="messages" aria-live="polite">
        {state.messages.length === 0 ? (
          <div className="welcome">
            <h1>What should we build?</h1>
            <p>CodeM Core owns the thread and conversation history.</p>
          </div>
        ) : (
          state.messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <span className="role">{message.role === "user" ? "You" : "CodeM"}</span>
              <div>
                {message.text}
                {message.pending ? <span className="cursor" /> : null}
              </div>
            </article>
          ))
        )}
      </section>
      {state.interaction ? <Interaction state={state} /> : null}
      {state.error ? (
        <div className="error" role="alert">
          {state.error}
        </div>
      ) : null}
      <footer className="composer">
        <textarea
          aria-label="Message CodeM"
          placeholder="Ask CodeM to work on this project…"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="composer-actions">
          <span>{state.running ? "Core is working…" : "Enter to send · Shift+Enter for a new line"}</span>
          {state.running ? (
            <Button variant="outline" size="sm" onClick={() => vscode.postMessage({ type: "interrupt" })}>
              Stop
            </Button>
          ) : (
            <Button size="sm" disabled={!canSend} onClick={send}>
              Send
            </Button>
          )}
        </div>
      </footer>
    </main>
  )
}

function Interaction({ state }: { readonly state: CodeMWebviewState }): React.ReactElement | null {
  const interaction = state.interaction
  if (!interaction) return null
  if (interaction.kind === "permission") {
    return (
      <aside className="interaction">
        <strong>{interaction.toolName} needs approval</strong>
        <p>{interaction.reason || interaction.preview.kind}</p>
        <div className="interaction-actions">
          {interaction.options.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={option.id.includes("reject") ? "outline" : "default"}
              onClick={() =>
                vscode.postMessage({
                  type: "interaction-response",
                  requestId: interaction.requestId,
                  response: { kind: "permission", optionId: option.id },
                })
              }
            >
              {option.label}
            </Button>
          ))}
        </div>
      </aside>
    )
  }
  if (interaction.kind === "plan") {
    return (
      <aside className="interaction">
        <strong>Review CodeM's plan</strong>
        <pre>{interaction.plan}</pre>
        <div className="interaction-actions">
          <Button size="sm" onClick={() => respond(interaction.requestId, { kind: "plan", approved: true })}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              respond(interaction.requestId, { kind: "plan", approved: false, feedback: "Please revise the plan." })
            }
          >
            Request changes
          </Button>
        </div>
      </aside>
    )
  }
  if (interaction.kind === "plan-mode") {
    return (
      <aside className="interaction">
        <strong>Leave plan mode?</strong>
        <div className="interaction-actions">
          <Button size="sm" onClick={() => respond(interaction.requestId, { kind: "plan-mode", approved: true })}>
            Continue
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => respond(interaction.requestId, { kind: "plan-mode", approved: false })}
          >
            Stay in plan mode
          </Button>
        </div>
      </aside>
    )
  }
  if (interaction.kind === "question") return <QuestionInteraction interaction={interaction} />
  return <RewindInteraction interaction={interaction} />
}

function QuestionInteraction({
  interaction,
}: {
  readonly interaction: Extract<NonNullable<CodeMWebviewState["interaction"]>, { kind: "question" }>
}): React.ReactElement {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  return (
    <aside className="interaction">
      <strong>CodeM needs your input</strong>
      {interaction.questions.map((question) => (
        <label className="question" key={question.id}>
          <span>{question.header || question.question}</span>
          <input
            value={answers[question.id] ?? ""}
            onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
            placeholder={question.question}
          />
        </label>
      ))}
      <div className="interaction-actions">
        <Button
          size="sm"
          onClick={() =>
            respond(interaction.requestId, {
              kind: "question",
              cancelled: false,
              answers: interaction.questions.map((question) => ({
                question: question.question,
                selected: [],
                freeText: answers[question.id]?.trim() || null,
              })),
            })
          }
        >
          Submit
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => respond(interaction.requestId, { kind: "question", cancelled: true })}
        >
          Cancel
        </Button>
      </div>
    </aside>
  )
}

function RewindInteraction({
  interaction,
}: {
  readonly interaction: Extract<NonNullable<CodeMWebviewState["interaction"]>, { kind: "rewind" }>
}): React.ReactElement {
  const [checkpointId, setCheckpointId] = useState(interaction.checkpoints[0]?.id ?? "")
  const [mode, setMode] = useState<"code" | "conversation" | "both">(interaction.modes[0] ?? "both")
  return (
    <aside className="interaction">
      <strong>Choose a rewind point</strong>
      <select value={checkpointId} onChange={(event) => setCheckpointId(event.target.value)}>
        {interaction.checkpoints.map((checkpoint) => (
          <option key={checkpoint.id} value={checkpoint.id}>
            {checkpoint.label}
          </option>
        ))}
      </select>
      <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
        {interaction.modes.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>
      <div className="interaction-actions">
        <Button
          size="sm"
          disabled={!checkpointId}
          onClick={() => respond(interaction.requestId, { kind: "rewind", cancelled: false, checkpointId, mode })}
        >
          Rewind
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => respond(interaction.requestId, { kind: "rewind", cancelled: true })}
        >
          Cancel
        </Button>
      </div>
    </aside>
  )
}

function respond(requestId: string, response: unknown): void {
  vscode.postMessage({ type: "interaction-response", requestId, response })
}

function Empty(props: {
  readonly title: string
  readonly detail: string
  readonly children?: React.ReactNode
}): React.ReactElement {
  return (
    <main className="empty">
      <span className="hero-mark">M</span>
      <h1>{props.title}</h1>
      <p>{props.detail}</p>
      {props.children}
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
