import { open } from "node:fs/promises"
import { constants } from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"
import type { AppServerAuthStatus } from "@codem/app-server"
import type { AccountAvatar } from "../shared/accountTypes.ts"
import { parseAccountAvatarUrl } from "../shared/accountAvatar.ts"

/** Pinned CLI 0.1.208 CONFIG_PATH: CODEM_HOME + optional BOE profile, not CODEM_STATE_HOME. */
export function accountProfilePath(environment: NodeJS.ProcessEnv, cwd: string, home = homedir()): string {
  const configured = environment.CODEM_HOME || join(home, ".codem")
  let directory = isAbsolute(configured) ? configured : resolve(cwd, configured)
  const env = environment.CODEM_X_TT_ENV?.trim() ?? ""
  if (/^boe(?:_[A-Za-z0-9_-]+)?$/.test(env) && basename(directory) !== ".boe") directory = join(directory, ".boe")
  return join(directory, "config.json")
}

/** Display metadata only. Auth remains exclusively owned by the CLI; never write this file. */
export async function readAccountAvatar(status: AppServerAuthStatus, path: string, signal: AbortSignal): Promise<AccountAvatar> {
  signal.throwIfAborted()
  if (!status.loggedIn || status.routerCredential !== true) return { kind: "none" }
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      const limit = 1024 * 1024
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > limit) throw new Error("Invalid account profile size")
      const buffer = Buffer.alloc(limit + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      signal.throwIfAborted()
      if (bytesRead > limit) throw new Error("Account profile exceeds size limit")
      return projectAccountAvatar(JSON.parse(buffer.toString("utf8", 0, bytesRead)), status)
    } finally { await file.close() }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { kind: "none" }
    return { kind: "unavailable" }
  }
}

export function projectAccountAvatar(value: unknown, status: AppServerAuthStatus): AccountAvatar {
  if (!status.loggedIn || status.routerCredential !== true) return { kind: "none" }
  const config = record(value)
  const oauth = record(record(config?.auth)?.oauth)
  // Bind the avatar to the authenticated identity, including server. Never reuse another account's photo.
  if (!status.userId || !status.tenantId || !status.serverUrl || !oauth || oauth.userId !== status.userId || oauth.tenantId !== status.tenantId || config?.serverUrl !== status.serverUrl) return { kind: "unavailable" }
  const info = record(oauth.userInfo)
  if (!info || info.avatar_url === undefined || info.avatar_url === null || info.avatar_url === "") return { kind: "none" }
  try { return { kind: "image", url: parseAccountAvatarUrl(info.avatar_url) } }
  catch { return { kind: "unavailable" } }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}
