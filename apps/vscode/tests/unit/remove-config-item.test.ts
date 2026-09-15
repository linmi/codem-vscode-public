import { afterEach, describe, expect, it, mock } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { removeMcp, type RemoveConfigItemContext } from "../../src/kilo-provider/remove-config-item"

const dirs: string[] = []
const originalXdg = process.env.XDG_CONFIG_HOME

afterEach(async () => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalXdg
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codem-mcp-"))
  dirs.push(dir)
  return dir
}

function context(opts: { project?: string; xdg: string; refresh: ReturnType<typeof mock> }): RemoveConfigItemContext {
  return {
    connection: {
      getClientAsync: mock(async () => ({
        global: { config: { update: mock(async () => {}) } },
        instance: { dispose: mock(async () => {}) },
      })),
    } as unknown as RemoveConfigItemContext["connection"],
    project: () => opts.project,
    directory: () => opts.project ?? "/repo",
    refresh: opts.refresh,
  }
}

describe("remove config item adapter", () => {
  it("removes MCP servers from global kilo.json when there is no project, then refreshes", async () => {
    const xdg = await tempDir()
    process.env.XDG_CONFIG_HOME = xdg
    const configDir = path.join(xdg, "kilo")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(path.join(configDir, "kilo.json"), JSON.stringify({ mcp: { memory: { type: "local" } } }))
    const refresh = mock(async () => {})

    expect(await removeMcp(context({ xdg, refresh }), "memory")).toBe(true)
    expect(JSON.parse(await fs.readFile(path.join(configDir, "kilo.json"), "utf-8"))).toEqual({})
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("does not refresh when the MCP server is not installed", async () => {
    const xdg = await tempDir()
    process.env.XDG_CONFIG_HOME = xdg
    const refresh = mock(async () => {})

    expect(await removeMcp(context({ xdg, refresh }), "memory")).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })
})
