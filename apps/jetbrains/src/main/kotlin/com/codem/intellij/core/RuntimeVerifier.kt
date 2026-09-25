package com.codem.intellij.core

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import java.nio.file.attribute.FileTime
import java.util.concurrent.ConcurrentHashMap

/** One verification: the runtime, and how many executables were read and hashed or reused. */
data class RuntimeVerification(val runtime: ResolvedRuntime, val hashed: Int, val reused: Int)

/**
 * Bundled runtime verifier owned by one tool window host for its lifetime.
 * Every call re-reads and validates runtime.json and the bundled files, then compares both
 * digests with the manifest. A digest is reused only for an executable whose identity is
 * unchanged since this verifier hashed it; any change hashes it again. Hashing runs on the
 * caller's thread, so callers keep it off the EDT.
 */
class RuntimeVerifier(private val pluginRoot: Path) {
    private val digests = FileDigests()

    fun verify(): RuntimeVerification = RuntimeLocator.verifyPlugin(pluginRoot, digests)
}

/**
 * Digests keyed by real path. The identity is the file key (device and inode on POSIX), size,
 * mtime, creation time and, on POSIX, ctime, which utimes cannot set back. Windows NIO has no
 * change time or file key, so there a rewrite that also restores the mtime keeps the identity.
 */
internal class FileDigests {
    private data class Entry(val identity: FileIdentity, val sha256: String)

    private val entries = ConcurrentHashMap<Path, Entry>()

    /** The digest, and whether it was reused without reading the file. */
    fun sha256(path: Path): Pair<String, Boolean> {
        val startedMillis = System.currentTimeMillis()
        val before = FileIdentity.of(path)
        entries[path]?.takeIf { it.identity == before }?.let { return it.sha256 to true }
        val digest = RuntimeLocator.sha256(path)
        // Attributes are read by path: a change or replacement while hashing leaves before != after.
        // FAT and HFS+ timestamps tick every 1-2 s, so a recently changed file is never reused.
        if (before == FileIdentity.of(path) && before.lastChangeMillis < startedMillis - SETTLED_MILLIS) {
            entries[path] = Entry(before, digest)
        } else {
            entries.remove(path)
        }
        return digest to false
    }

    private companion object {
        const val SETTLED_MILLIS = 2_000L
    }
}

private data class FileIdentity(
    val key: Any?,
    val size: Long,
    val modified: FileTime,
    val created: FileTime,
    val changed: FileTime?,
) {
    val lastChangeMillis: Long get() = maxOf(modified.toMillis(), created.toMillis(), changed?.toMillis() ?: Long.MIN_VALUE)

    companion object {
        fun of(path: Path): FileIdentity {
            val basic = Files.readAttributes(path, BasicFileAttributes::class.java)
            val changed = if ("unix" in path.fileSystem.supportedFileAttributeViews()) Files.getAttribute(path, "unix:ctime") as FileTime else null
            return FileIdentity(basic.fileKey(), basic.size(), basic.lastModifiedTime(), basic.creationTime(), changed)
        }
    }
}
