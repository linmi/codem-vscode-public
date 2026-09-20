import assert from "node:assert/strict"
import { it } from "node:test"
import { parseViewAction } from "../src/shared/messages.ts"
import { chatHtml } from "../src/chat/html.ts"

it("accepts only supported actions and bounded text; refuses raw RPC, paths and extra fields", () => {
  assert.deepEqual(parseViewAction({ type: "send", text: "hello", requestId: "request-1" }), { type: "send", text: "hello", requestId: "request-1" })
  for (const requestId of ["", "../x", 1, "a".repeat(101)]) assert.throws(() => parseViewAction({ type: "send", text: "hello", requestId }))
  assert.throws(() => parseViewAction({ type: "send", text: "hello" }))
  for (const text of [" ", "x".repeat(32_001)]) assert.throws(() => parseViewAction({ type: "send", text, requestId: "valid" }))
  assert.deepEqual(parseViewAction({ type: "ready" }), { type: "ready" })
  for (const input of [null, [], { type: "send", text: " " }, { type: "send", text: "x".repeat(32_001) }, { type: "send", text: "hi", cwd: "/tmp" }, { type: "connect", environment: {} }, { type: "request", method: "turn/start" }]) {
    assert.throws(() => parseViewAction(input))
  }
})

it("uses a fresh CSP nonce, escapes resources and prohibits inline handlers and restricts remote images to avatar CDNs", () => {
  const options = { surface: "editor" as const, script: 'resource/script.js" onload="bad()', style: "resource/style.css", logo: "resource/logo.svg", cspSource: "https://resource.test" }
  const first = chatHtml(options)
  const second = chatHtml(options)
  assert.match(first, /img-src https:\/\/resource\.test data: https:\/\/feishucdn\.com https:\/\/\*\.feishucdn\.com https:\/\/larksuitecdn\.com https:\/\/\*\.larksuitecdn\.com;/)
  assert.doesNotMatch(first, /img-src[^;]*https:;/)
  assert.match(first, /default-src 'none'/)
  assert.match(first, /form-action 'none'/)
  assert.doesNotMatch(first, /unsafe-inline|unsafe-eval| onload="/)
  assert.match(first, /script\.js&quot;/)
  const nonce = first.match(/nonce="([^"]+)"/)?.[1]
  assert.ok(nonce)
  assert.ok(first.includes("style-src https://resource.test 'nonce-" + nonce + "';"))
  assert.ok(first.includes("script-src 'nonce-" + nonce + "';"))
  assert.notEqual(first.match(/nonce="([^"]+)"/)?.[1], second.match(/nonce="([^"]+)"/)?.[1])
})

it("accepts feature intents and opaque handles without accepting executable inputs", () => {
  for (const type of ["refreshSpaces", "manageMcp", "refreshTools", "refreshBackground", "cleanBackground"]) assert.deepEqual(parseViewAction({ type }), { type })
  for (const type of ["removeAttachment", "openDiff", "openChangedFile", "openBackgroundLog", "terminateBackground", "cancelBackgroundTask"]) {
    assert.deepEqual(parseViewAction({ type, id: "opaque-id" }), { type, id: "opaque-id" })
    for (const id of ["../secret", "/path", "", 42, "x".repeat(101)]) assert.throws(() => parseViewAction({ type, id }))
    assert.throws(() => parseViewAction({ type, id: "valid", path: "/private" }))
  }
  for (const value of [{ type: "selectModel", model: "injected" }, { type: "selectPermission", mode: "yolo" }, { type: "manageMcp", command: "/bin/sh" }, { type: "addAttachment", path: "/private" }]) assert.throws(() => parseViewAction(value))
})

it("accepts history intents but refuses paths, caller-supplied cursors and malformed thread IDs", () => {
  for (const type of ["showHistory", "closeHistory", "refreshHistory", "moreThreads", "olderMessages", "reloadHistory"]) {
    assert.deepEqual(parseViewAction({ type }), { type })
    assert.throws(() => parseViewAction({ type, cursor: "opaque" }))
  }
  assert.deepEqual(parseViewAction({ type: "resumeThread", threadId: "thread_1-abc" }), { type: "resumeThread", threadId: "thread_1-abc" })
  for (const threadId of ["", "../thread", "/tmp/thread", "thread\\path", " a ", "a".repeat(129)]) assert.throws(() => parseViewAction({ type: "resumeThread", threadId }))
  assert.throws(() => parseViewAction({ type: "resumeThread", threadId: "valid", cwd: "/workspace" }))
})

it("accepts bounded drafts and rejects arbitrary properties and malformed tool state", () => {
  assert.deepEqual(parseViewAction({ type: "composerChanged", value: { draft: "code" } }), { type: "composerChanged", value: { draft: "code" } })
  for (const value of [{ draft: "x".repeat(32001) }, { draft: "", path: "/etc/passwd" }, { draft: "", tools: { scope: "t", text: "x", mode: "shell" } }, []]) {
    assert.throws(() => parseViewAction({ type: "composerChanged", value }))
  }
})

it("accepts only builtin effort values and rejects the obsolete menu request", () => {
  for (const effort of ["low", "medium", "high", "xhigh"]) assert.deepEqual(parseViewAction({ type: "setEffort", effort }), { type: "setEffort", effort })
  for (const value of [{ type: "selectEffort" }, { type: "setEffort" }, { type: "setEffort", effort: "max" }, { type: "setEffort", effort: null }, { type: "setEffort", effort: "high", model: "injected" }]) assert.throws(() => parseViewAction(value))
})

it("uses value-bearing composer actions and rejects obsolete menu-opening requests", () => {
  for (const value of [{ type: "setWorkMode", workMode: "plan" }, { type: "setPermission", permission: "auto" }, { type: "pickAttachment", kind: "file" }, { type: "chooseModel", id: "opaque-model" }, { type: "chooseSpace", id: "opaque-space" }]) assert.deepEqual(parseViewAction(value), value)
  for (const type of ["selectModel", "selectSpace", "selectWorkMode", "selectPermission", "addAttachment"]) assert.throws(() => parseViewAction({ type }))
  for (const value of [{ type: "setWorkMode", workMode: "normal" }, { type: "setPermission", permission: "admin" }, { type: "pickAttachment", kind: "remote" }, { type: "chooseModel", id: "path/to/model" }, { type: "chooseSpace", id: "ok", key: "injected" }]) assert.throws(() => parseViewAction(value))
})
