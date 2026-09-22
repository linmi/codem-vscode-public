package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.ide.AttachmentStore
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID

data class AttachmentHandle(val id: String, val label: String, val kind: String, val path: Path)
data class ImageAttachment(val mediaType: String, val bytes: ByteArray)

/** Owns composer handles and only the files it creates. Caller serializes access with the session lock. */
class AttachmentCollection(private val store: AttachmentStore?) {
    private val records = linkedMapOf<String, AttachmentHandle>()
    private val composer = linkedSetOf<String>()
    private val owned = mutableSetOf<String>()
    private val leases = mutableMapOf<Long, MutableSet<String>>()
    private var directory: Path? = null

    fun visible(): List<AttachmentHandle> = composer.map { records.getValue(it) }

    fun add(path: Path, kind: AttachmentStore.Kind): String {
        requireCapacity(1)
        val real = (store ?: throw CodemError.Validation("CodeM attachment store is not configured")).validate(path, kind)
        val handle = AttachmentHandle(UUID.randomUUID().toString(), real.fileName.toString(), kind.name.lowercase(), real)
        records[handle.id] = handle
        composer += handle.id
        return handle.id
    }

    fun addImages(images: List<ImageAttachment>): List<String> {
        requireCapacity(images.size)
        if (images.isEmpty() || images.sumOf { it.bytes.size.toLong() } > 20L * 1024 * 1024) {
            throw CodemError.Validation("CodeM pasted images must contain at most 20 MiB")
        }
        val suffixes = images.map { image ->
            val bytes = image.bytes
            fun starts(vararg magic: Int) = bytes.size >= magic.size && magic.indices.all { (bytes[it].toInt() and 255) == magic[it] }
            when (image.mediaType) {
                "image/png" -> if (starts(137, 80, 78, 71, 13, 10, 26, 10)) ".png" else null
                "image/jpeg" -> if (starts(255, 216, 255)) ".jpg" else null
                "image/gif" -> if (starts(71, 73, 70, 56) && bytes.size >= 6) ".gif" else null
                "image/webp" -> if (starts(82, 73, 70, 70) && bytes.size >= 12 && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP") ".webp" else null
                else -> null
            } ?: throw CodemError.Validation("CodeM pasted image format does not match its content")
        }
        val root = directory ?: Files.createTempDirectory("codem-images-").toRealPath().also { directory = it }
        val staged = mutableListOf<AttachmentHandle>()
        try {
            images.forEachIndexed { index, image ->
                val id = UUID.randomUUID().toString()
                val path = root.resolve(id + suffixes[index])
                // Record before writing so a failed partial write is also reclaimed.
                staged += AttachmentHandle(id, "粘贴的图片", "image", path)
                Files.write(path, image.bytes)
            }
        } catch (error: Throwable) {
            staged.forEach { Files.deleteIfExists(it.path) }
            if (records.values.none { it.path.parent == root }) { Files.deleteIfExists(root); directory = null }
            throw error
        }
        staged.forEach { records[it.id] = it; composer += it.id; owned += it.id }
        return staged.map { it.id }
    }

    fun retain(ids: List<String>, generation: Long): List<AttachmentHandle> {
        if (ids.toSet().size != ids.size) throw CodemError.Validation("CodeM attachment handles must be unique")
        val selected = ids.map { id ->
            if (id !in composer) throw CodemError.Validation("CodeM attachment is no longer available")
            records.getValue(id).also {
                if (!Files.exists(it.path)) throw CodemError.Validation("CodeM attachment no longer exists")
            }
        }
        leases.getOrPut(generation) { mutableSetOf() }.addAll(ids)
        return selected
    }

    fun remove(id: String) { composer.remove(id); collect() }
    fun consume(ids: List<String>) { composer.removeAll(ids.toSet()); collect() }
    fun clear() { composer.clear(); collect() }
    fun release(generation: Long) { leases.remove(generation); collect() }

    private fun collect() {
        val retained = composer + leases.values.flatten()
        for (id in records.keys.toList()) {
            if (id in retained) continue
            if (id in owned) { Files.deleteIfExists(records.getValue(id).path); owned.remove(id) }
            records.remove(id)
        }
        if (owned.isEmpty()) directory?.let { Files.deleteIfExists(it); directory = null }
    }

    private fun requireCapacity(count: Int) {
        if (composer.size + count > 20) throw CodemError.Validation("CodeM supports at most 20 attachments per message")
    }
}
