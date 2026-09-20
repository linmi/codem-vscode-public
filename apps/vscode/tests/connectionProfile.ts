import assert from "node:assert/strict"
import { connectRuntime } from "../src/connection/runtimeSession.ts"
import type { ChatSession } from "../src/chat/chatController.ts"
// Resolved only by the explicit profiling build adapter.
import { counts, timings } from "observedAppServer"
declare const PROFILE_WORKSPACE: string
declare const PROFILE_EXTENSION: string
declare const PROFILE_SPACE: string | null
async function run(): Promise<void> {
const abort = new AbortController()
let first: ChatSession | null = null
let second: ChatSession | null = null
try {
  let start = performance.now()
  first = await connectRuntime(PROFILE_EXTENSION, "0.2.0", abort.signal, PROFILE_SPACE ? { cwd: PROFILE_WORKSPACE, workspace: "profile", key: PROFILE_SPACE } : undefined)
  const cold = { ms: Math.round(performance.now() - start), calls: { ...counts }, stages: timings.splice(0) }
  assert.deepEqual(cold.calls, { auth: 1, list: 1, prepare: 1, brokers: 1 })
  start = performance.now()
  for (let i = 0; i < 20; i++) assert.ok(first.spaceDirectory.list().length)
  const menu = { ms: Number((performance.now() - start).toFixed(3)), calls: { auth: counts.auth - cold.calls.auth, list: counts.list - cold.calls.list, prepare: counts.prepare - cold.calls.prepare, brokers: counts.brokers - cold.calls.brokers }, stages: timings.splice(0) }
  assert.deepEqual(menu.calls, { auth: 0, list: 0, prepare: 0, brokers: 0 })
  start = performance.now()
  second = await connectRuntime(PROFILE_EXTENSION, "0.2.0", abort.signal, { cwd: PROFILE_WORKSPACE, workspace: first.workspace, key: first.space.key }, first.spaceDirectory)
  const switchPreflight = { ms: Math.round(performance.now() - start), calls: { auth: counts.auth - cold.calls.auth, list: counts.list - cold.calls.list, prepare: counts.prepare - cold.calls.prepare, brokers: counts.brokers - cold.calls.brokers }, stages: timings.splice(0) }
  assert.deepEqual(switchPreflight.calls, { auth: 1, list: 0, prepare: 1, brokers: 1 })
  console.log(JSON.stringify({ status: "CONNECTION_PROFILE_OK", cold, menu, switchPreflight, note: "real Core/auth/broker; VS Code workspace API is a test adapter; no model turn or UI click" }))
} finally { abort.abort(); await Promise.allSettled([first?.host.close(), second?.host.close()]) }

}
void run().catch(error => { console.error(error instanceof Error ? error.message : "Connection profile failed"); process.exitCode = 1 })
