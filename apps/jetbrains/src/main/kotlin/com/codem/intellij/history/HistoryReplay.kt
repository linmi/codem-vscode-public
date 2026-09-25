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
    /** 契约之外的记录类型：不中断重放，但如实报告，不静默吞掉。 */
    val unknownRecordTypes: Set<String> = emptySet(),
)

/**
 * schema 13 全部 SessionRecord 类型的处置，与 `@codem/history` 的
 * `session-record-contract-v13.json` 逐项一致（HistoryRecordContractTest 校验）。
 * 已知类型要么由 [HistoryReplay] 投影/校验，要么明确隐藏；契约之外的类型按 Node 读取器的 append-only
 * 扩展规则不中断重放，并记入 [HistoryPage.unknownRecordTypes]。
 */
object HistoryRecordTypes {
    /** 用户输入、正文、工具调用与结果，以及 header / cleared / rewind_mark 这类重放控制。 */
    val projected: Set<String> = setOf(
        "header",
        "user_invocation",
        "user_message",
        "assistant_text",
        "tool_call",
        "tool_result",
        "cleared",
        "rewind_mark",
    )

    /** 已知但 JetBrains 历史视图不展示的类型，逐项列出，不与未知类型共用跳过路径。 */
    val hidden: Set<String> = setOf(
        // 会话级元数据与模型侧输入：不是用户可见的对话内容。
        "session_renamed",
        "project_switched",
        "model_input",
        "hook_execution",
        "root_added",
        "root_removed",
        "root_cleared",
        "compaction",
        "governance_event",
        "reviewer_audit",
        "background_session_linked",
        "file_read",
        // 轮次内的思考、差异、审批、问答、计划、用量与后台任务：VS Code 已展示，JetBrains 历史视图尚未投影。
        "thinking",
        "redacted_thinking",
        "file_diff",
        "tool_guard_result",
        "permission_requested",
        "permission_decided",
        "plan_approval_requested",
        "plan_approval_decided",
        "plan_mode_requested",
        "plan_mode_decided",
        "steer_accepted",
        "user_question_asked",
        "user_question_answered",
        "usage",
        "turn_request",
        "turn_response",
        "governance_snapshot",
        "turn_end",
        "error",
        "background_dispatched",
        "background_completed",
        "background_cancelled",
        "background_progress",
        "background_question",
        "background_replied",
        "background_done",
        "checkpoint",
        // 任务清单状态。
        "todo_item_added",
        "todo_item_updated",
        "todo_item_deleted",
        "todo_list_reset",
    )
}

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
        val unknown = sortedSetOf<String>()
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
            val type = record.stringOrNull("type")
                ?: throw CodemError.History("CodeM history $threadId contains a malformed record")
            if (type !in HistoryRecordTypes.projected) {
                if (type !in HistoryRecordTypes.hidden) unknown += type
                return@readCommittedLines
            }
            when (type) {
                "header" -> {
                    header = true
                    val schema = integerField(record, "schema_version", threadId, "header.schema_version")
                    if (schema != 13) throw CodemError.History("schema_version $schema is not supported")
                    val session = record.stringOrNull("session_id")
                    if (session != threadId) throw CodemError.History("header session_id $session does not match file name $threadId")
                    val persisted = record.stringOrNull("cwd")
                    if (persisted != cwd) throw CodemError.History("header cwd $persisted does not match requested cwd $cwd")
                }
                "user_invocation" -> {
                    val submission = when (record.optional("submission_id")) {
                        null, JsonValue.Null -> null
                        else -> textField(record, "submission_id", threadId, "user_invocation.submission_id", nonEmpty = true).also {
                            if (it != it.trim()) throw CodemError.History("CodeM history $threadId submission_id has surrounding whitespace")
                        }
                    }
                    if (submission != null && !submissions.add(submission)) {
                        throw CodemError.History("Invalid CodeM session $threadId: duplicate submission $submission")
                    }
                    val input = record.objectOrNull("input")
                        ?: throw CodemError.History("CodeM history $threadId user_invocation.input must be an object")
                    val text = when (textField(input, "kind", threadId, "user_invocation.input.kind")) {
                        "message" -> textField(input, "content", threadId, "user_invocation.input.content")
                        "skill" -> {
                            val name = textField(input, "name", threadId, "user_invocation.input.name", nonEmpty = true)
                            if (name != name.trim()) throw CodemError.History("CodeM history $threadId input.name has surrounding whitespace")
                            when (input.optional("arguments")) {
                                null, JsonValue.Null -> "/$name"
                                else -> "/$name " + textField(input, "arguments", threadId, "user_invocation.input.arguments")
                            }
                        }
                        else -> throw CodemError.History("CodeM history $threadId user_invocation.input.kind must be message or skill")
                    }
                    turns += MutableTurn(submission, mutableListOf(text), mutableListOf(), mutableListOf())
                }
                "user_message" -> {
                    val origin = record.stringOrNull("origin")
                    if (origin == "synthetic" || origin == "ask_user_input" || origin == "hook_feedback") {
                        return@readCommittedLines
                    }
                }
                "assistant_text" -> {
                    val text = textField(record, "text", threadId, "assistant_text.text", nonEmpty = true)
                    current(turns).assistant += text
                }
                "tool_call" -> {
                    val id = textField(record, "id", threadId, "tool_call.id", nonEmpty = true)
                    current(turns).tools += (id to null)
                }
                "tool_result" -> {
                    val id = record.stringOrNull("id")
                    val content = record.stringOrNull("content")
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
                    val checkpoint = record.stringOrNull("checkpoint_id")
                    val mode = record.stringOrNull("mode")
                    if (checkpoint.isNullOrBlank() || mode.isNullOrBlank()) {
                        throw CodemError.History("CodeM history $threadId rewind_mark is missing its checkpoint identity")
                    }
                }
                else -> throw CodemError.History("CodeM history record $type is declared projected but has no handler")
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
            unknownRecordTypes = unknown,
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
        val sequence = integerField(record, "record_seq", threadId, "record_seq")
        if (sequence < 1) throw CodemError.History("CodeM history $threadId record_seq must be positive")
        if (last == null && sequence != 1) throw CodemError.History("CodeM history $threadId record_seq must start at 1")
        if (last != null && sequence != last + 1) throw CodemError.History("CodeM history $threadId record_seq $sequence does not follow $last")
        return sequence
    }

    /** Record fields fail as History, not InvalidFrame: a bad JSONL line is a history problem, not a Core frame. */
    private fun textField(record: JsonValue.ObjectValue, key: String, threadId: String, field: String, nonEmpty: Boolean = false): String {
        val text = record.stringOrNull(key)
            ?: throw CodemError.History("CodeM history $threadId $field must be a string")
        if (nonEmpty && text.isBlank()) throw CodemError.History("CodeM history $threadId $field must be non-empty")
        return text
    }

    private fun integerField(record: JsonValue.ObjectValue, key: String, threadId: String, field: String): Int {
        val number = record.numberOrNull(key)
            ?: throw CodemError.History("CodeM history $threadId $field must be an integer")
        if (!number.isFinite() || number != number.toInt().toDouble()) {
            throw CodemError.History("CodeM history $threadId $field must be an integer")
        }
        return number.toInt()
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
