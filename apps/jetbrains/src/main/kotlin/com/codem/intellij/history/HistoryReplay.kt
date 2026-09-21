package com.codem.intellij.history

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

data class HistoryTurn(
    val submissionId: String?,
    val userTexts: List<String>,
    val assistantTexts: List<String>,
    val tools: List<Pair<String, String?>>,
)

data class HistoryPage(
    val turns: List<HistoryTurn>,
    val nextCursor: String?,
)

/**
 * 流式重放 schema 13，不是读取最后 N 行。
 * 隐藏 synthetic 模型输入，按 user_invocation 分轮，校验身份/序号/符号链接。
 */
object SessionsRoot {
    fun resolve(environment: Map<String, String>, home: Path): Path {
        val root: Path = environment["LINCO_SESSIONS_ROOT"]?.let(Path::of)
            ?: environment["LINCO_HOME"]?.let { Path.of(it).resolve("sessions") }
            ?: home.resolve(".codem").resolve("sessions")
        if (!root.isAbsolute) throw CodemError.History("CodeM history sessions root must be absolute")
        return root
    }
}

object ProjectHash {
    fun forCwd(cwd: String, windows: Boolean = false): String {
        val persisted = if (windows) cwd.replace('\\', '/') else cwd
        val digest = MessageDigest.getInstance("SHA-256").digest(persisted.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }.substring(0, 16)
    }
}

object HistoryReplay {
    private val sessionId = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")

    fun read(
        sessionsRoot: Path,
        cwd: String,
        threadId: String,
        limit: Int = 50,
        cursor: String? = null,
        cancelled: AtomicBoolean = AtomicBoolean(false),
    ): HistoryPage {
        if (!sessionId.matches(threadId)) throw CodemError.History("Invalid CodeM CLI session id: $threadId")
        if (!sessionsRoot.isAbsolute || !Path.of(cwd).isAbsolute) throw CodemError.History("CodeM history requires absolute host paths")
        if (limit !in 1..500) throw CodemError.History("CodeM history limit must be between 1 and 500")
        val root = try {
            sessionsRoot.toRealPath()
        } catch (_: Exception) {
            throw CodemError.History("CodeM history sessions root is not readable")
        }
        val path = root.resolve(ProjectHash.forCwd(cwd)).resolve("$threadId.jsonl")
        if (Files.isSymbolicLink(path) || Files.isSymbolicLink(path.parent)) {
            throw CodemError.History("CodeM history $threadId must not traverse symbolic links")
        }
        val realFile = try {
            path.toRealPath()
        } catch (_: Exception) {
            throw CodemError.History("CodeM history $threadId is not a regular file")
        }
        if (!realFile.startsWith(root) || realFile.fileName.toString() != "$threadId.jsonl") {
            throw CodemError.History("CodeM history $threadId must not traverse symbolic links")
        }
        val before = Files.readAttributes(path, java.nio.file.attribute.BasicFileAttributes::class.java)
        if (!before.isRegularFile) throw CodemError.History("CodeM history $threadId is not a regular file")
        val revision = revisionOf(cwd, threadId, before)
        var end = Int.MAX_VALUE
        if (cursor != null) {
            val match = Regex("^([a-f0-9]{64}):([0-9]+)\$").matchEntire(cursor)
                ?: throw CodemError.History("CodeM history $threadId changed or cursor is invalid; reopen the conversation")
            if (match.groupValues[1] != revision) throw CodemError.History("CodeM history $threadId changed or cursor is invalid; reopen the conversation")
            end = match.groupValues[2].toInt()
        }
        val turns = mutableListOf<MutableTurn>()
        var header = false
        val submissions = mutableSetOf<String>()
        var lastSequence: Int? = null
        // 只消费换行结束的行；尾部无换行半条写入忽略，完整坏行失败。
        readCommittedLines(path, cancelled) { line ->
            if (line.isBlank()) return@readCommittedLines
            val record = try {
                JsonValue.parse(line).asObject()
            } catch (_: CodemError) {
                throw CodemError.History("CodeM history $threadId contains a malformed record")
            }
            lastSequence = acceptRecordSequence(record, lastSequence, threadId)
            val type = (record.fields["type"] as? JsonValue.Text)?.value
                ?: throw CodemError.History("CodeM history $threadId contains a malformed record")
            when (type) {
                "header" -> {
                    header = true
                    val schema = (record.fields["schema_version"] as? JsonValue.NumberValue)?.value?.toInt()
                    if (schema != 13) throw CodemError.History("schema_version $schema is not supported")
                    val session = (record.fields["session_id"] as? JsonValue.Text)?.value
                    if (session != threadId) throw CodemError.History("header session_id $session does not match file name $threadId")
                    val persisted = (record.fields["cwd"] as? JsonValue.Text)?.value
                    if (persisted != cwd) throw CodemError.History("header cwd $persisted does not match requested cwd $cwd")
                }
                "user_invocation" -> {
                    val submission = (record.fields["submission_id"] as? JsonValue.Text)?.value
                    if (submission != null && !submissions.add(submission)) {
                        throw CodemError.History("Invalid CodeM session $threadId: duplicate submission $submission")
                    }
                    val input = record.fields["input"]?.asObject()
                    val text = (input?.fields?.get("content") as? JsonValue.Text)?.value ?: ""
                    turns += MutableTurn(submission, mutableListOf(text), mutableListOf(), mutableListOf())
                }
                "user_message" -> {
                    val origin = (record.fields["origin"] as? JsonValue.Text)?.value
                    if (origin == "synthetic" || origin == "ask_user_input" || origin == "hook_feedback") {
                        return@readCommittedLines
                    }
                }
                "assistant_text" -> {
                    val text = (record.fields["text"] as? JsonValue.Text)?.value ?: ""
                    current(turns).assistant += text
                }
                "tool_call" -> {
                    val id = (record.fields["id"] as? JsonValue.Text)?.value ?: return@readCommittedLines
                    current(turns).tools += (id to null)
                }
                "tool_result" -> {
                    val id = (record.fields["id"] as? JsonValue.Text)?.value
                    val content = (record.fields["content"] as? JsonValue.Text)?.value
                    val tool = current(turns).tools.indexOfFirst { it.first == id && it.second == null }
                    if (id == null || tool < 0) throw CodemError.History("tool result is not paired")
                    current(turns).tools[tool] = id to content
                }
                // cleared 是重放截断点：它之前的轮次不再属于当前会话。
                "cleared" -> {
                    if (record.fields.keys.any { it != "type" && it != "record_seq" }) {
                        throw CodemError.History("CodeM history $threadId cleared contains unsupported fields")
                    }
                    turns.clear()
                }
                // rewind_mark 是检查点控制元数据，不是对话内容：会话回退由 Core 物理截断文件表达，
                // 在这里清空会把 Core 明确保留的轮次删掉。校验后丢弃。
                "rewind_mark" -> {
                    val checkpoint = (record.fields["checkpoint_id"] as? JsonValue.Text)?.value
                    val mode = (record.fields["mode"] as? JsonValue.Text)?.value
                    if (checkpoint.isNullOrBlank() || mode.isNullOrBlank()) {
                        throw CodemError.History("CodeM history $threadId rewind_mark is missing its checkpoint identity")
                    }
                }
            }
        }
        if (!header) throw CodemError.History("CodeM history $threadId is missing its header")
        val after = Files.readAttributes(path, java.nio.file.attribute.BasicFileAttributes::class.java)
        if (after.size() != before.size() || after.lastModifiedTime() != before.lastModifiedTime()) {
            throw CodemError.History("CodeM history $threadId changed during replay; retry after the current write")
        }
        val visible = if (end == Int.MAX_VALUE) turns else turns.take(end)
        val page = if (visible.size > limit) visible.takeLast(limit) else visible
        val first = visible.size - page.size
        return HistoryPage(
            turns = page.map { HistoryTurn(it.submissionId, it.users, it.assistant, it.tools.toList()) },
            nextCursor = if (first > 0) "$revision:$first" else null,
        )
    }

