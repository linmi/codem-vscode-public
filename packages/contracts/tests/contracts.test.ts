import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, describe, it } from "node:test"
import { PassThrough } from "node:stream"
import { createInterface } from "node:readline"
import {
  APP_SERVER_CORE_VERSION,
  APP_SERVER_CLI_VERSION,
  APP_SERVER_PROTOCOL_VERSION,
  APP_SERVER_KNOWN_NOTIFICATIONS,
  AppServerRpcPeer,
  parseAppServerItem,
  validateAppServerInitializeResult,
} from "@codem/app-server"
import { resolveSessionsRoot, readSessionHistory } from "@codem/history"
import { parseUiAction } from "@codem/ui/contract"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const temporary: string[] = []
after(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
}

function requireSampleMeta(sample: Record<string, unknown>, file: string): void {
  for (const key of ["id", "capabilityId", "provenance"]) {
    if (sample[key] === undefined) throw new Error(`${file} is missing ${key}`)
  }
  const provenance = sample.provenance as Record<string, unknown>
  if (!Array.isArray(provenance.paths) || provenance.paths.length === 0) {
    throw new Error(`${file} provenance.paths must be a non-empty array`)
  }
}

describe("@codem/contracts package integrity", () => {
  it("keeps the machine-readable baseline aligned with the Node runtime constants", async () => {
    const manifest = await readJson(join(root, "manifest.json"))
    assert.equal(manifest.coreVersion, APP_SERVER_CORE_VERSION)
    assert.equal(manifest.cliVersion, APP_SERVER_CLI_VERSION)
    assert.equal(manifest.protocolVersion, APP_SERVER_PROTOCOL_VERSION)
    assert.equal(manifest.historySchema, 13)
    assert.equal(manifest.spaceBrokerProtocol, "2025-03-26")
  })

  it("requires every sample to name an id, capability and source path", async () => {
    const files = [
      "core/initializeHandshake.json",
      "core/rpcUnknownId.json",
      "core/rpcOmittedJsonrpc.json",
      "core/rpcDuplicateResponse.json",
      "core/rpcInvalidFrame.json",
      "core/rpcClosedConnection.json",
      "core/streamingWhitespace.json",
      "core/turnCompletedTerminal.json",
      "core/unsupportedClientRequest.json",
      "core/approvalRequest.json",
      "core/interactionReplies.json",
      "core/knownNotifications.json",
      "core/jsonText.json",
      "core/itemProjection.json",
      "webview/sendAction.json",
      "webview/panelReply.json",
      "webview/initialSnapshot.json",
      "history/multiTurn.expected.json",
      "history/trailingFragment.expected.json",
      "history/badCompleteLine.expected.json",
      "history/identityMismatch.expected.json",
    ]
    const ids = new Set<string>()
    for (const file of files) {
      const sample = await readJson(join(root, file))
      requireSampleMeta(sample, file)
      const id = String(sample.id)
      assert.equal(ids.has(id), false, `duplicate sample id ${id}`)
      ids.add(id)
    }
  })

  it("rejects shipping credentials or private home paths in sample files", async () => {
    const files = [
      "manifest.json",
      "core/initializeHandshake.json",
      "webview/sendAction.json",
      "history/multiTurn.jsonl",
    ]
    for (const file of files) {
      const text = await readFile(join(root, file), "utf8")
      assert.doesNotMatch(text, /sk-[A-Za-z0-9]|password\s*[:=]|\/Users\/[A-Za-z]/u)
    }
  })
})

