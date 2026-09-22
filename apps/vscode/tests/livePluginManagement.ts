import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm, access, realpath } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createPluginCommands, resolveBundledAppServerRuntime, startAppServerConnection, PluginOperationError } from "@codem/app-server"

/** Opt-in real Core management test. Writes only into a disposable LINCO_HOME, no model requests. */
export async function runLivePluginManagement(extensionRoot: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codemPluginAcceptance"))
  const cwd = join(root, "workspace"), source = join(root, "source")
  await mkdir(cwd); await mkdir(join(source, ".codem-plugin"), { recursive: true }); await mkdir(join(source, "skills", "hello"), { recursive: true })
  await writeFile(join(source, ".codem-plugin", "plugin.json"), JSON.stringify({ name: "acceptance-only", version: "1.0.0", description: "Disposable plugin management fixture" }))
  await writeFile(join(source, "skills", "hello", "SKILL.md"), "---\nname: hello\ndescription: Disposable acceptance skill\n---\nReply with a greeting.\n")
  const runtime = resolveBundledAppServerRuntime({ extensionRoot })
  const environment = { ...process.env, LINCO_HOME: join(root, "core"), CODEM_HOME: join(root, "cli"), XDG_CONFIG_HOME: join(root, "config") }
  const timings: { operation: string; elapsedMs: number }[] = []
  const commands = createPluginCommands({ runtime, cwd, environment, observe: (operation, elapsedMs) => timings.push({ operation, elapsedMs }) })
  const signal = new AbortController().signal
  let connection: Awaited<ReturnType<typeof startAppServerConnection>> | null = null
  try {
    assert.deepEqual(await commands.list(signal), [])
    assert.equal(await commands.install({ kind: "local", path: source }, signal), "acceptance-only")
    let entry = (await commands.list(signal))[0]!
    assert.equal(entry.enabled, true); assert.equal(entry.path, await realpath(source))
    await assert.rejects(commands.install({ kind: "local", path: source }, signal), error => error instanceof PluginOperationError && error.code === "alreadyInstalled")
    await commands.change("disable", entry, signal)
    entry = (await commands.list(signal))[0]!; assert.equal(entry.enabled, false)
    await commands.change("enable", entry, signal)
    entry = (await commands.list(signal))[0]!; assert.equal(entry.enabled, true)
    // Verify the App Server registry agrees, and report actual discovery instead of assuming install implies availability.
    connection = await startAppServerConnection({ runtime, workingDirectory: cwd, environment, clientInfo: { name: "codem-plugin-acceptance", version: "0.2.0" } })
    const registry = await connection.request("plugin/list", { cwd }) as { installed: Record<string, { enabled: boolean }> }
    assert.equal(registry.installed["acceptance-only"]?.enabled, true)
    const skillResult = await connection.request("skills/list", { cwd }) as { skills: { name: string }[] }
    const pluginSkillDiscovered = skillResult.skills.some(skill => skill.name === "acceptance-only:hello")
    await commands.change("uninstall", entry, signal)
    assert.deepEqual(await commands.list(signal), [])
    await access(join(source, ".codem-plugin", "plugin.json"))
    const cleared = await connection.request("plugin/list", { cwd }) as { installed: Record<string, unknown> }
    assert.deepEqual(cleared.installed, {})
    console.log(JSON.stringify({ coreVersion: runtime.coreVersion, managementLifecycle: "passed", localSourceRetained: true, pluginSkillDiscovered, modelRequests: 0, timings }, null, 2))
  } finally { await connection?.close(); await rm(root, { recursive: true, force: true }) }
}
