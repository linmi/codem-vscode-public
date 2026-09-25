package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue

/** 一个 hunk 的前后文本片段。context 两边都在，delete 只在前，insert 只在后。 */
data class FileDiffHunk(
    val oldStart: Int,
    val newStart: Int,
    val before: List<String>,
    val after: List<String>,
    val added: Int,
    val removed: Int,
)

/** Core 的单文件变更内容。preview 与 App Server 同名取值，不自造语义。 */
data class FileDiffContent(
    val path: String,
    val changeType: String,
    val linesAdded: Int,
    val linesRemoved: Int,
    val preview: String,
    val hunks: List<FileDiffHunk>,
) {
    /** 只有真实 hunks 才能渲染差异；binary/omitted 不允许编出前后文本。 */
    fun texts(): Pair<String, String>? {
        if (hunks.isEmpty()) return null
        return hunks.joinToString("\n") { it.before.joinToString("\n") } to
            hunks.joinToString("\n") { it.after.joinToString("\n") }
    }
}

/**
 * `item/fileChange/delta` 的分片装配：按 itemId 缓冲，校验关联身份与序号，
 * complete 之后才解析 JSON。半截分片不产出内容，也不污染已完成的条目。
 */
class FileDiffAssembler(private val maxBytes: Int = 8 * 1024 * 1024) {
    private val buffers = linkedMapOf<String, Buffer>()
    private val completed = mutableSetOf<String>()