describe("core transport samples", () => {
  it("accepts a response that omits jsonrpc and records that compatibility", async () => {
    const sample = await readJson(join(root, "core/rpcOmittedJsonrpc.json"))
    const fixture = createPeer()
    const written = onceLine(fixture.writes)
    const response = fixture.peer.request("initialize")
    const request = JSON.parse(await written) as { readonly id: number }
    fixture.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: 1 } })}\n`)
    assert.deepEqual(await response, { protocolVersion: 1 })
    assert.equal(fixture.peer.responseJsonrpc, "omitted")
    fixture.stdout.end()
    await fixture.peer.close()
    assert.equal((sample.expected as { responseJsonrpc: string }).responseJsonrpc, "omitted")
  })

  it("fails closed on an unknown response id", async () => {
    const errors: Error[] = []
    const fixture = createPeer(errors)
    fixture.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 99, result: { ok: true } })}\n`)
    await waitFor(() => errors.length === 1)
    assert.match(errors[0]!.message, /unknown request/u)
    fixture.stdout.end()
    await fixture.peer.close()
  })

  it("fails closed on a duplicate response after the first result is delivered", async () => {
    const errors: Error[] = []
    const fixture = createPeer(errors)
    const written = onceLine(fixture.writes)
    const response = fixture.peer.request("thread/start")
    const request = JSON.parse(await written) as { readonly id: number }
    fixture.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { thread: { id: "thread-1" } } })}\n`)
    assert.deepEqual(await response, { thread: { id: "thread-1" } })
    fixture.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { thread: { id: "thread-1" } } })}\n`)
    await waitFor(() => errors.length === 1)
    assert.match(errors[0]!.message, /unknown request/u)
    fixture.stdout.end()
    await fixture.peer.close()
  })

  it("rejects invalid frames instead of skipping them", async () => {
    const sample = await readJson(join(root, "core/rpcInvalidFrame.json"))
    const cases = sample.cases as readonly { readonly name: string; readonly frameText?: string; readonly frame?: unknown }[]
    for (const testCase of cases) {
      const errors: Error[] = []
      const fixture = createPeer(errors)
      const line = testCase.frameText ?? JSON.stringify(testCase.frame)
      fixture.stdout.write(`${line}\n`)
      await waitFor(() => errors.length === 1)
      assert.ok(errors[0] instanceof Error, testCase.name)
      fixture.stdout.end()
      await fixture.peer.close()
    }
  })

  it("keeps the known notification set identical to the Node host", async () => {
    const sample = await readJson(join(root, "core/knownNotifications.json"))
    assert.deepEqual(sample.methods, [...APP_SERVER_KNOWN_NOTIFICATIONS])
  })

  it("accepts the recorded Core initialize result and still requires each announced item kind", async () => {
    const sample = await readJson(join(root, "core/initializeHandshake.json"))
    const events = sample.events as readonly { readonly direction: string; readonly frame: { readonly result?: Record<string, unknown> } }[]
    const result = events.find(event => event.direction === "core-to-host")!.frame.result!
    const runtime = { coreVersion: String(sample.coreVersion), executablePath: "codem-core" }
    const expected = sample.expected as { readonly protocolVersion: number; readonly agentVersion: string }
    assert.deepEqual(validateAppServerInitializeResult(result, runtime), { protocolVersion: expected.protocolVersion, agentVersion: expected.agentVersion })

    const items = (result.capabilities as { readonly items: { readonly types: readonly string[] } }).items
    for (const type of items.types) {
      const missing = structuredClone(result) as { capabilities: { items: { types: string[] } } }
      missing.capabilities.items.types = items.types.filter(value => value !== type)
      assert.throws(() => validateAppServerInitializeResult(missing, runtime), new RegExp(`items\\.types is missing ${type}$`, "u"))
    }
  })

  it("agrees with JSON.parse on every RFC 8259 text sample", async () => {
    const sample = await readJson(join(root, "core/jsonText.json"))
    const cases = sample.cases as readonly { readonly name: string; readonly text: string; readonly expected: { readonly kind: string; readonly value?: unknown } }[]
    assert.ok(cases.length > 0)
    for (const testCase of cases) {
      if (testCase.expected.kind === "accepted") {
        // Serialized comparison keeps object key order in the contract.
        assert.equal(JSON.stringify(JSON.parse(testCase.text)), JSON.stringify(testCase.expected.value), testCase.name)
      } else {
        assert.equal(testCase.expected.kind, "protocol-error", testCase.name)
        assert.throws(() => JSON.parse(testCase.text), SyntaxError, testCase.name)
      }
    }
  })

  it("derives the presentation fields of every item sample like the Node host", async () => {
    const sample = await readJson(join(root, "core/itemProjection.json"))
    const cases = sample.cases as readonly { readonly name: string; readonly item: unknown; readonly expected: Record<string, unknown> }[]
    assert.ok(cases.length > 0)
    for (const testCase of cases) {
      if (testCase.expected.kind === "accepted") {
        const item = parseAppServerItem(testCase.item, "item")
        const { toolName, callId, input, finalAnswer } = testCase.expected
        assert.deepEqual({ toolName: item.toolName, callId: item.callId, input: item.input, finalAnswer: item.finalAnswer }, { toolName, callId, input, finalAnswer }, testCase.name)
      } else {
        assert.deepEqual(testCase.expected, { kind: "protocol-error", class: "invalid-frame" }, testCase.name)
        assert.throws(() => parseAppServerItem(testCase.item, "item"), testCase.name)
      }
    }
  })

  it("concatenates streaming text including blank and tab deltas", async () => {
    const sample = await readJson(join(root, "core/streamingWhitespace.json"))
    const events = sample.events as readonly { readonly params: { readonly delta: string } }[]
    const text = events.map((event) => event.params.delta).join("")
    assert.equal(text, (sample.expected as { text: string }).text)
  })
})

describe("webview action samples", () => {
  it("accepts and rejects the documented send and panel replies", async () => {
    const send = await readJson(join(root, "webview/sendAction.json"))
    const panel = await readJson(join(root, "webview/panelReply.json"))
    const snapshot = await readJson(join(root, "webview/initialSnapshot.json"))
    for (const testCase of send.cases as readonly { name: string; input: unknown; expected: { kind: string } }[]) {
      assert.equal(classifyViewAction(testCase.input), testCase.expected.kind, testCase.name)
    }
    for (const testCase of panel.cases as readonly { name: string; input: unknown; expected: { kind: string } }[]) {
      assert.equal(classifyViewAction(testCase.input), testCase.expected.kind, testCase.name)
    }
    const expected = snapshot.expected as { hiddenUntilReady: string[]; canRetry: boolean }
    assert.deepEqual(expected.hiddenUntilReady, ["olderMessages", "retryConnect", "resumeThread"])
    assert.equal(expected.canRetry, false)
  })
})

