import { createHash } from "node:crypto"
import { open } from "node:fs/promises"

// Hash one chunk per event-loop turn while the stream reads the next one.
const CHUNK_BYTES = 1024 * 1024

/**
 * Streams the SHA-256 of the file opened at `path` without blocking the event loop.
 * The regular-file check and the bytes hashed come from the same open file description.
 */
export async function sha256File(path: string): Promise<string> {
  const handle = await open(path, "r")
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`CodeM App Server bundled file is not a regular file: ${path}`)
    const hash = createHash("sha256")
    for await (const chunk of handle.createReadStream({ start: 0, highWaterMark: CHUNK_BYTES, autoClose: false })) {
      hash.update(chunk as Buffer)
    }
    return hash.digest("hex")
  } finally {
    await handle.close()
  }
}
