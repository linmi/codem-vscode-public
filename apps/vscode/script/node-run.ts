import { spawnSync, type SpawnSyncOptions } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const windows = process.platform === "win32"

export function scriptRoot(url = import.meta.url) {
  return dirname(fileURLToPath(url))
}

export function extensionRoot(url = import.meta.url) {
  return join(scriptRoot(url), "..")
}

export function run(
  command: string,
  args: string[],
  options: Pick<SpawnSyncOptions, "cwd" | "env" | "encoding"> & { stdio?: SpawnSyncOptions["stdio"] } = {},
) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? "inherit",
    shell: windows,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = typeof result.stderr === "string" && result.stderr.trim() ? `\n${result.stderr.trim()}` : ""
    throw new Error(`${command} ${args.join(" ")} failed with ${String(result.status)}${detail}`)
  }
  return result
}

export function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`)
  }
  return result.stdout
}
