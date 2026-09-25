import { createHash } from "node:crypto"
import { open } from "node:fs/promises"

// Hash one chunk per event-loop turn while the stream reads the next one.
const CHUNK_BYTES = 1024 * 1024
// FAT and HFS+ timestamps tick every 1-2 s. A second rewrite in the same tick as the last
// change could leave the identity unchanged, so a recently changed file is never reused.
const SETTLED_NS = 2_000_000_000n

interface FileIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

/**
 * Digests one owner has computed, keyed by path. An entry is reused only while the opened
 * file keeps the same device, inode, size, mtime and ctime. A write, replacement, permission
 * or timestamp change alters at least one of them, so the file is read and hashed again.
 */
export type FileDigestMemo = Map<string, { readonly identity: FileIdentity; readonly sha256: string }>

export interface FileDigest {
  readonly sha256: string
  /** The file was unchanged since `memo` recorded it and was not read again. */
  readonly reused: boolean
}

/**
 * Streams the SHA-256 of the file opened at `path` without blocking the event loop.
 * The regular-file check, the identity and the bytes hashed come from the same open file
 * description. Callers still compare the digest with their pinned value on every call.
 */
export async function sha256File(path: string, memo?: FileDigestMemo): Promise<FileDigest> {
  const startedNs = BigInt(Date.now()) * 1_000_000n
  const handle = await open(path, "r")
  try {
    const stats = await handle.stat({ bigint: true })
    if (!stats.isFile()) throw new Error(`CodeM App Server bundled file is not a regular file: ${path}`)
    const identity: FileIdentity = { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeNs: stats.mtimeNs, ctimeNs: stats.ctimeNs }
    const known = memo?.get(path)
    if (known && sameIdentity(known.identity, identity)) return { sha256: known.sha256, reused: true }

    const hash = createHash("sha256")
    for await (const chunk of handle.createReadStream({ start: 0, highWaterMark: CHUNK_BYTES, autoClose: false })) {
      hash.update(chunk as Buffer)
    }
    const sha256 = hash.digest("hex")
    // A change during hashing gives the file a new identity, so this entry cannot match it.
    if (identity.ctimeNs < startedNs - SETTLED_NS) memo?.set(path, { identity, sha256 })
    else memo?.delete(path)
    return { sha256, reused: false }
  } finally {
    await handle.close()
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}