    private fun readCommittedLines(path: Path, cancelled: AtomicBoolean, consume: (String) -> Unit) {
        Files.newBufferedReader(path).use { reader ->
            val leftover = StringBuilder()
            val buffer = CharArray(4096)
            while (true) {
                if (cancelled.get()) throw CodemError.Cancelled("CodeM history replay was cancelled")
                val read = reader.read(buffer)
                if (read < 0) break
                leftover.append(buffer, 0, read)
                var text = leftover.toString()
                var newline = text.indexOf('\n')
                while (newline >= 0) {
                    consume(text.substring(0, newline).trimEnd('\r'))
                    text = text.substring(newline + 1)
                    newline = text.indexOf('\n')
                }
                leftover.setLength(0)
                leftover.append(text)
            }
        }
    }

    private fun acceptRecordSequence(record: JsonValue.ObjectValue, last: Int?, threadId: String): Int {
        val sequence = (record.fields["record_seq"] as? JsonValue.NumberValue)?.value?.toInt()
            ?: throw CodemError.History("CodeM history $threadId is missing record_seq")
        if (sequence < 1) throw CodemError.History("CodeM history $threadId record_seq must be positive")
        if (last == null && sequence != 1) throw CodemError.History("CodeM history $threadId record_seq must start at 1")
        if (last != null && sequence != last + 1) throw CodemError.History("CodeM history $threadId record_seq $sequence does not follow $last")
        return sequence
    }

    private fun current(turns: MutableList<MutableTurn>): MutableTurn =
        turns.lastOrNull() ?: throw CodemError.History("record arrived before a user invocation")

    private fun revisionOf(cwd: String, threadId: String, attributes: java.nio.file.attribute.BasicFileAttributes): String {
        val payload = """["$cwd","$threadId",${attributes.fileKey()},${attributes.size()},${attributes.lastModifiedTime().toMillis()}]"""
        return MessageDigest.getInstance("SHA-256").digest(payload.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    private data class MutableTurn(
        val submissionId: String?,
        val users: MutableList<String>,
        val assistant: MutableList<String>,
        val tools: MutableList<Pair<String, String?>>,
    )
}
