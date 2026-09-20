/** Opt-in real Core contract check. Temporary threads only; no model calls. */
import assert from "node:assert/strict"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { AppServerHost, DEFAULT_APP_SERVER_THREAD_SETTINGS } from "../src/host.ts"
import { resolveAppServerRuntime } from "../src/runtime.ts"
const cwd = await realpath(await mkdtemp(join(tmpdir(), "codem-core-contract-")))
const runtime = resolveAppServerRuntime({ packageRoot: fileURLToPath(new URL("..", import.meta.url)) })
const host = new AppServerHost({ runtime, clientInfo: { name: "codem-contract", version: "1" }, assertAuthenticated() {} })
const threads = new Set<string>()
const errors: string[] = []
let notifications = 0
const failures: unknown[] = []
host.onEvent(event => { notifications++; if (event.type === "protocol-error") errors.push(event.message) })
try {
  await host.prepareConnection(cwd)
  const environment = await host.readEnvironmentInfo(cwd)
  assert.ok(environment.agentVersion.startsWith(runtime.coreVersion))
  const results = await Promise.allSettled([
    host.listModels(cwd), host.listSkills(cwd), host.readConfigSnapshot(cwd), host.listHooks(cwd), host.listPlugins(cwd), host.listPermissionProfiles(cwd), host.readCoreSpaceSnapshot(cwd), host.readModelProviderCapabilities(cwd),
  ])
  const methods = ["model/list", "skills/list", "config/read", "hooks/list", "plugin/list", "permissionProfile/list", "space/list", "modelProvider/capabilities/read"]
  results.forEach((result, i) => { if (result.status === "rejected") errors.push(`${methods[i]}: ${String(result.reason)}`) })
  let threadId = await host.startThread(cwd, DEFAULT_APP_SERVER_THREAD_SETTINGS); threads.add(threadId)
  await host.control(cwd, "thread/name/set", { threadId, name: "CodeM contract fixture" })
  const list = await host.listThreads(cwd)
  assert.equal((await host.readThread(cwd, threadId)).name, "CodeM contract fixture")
  assert.equal(list.threads.some(thread => thread.id === threadId), true)
  const fork = await host.control(cwd, "thread/fork", { threadId })
  assert.equal(typeof fork.threadId, "string"); threads.add(fork.threadId as string)
  assert.ok((await host.listLoadedThreadIds(cwd)).threadIds.includes(threadId))
  await host.listLiveThreadTurns(cwd, threadId); await host.listLiveThreadItems(cwd, threadId)
  await host.listTools(cwd, threadId); await host.listBackgroundTerminals(cwd, threadId)
  const shellEvents: string[] = []
  const unsubscribeShell = host.onEvent(event => shellEvents.push(event.type))
  await host.runShellCommand(cwd, threadId, "printf CODEM_SHELL_OK")
  unsubscribeShell()
  console.log(`CORE_SHELL_EVENTS ${JSON.stringify(shellEvents)}`)
  await host.control(cwd, "thread/archive", { threadId })
  await assert.rejects(host.readModes(cwd, threadId), /not loaded/)
  await host.control(cwd, "thread/unarchive", { threadId })
  await host.resumeThread(cwd, threadId, DEFAULT_APP_SERVER_THREAD_SETTINGS)
  const previous = threadId
  threadId = await host.clearThread(cwd, threadId, "contract-clear"); threads.add(threadId)
  assert.notEqual(threadId, previous)
  await assert.rejects(host.readModes(cwd, previous), /not loaded/)
  await host.readModes(cwd, threadId)
  await host.listTools(cwd, threadId)
  assert.deepEqual(errors, [])
  console.log(`CORE_CONTRACT_OK ${environment.agentVersion}; catalogs, rename/fork/archive/unarchive/clear, live snapshots; ${notifications} events`)
} catch (error) { failures.push(error) } finally {
  const cleanup = await Promise.allSettled([...threads].map(threadId => host.control(cwd, "thread/delete", { threadId })))
  await host.close()
  await rm(cwd, { recursive: true, force: true })
  failures.push(...cleanup.filter(result => result.status === "rejected"))
}

if (failures.length) throw new AggregateError(failures, "Core contract or cleanup failed")
