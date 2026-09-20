import { realpath } from "node:fs/promises"
import { isAbsolute } from "node:path"

/** Keep the host's canonical connection key when Windows Core spells the same path differently. */
export async function threadWorkspace(
  reported: string,
  expected: string,
  threadId: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (reported === expected) return expected
  if (platform === "win32" && isAbsolute(reported)) {
    try {
      if (await realpath(reported) === await realpath(expected)) return expected
    } catch (cause) {
      throw new Error(`Cannot verify workspace for CodeM thread ${threadId}`, { cause })
    }
  }
  throw new Error(`CodeM thread ${threadId} belongs to another workspace`)
}
