package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue

/** 一个 hunk 的前后文本片段。context 两边都在，delete 只在前，insert 只在后。 */
data class FileDiffHunk(
    val oldStart: Int,
    val newStart: Int,
    val before: List<String>,
    val after: List<String>,
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
class FileDiffAssembler {
    private val buffers = linkedMapOf<String, Buffer>()
    private val completed = mutableSetOf<String>()

    fun accept(params: JsonValue.ObjectValue): FileDiffContent? {
        val itemId = text(params, "itemId")
        if (itemId in completed) throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId continued after completion")
        val callId = text(params, "callId")
        if ((params.fields["encoding"] as? JsonValue.Text)?.value != "json") {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM item/fileChange/delta encoding must be json")
        }
        val sequence = (params.fields["sequence"] as? JsonValue.NumberValue)?.value?.toInt()
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM item/fileChange/delta sequence is invalid")
        val complete = (params.fields["complete"] as? JsonValue.Bool)?.value
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM item/fileChange/delta complete is invalid")
        val delta = (params.fields["delta"] as? JsonValue.Text)?.value ?: ""
        val buffer = buffers.getOrPut(itemId) { Buffer(callId) }
        if (buffer.callId != callId) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId changed correlation identity")
        }
        if (sequence != buffer.nextSequence) {
            throw CodemError.Protocol(
                CodemError.Class.InvalidFrame,
                "CodeM file diff $itemId expected sequence ${buffer.nextSequence}, received $sequence",
            )
        }
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
        return parse(itemId, callId, decoded)
    }

    private fun parse(itemId: String, callId: String, decoded: JsonValue.ObjectValue): FileDiffContent {
        if (text(decoded, "tool_call_id") != callId) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId changed tool_call_id")
        }
        val binary = (decoded.fields["is_binary"] as? JsonValue.Bool)?.value == true
        val truncated = (decoded.fields["truncated"] as? JsonValue.Bool)?.value == true
        val stats = (decoded.fields["stats"] as? JsonValue.ObjectValue)
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId is missing stats")
        val hunks = ((decoded.fields["hunks"] as? JsonValue.ArrayValue)?.items.orEmpty()).map { parseHunk(itemId, it) }
        if (binary && hunks.isNotEmpty()) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId binary diff contains text hunks")
        }
        val raw = (decoded.fields["raw_unified"] as? JsonValue.Text)?.value
        val preview = when {
            binary -> "binary"
            !truncated -> "complete"
            hunks.isNotEmpty() -> "partial"
            !raw.isNullOrBlank() -> "rawPartial"
            else -> "omitted"
        }
        return FileDiffContent(
            path = text(decoded, "path"),
            changeType = text(decoded, "change_type"),
            linesAdded = count(stats, "lines_added", itemId),
            linesRemoved = count(stats, "lines_removed", itemId),
            preview = preview,
            hunks = hunks,
        )
    }

    private fun parseHunk(itemId: String, value: JsonValue): FileDiffHunk {
        val hunk = value.asObject()
        val before = mutableListOf<String>()
        val after = mutableListOf<String>()
        val lines = (hunk.fields["lines"] as? JsonValue.ArrayValue)?.items
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId hunk is missing lines")
        for (entry in lines) {
            val line = entry.asObject()
            val body = (line.fields["text"] as? JsonValue.Text)?.value ?: ""
            when (val kind = (line.fields["kind"] as? JsonValue.Text)?.value) {
                "context" -> {
                    before += body
                    after += body
                }
                "delete" -> before += body
                "insert" -> after += body
                else -> throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId has unsupported line kind $kind")
            }
        }
        return FileDiffHunk(
            oldStart = (hunk.fields["old_start"] as? JsonValue.NumberValue)?.value?.toInt() ?: 0,
            newStart = (hunk.fields["new_start"] as? JsonValue.NumberValue)?.value?.toInt() ?: 0,
            before = before,
            after = after,
        )
    }

    private fun count(stats: JsonValue.ObjectValue, key: String, itemId: String): Int =
        (stats.fields[key] as? JsonValue.NumberValue)?.value?.toInt()
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $itemId stats.$key is invalid")

    private fun text(value: JsonValue.ObjectValue, key: String): String =
        (value.fields[key] as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() }
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM file diff $key is required")

    private class Buffer(val callId: String) {
        val chunks = StringBuilder()
        var nextSequence = 0
    }
}