    fun accept(params: JsonValue.ObjectValue): FileDiffContent? {
        val itemId = text(params, "itemId", DELTA)
        if (itemId in completed) throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId continued after completion")
        val callId = text(params, "callId", DELTA)
        val backgroundId = params.optionalString("backgroundTaskId", DELTA)
        if (params.stringOrNull("encoding") != "json") {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM item/fileChange/delta encoding must be json")
        }
        val sequence = count(params, "sequence", DELTA)
        val complete = params.requiredBoolean("complete", DELTA)
        val delta = params.requiredString("delta", DELTA)
        val buffer = buffers.getOrPut(itemId) { Buffer(callId, backgroundId) }
        if (buffer.callId != callId || buffer.backgroundId != backgroundId) {
            throw invalid("file diff $itemId changed correlation identity")
        }
        if (sequence != buffer.nextSequence) {
            throw CodemError.Protocol(
                CodemError.Class.InvalidFrame,
                "CodeM file diff $itemId expected sequence ${buffer.nextSequence}, received $sequence",
            )
        }
        val incomingBytes = delta.toByteArray(Charsets.UTF_8).size
        if (buffer.bytes.toLong() + incomingBytes > maxBytes) {
            buffers.remove(itemId)
            throw invalid("file diff $itemId exceeded the buffer limit")
        }
        buffer.bytes += incomingBytes
        buffer.chunks.append(delta)
        buffer.nextSequence += 1
        if (!complete) return null
        buffers.remove(itemId)
        completed += itemId
        val decoded = try {
            JsonValue.parse(buffer.chunks.toString()).asObject()
        } catch (error: CodemError) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId contained invalid JSON", error)
        }
        return parse(itemId, callId, backgroundId, decoded)
    }

    private fun parse(itemId: String, callId: String, backgroundId: String?, decoded: JsonValue.ObjectValue): FileDiffContent {
        val label = "file diff $itemId"
        if (text(decoded, "tool_call_id", label) != callId) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId changed tool_call_id")
        }
        if (decoded.optionalString("background_task_id", label) != backgroundId) throw invalid("file diff $itemId changed background identity")
        val binary = decoded.requiredBoolean("is_binary", label)
        val truncated = decoded.requiredBoolean("truncated", label)
        val stats = decoded.requiredObject("stats", label)
        val hunks = decoded.requiredArray("hunks", label).mapIndexed { index, hunk -> parseHunk(itemId, hunk, "$label.hunks[$index]") }
        if (binary && hunks.isNotEmpty()) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId binary diff contains text hunks")
        }
        val added = count(stats, "lines_added", "$label.stats")
        val removed = count(stats, "lines_removed", "$label.stats")
        val observedAdded = hunks.sumOf { it.added.toLong() }
        val observedRemoved = hunks.sumOf { it.removed.toLong() }
        if (!binary && ((!truncated && (observedAdded != added.toLong() || observedRemoved != removed.toLong())) ||
            (truncated && (observedAdded > added || observedRemoved > removed)))) throw invalid("file diff $itemId statistics disagree with hunks")
        val changeType = text(decoded, "change_type", label)
        if (changeType !in setOf("new", "modified", "deleted", "renamed", "copied", "type-changed", "unmerged")) throw invalid("file diff $itemId has an invalid change type")
        val raw = decoded.optionalString("raw_unified", label)
        val preview = when {
            binary -> "binary"
            !truncated -> "complete"
            hunks.isNotEmpty() -> "partial"
            !raw.isNullOrBlank() -> "rawPartial"
            else -> "omitted"
        }
        return FileDiffContent(
            path = text(decoded, "path", label),
            changeType = changeType,
            linesAdded = added,
            linesRemoved = removed,
            preview = preview,
            hunks = hunks,
        )
    }

    private fun parseHunk(itemId: String, value: JsonValue, label: String): FileDiffHunk {
        val hunk = value.asObject(label)
        val oldStart = count(hunk, "old_start", label)
        val newStart = count(hunk, "new_start", label)
        val oldCount = count(hunk, "old_count", label)
        val newCount = count(hunk, "new_count", label)
        if ((oldCount == 0 && oldStart != 0) || (oldCount > 0 && oldStart < 1) ||
            (newCount == 0 && newStart != 0) || (newCount > 0 && newStart < 1)) throw invalid("file diff $itemId has invalid hunk bounds")
        val before = mutableListOf<String>()
        val after = mutableListOf<String>()
        var added = 0
        var removed = 0
        val lines = hunk.requiredArray("lines", label)
        for ((index, entry) in lines.withIndex()) {
            val lineLabel = "$label.lines[$index]"
            val line = entry.asObject(lineLabel)
            val body = line.requiredString("text", lineLabel)
            val kind = text(line, "kind", lineLabel)
            fun lineNumber(key: String): Int? = if (line.optional(key) == JsonValue.Null) null else count(line, key, lineLabel)
            val oldLine = lineNumber("old_line")
            val newLine = lineNumber("new_line")
            if ((kind == "insert" && (oldLine != null || newLine == null)) ||
                (kind == "delete" && (oldLine == null || newLine != null)) ||
                (kind == "context" && (oldLine == null || newLine == null))) throw invalid("file diff $itemId line kind and numbers disagree")
            if (oldLine != null && oldLine.toLong() != oldStart.toLong() + before.size) throw invalid("file diff $itemId old lines are not contiguous")
            if (newLine != null && newLine.toLong() != newStart.toLong() + after.size) throw invalid("file diff $itemId new lines are not contiguous")
            when (kind) {
                "context" -> { before += body; after += body }
                "delete" -> { before += body; removed++ }
                "insert" -> { after += body; added++ }
                else -> throw invalid("file diff $itemId has an invalid line kind")
            }
        }
        if (before.size != oldCount || after.size != newCount) throw invalid("file diff $itemId hunk counts disagree with lines")
        return FileDiffHunk(oldStart, newStart, before, after, added, removed)
    }

    private fun count(value: JsonValue.ObjectValue, key: String, path: String): Int =
        value.requiredInt(key, path).takeIf { it >= 0 } ?: throw invalid("$path.$key must be a nonnegative integer")

    private fun text(value: JsonValue.ObjectValue, key: String, path: String): String =
        value.requiredString(key, path).takeIf { it.isNotBlank() } ?: throw invalid("$path.$key must not be blank")

    private fun invalid(message: String) = CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM $message")

    private companion object {
        const val DELTA = "item/fileChange/delta"
    }

    private class Buffer(val callId: String, val backgroundId: String?) {
        val chunks = StringBuilder()
        var nextSequence = 0
        var bytes = 0
    }
}