describe("core interaction reply samples", () => {
  it("records Node-shaped question, plan and rewind results rather than webview choiceIds", async () => {
    const sample = await readJson(join(root, "core/interactionReplies.json"))
    const cases = sample.cases as readonly { name: string; expected: Record<string, unknown> }[]
    const byName = Object.fromEntries(cases.map((entry) => [entry.name, entry.expected]))
    assert.ok(Array.isArray(byName["question-answers"]!.answers))
    assert.equal((byName["question-answers"] as { answers: { question: string }[] }).answers[0]!.question, "Which files?")
    assert.equal(byName["question-cancel"]!.cancelled, true)
    assert.equal(byName["plan-approved"]!.approved, true)
    assert.equal(byName["plan-rejected"]!.feedback, "need a smaller change")
    assert.equal(byName["rewind-selected"]!.checkpointId, "cp-1")
    assert.equal(byName["rewind-cancel"]!.status, "cancelled")
    for (const expected of cases.map((entry) => entry.expected)) {
      assert.equal("choiceIds" in expected, false, "Core replies must not use webview choiceIds")
    }
  })
})

describe("history projection samples", () => {
  it("replays the multi-turn fixture and hides synthetic model input", async () => {
    const expected = await readJson(join(root, "history/multiTurn.expected.json"))
    const page = await replayFixture("multiTurn.jsonl", "thread-1")
    assert.deepEqual(
      page.turns.map((entry) => entry.submissionId),
      expected.expected && (expected.expected as { submissionIds: string[] }).submissionIds,
    )
    const userTexts = page.turns.map((entry) =>
      entry.turn.items.filter((item) => item.kind === "message" && item.role === "user").map((item) => (item.kind === "message" ? item.text : "")),
    )
    assert.deepEqual(userTexts, (expected.expected as { userTexts: string[][] }).userTexts)
    const assistant = page.turns[0]!.turn.items.find((item) => item.kind === "message" && item.role === "assistant")
    assert.equal(assistant && assistant.kind === "message" ? assistant.text : "", (expected.expected as { firstAssistantText: string }).firstAssistantText)
  })

  it("ignores an uncommitted trailing fragment and rejects a complete bad line", async () => {
    const page = await replayFixture("trailingFragment.jsonl", "thread-1")
    assert.equal(page.turns.length, 1)
    await assert.rejects(replayFixture("badCompleteLine.jsonl", "thread-1"), /record|JSON|type/u)
    await assert.rejects(replayFixture("multiTurn.jsonl", "other-thread"), /does not match|session_id/u)
  })

  it("uses the Core session root order rather than CODEM_HOME", () => {
    const home = "/tmp/codem-home-fixture"
    assert.equal(resolveSessionsRoot({ LINCO_SESSIONS_ROOT: "/tmp/sessions" }, home), "/tmp/sessions")
    assert.equal(resolveSessionsRoot({ LINCO_HOME: home }, home), join(home, "sessions"))
    assert.equal(resolveSessionsRoot({}, home), join(home, ".codem", "sessions"))
  })
})

async function replayFixture(file: string, threadId: string) {
  const cwd = "/workspace"
  const sessionsRoot = await mkdtemp(join(tmpdir(), "codem-contracts-history-"))
  temporary.push(sessionsRoot)
  const directory = join(sessionsRoot, createHash("sha256").update(cwd).digest("hex").slice(0, 16))
  await mkdir(directory)
  const text = (await readFile(join(root, "history", file), "utf8")).replaceAll("${cwd}", cwd)
  await writeFile(join(directory, `${threadId}.jsonl`), text)
  return readSessionHistory({ sessionsRoot, cwd, threadId })
}

function classifyViewAction(value: unknown): "accepted" | "rejected" {
  try {
    parseUiAction(value)
    return "accepted"
  } catch {
    return "rejected"
  }
}

function createPeer(errors: Error[] = []) {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const writes: string[] = []
  stdin.on("data", (chunk: Buffer | string) => {
    writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"))
  })
  const peer = new AppServerRpcPeer({
    stdin,
    stdoutLines: createInterface({ input: stdout, crlfDelay: Infinity }),
    onNotification: () => undefined,
    onRequest: () => undefined,
    onProtocolError: (error) => errors.push(error),
  })
  return { peer, stdout, writes }
}

function onceLine(writes: string[]): Promise<string> {
  return waitFor(() => writes.join("").includes("\n")).then(() => writes.splice(0).join("").trim())
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error("timed out waiting for contract fixture")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
