package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.RpcNotification
import com.codem.intellij.webview.ChatMessageView

data class TurnState(
    val turnId: String,
    val submissionId: String?,
    var phase: TurnPhase,
    val text: StringBuilder = StringBuilder(),
    val reasoning: StringBuilder = StringBuilder(),
    var activity: String? = null,
    var terminalStatus: String? = null,
    var usage: JsonValue.ObjectValue? = null,
    var plan: JsonValue? = null,
    var diffSummary: JsonValue? = null,
    val activities: MutableList<TurnActivity> = mutableListOf(),
    val toolMessageIds: MutableMap<String, String> = mutableMapOf(),
    /** final_answer 的 callId 与 itemId：其结果与进度属于结构化交付，不再作为工具活动出现。 */
    val finalAnswerCalls: MutableSet<String> = mutableSetOf(),
    val finalAnswerItems: MutableSet<String> = mutableSetOf(),
    /** 按 itemId 保存结构化交付；与流式正文分开，轮次消息中排在最后。 */
    val finalAnswers: LinkedHashMap<String, FinalAnswer> = linkedMapOf(),
    val startedAt: Long = System.currentTimeMillis(),
    var finishedAt: Long? = null,
)

/**
 * 流式文本保留空格、换行和制表符；空增量是合法 no-op。
 * 只有 turn/completed 才能进入终态。activity 不是终态。
 * 思考/工具走 item 事件投影，不另存 transcript。
 * 工具名、callId、输入与 final_answer 由 [CoreItemProjection] 按 Node Host 的 parseAppServerItem 推导，
 * 活动文案与交付位置对齐 VS Code chatController。
 */
class TurnAccumulator {
    var current: TurnState? = null
        private set

    fun apply(notification: RpcNotification, expectedThreadId: String?) {
        val threadId = (notification.params.fields["threadId"] as? JsonValue.Text)?.value
        if (expectedThreadId != null && threadId != null && threadId != expectedThreadId) return
        when (notification.method) {
            "turn/started" -> {
                val turnId = turnIdOf(notification.params)
                val existing = current
                // 已完成轮次不得复活；Core 主动新轮次必须换一份干净状态。
                if (existing?.phase == TurnPhase.Terminal) {
                    if (existing.turnId == turnId) return
                    current = TurnState(turnId, null, TurnPhase.Running)
                    return
                }
                if (existing != null && existing.turnId != turnId && existing.turnId != "pending") {
                    throw CodemError.Conflict("CodeM turn/started changed turn identity from ${existing.turnId} to $turnId")
                }
                current = existing?.copy(turnId = turnId, phase = TurnPhase.Running)
                    ?: TurnState(turnId, existing?.submissionId, TurnPhase.Running)
            }
            "turn/activity" -> {
                val turn = current ?: return
                if (turn.phase == TurnPhase.Terminal) return
                // 与 VS Code chatController 相同的两种文案；Core 的原始 activity 文本不进入界面。
                turn.activity = if (textOf(notification.params.fields["source"]) == "provider_stream") "模型正在生成" else "Core 正在处理"
            }
            "item/agentMessage/delta" -> append(current?.text, notification.params.fields["delta"])
            "item/reasoning/textDelta" -> {
                append(current?.reasoning, notification.params.fields["delta"])
                appendActivity(
                    itemId = textOf(notification.params.fields["itemId"]),
                    callId = null,
                    role = "reasoning",
                    label = "思考过程",
                    status = "running",
                    delta = textOf(notification.params.fields["delta"]).orEmpty(),
                    append = true,
                )
            }
            "item/started", "item/completed" -> applyItem(notification.params, started = notification.method == "item/started")
            "item/toolCall/progress" -> appendToolOutput(
                notification.params,
                textOf(notification.params.fields["message"]).orEmpty(),
            )
            "item/commandExecution/outputDelta" -> appendToolOutput(
                notification.params,
                textOf(notification.params.fields["delta"]).orEmpty(),
            )
            "item/subagent/progress" -> appendToolOutput(
                notification.params,
                textOf(notification.params.fields["note"]).orEmpty(),
            )
            "turn/tokenUsage/updated", "thread/tokenUsage/updated" -> {
                current?.usage = notification.params
            }
            "turn/plan/updated" -> current?.plan = notification.params.fields["plan"]
            "turn/diff/updated" -> current?.diffSummary = notification.params
            "turn/completed" -> {
                val turn = current ?: TurnState(turnIdOf(notification.params), null, TurnPhase.Running)
                val completedId = turnIdOf(notification.params)
                if (turn.turnId != completedId) throw CodemError.Conflict("CodeM turn/completed changed turn identity from ${turn.turnId} to $completedId")
                val status = ((notification.params.fields["turn"] as? JsonValue.ObjectValue)?.fields?.get("status") as? JsonValue.Text)?.value
                    ?: (notification.params.fields["status"] as? JsonValue.Text)?.value
                    ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM turn/completed status is required")
                turn.phase = TurnPhase.Terminal
                turn.terminalStatus = status
                turn.finishedAt = System.currentTimeMillis()
                turn.activity = null
                finishActivities(turn, status)
                current = turn
            }
        }
    }

    fun beginSubmit(submissionId: String) {
        val phase = current?.phase
        if (phase == TurnPhase.Submitting || phase == TurnPhase.Running || phase == TurnPhase.Interrupting) {
            throw CodemError.Conflict("CodeM thread is already submitting")
        }
        current = TurnState("pending", submissionId, TurnPhase.Submitting)
    }

    fun acceptStarted(turnId: String) {
        val existing = current
        if (existing?.phase == TurnPhase.Terminal) return
        current = existing?.copy(turnId = turnId, phase = TurnPhase.Running) ?: TurnState(turnId, existing?.submissionId, TurnPhase.Running)
    }

    fun markInterrupting() {
        val turn = current ?: throw CodemError.Conflict("CodeM turn/interrupt has no active turn")
        if (turn.phase == TurnPhase.Terminal) {
            throw CodemError.Conflict("CodeM turn/interrupt has no active turn")
        }
        if (turn.turnId == "pending") {
            throw CodemError.Conflict("CodeM turn/interrupt requires a started turn")
        }
        turn.phase = TurnPhase.Interrupting
    }

    fun restoreRunningIfInterrupting() {
        val turn = current ?: return
        if (turn.phase == TurnPhase.Interrupting) turn.phase = TurnPhase.Running
    }

    fun clearIfTerminal() {
        if (current?.phase == TurnPhase.Terminal) current = null
    }

    fun resetActive() {
        current = null
    }

    /**
     * 连接丢失不是终态：仍在运行的思考/工具标为 incomplete 交给时间线保留，
     * 没有 turn/completed 的正文不落。已终态的轮次不动。
     */
    fun abandonActive(): TurnState? {
        val turn = current?.takeIf { it.phase != TurnPhase.Terminal } ?: return null
        current = null
        for (activity in turn.activities) {
            if (activity.status == "running") activity.status = "incomplete"
        }
        return turn
    }

    fun liveMessages(): List<ChatMessageView> {
        val turn = current ?: return emptyList()
        if (turn.phase == TurnPhase.Terminal) return emptyList()
        return turn.activities.map { it.toMessage(turn.turnId) } + finalReplies(turn)
    }

    /**
     * 终态顺序：思考/工具、流式正文、结构化交付。交付放在最后，与 VS Code terminalReplyLast 一致。
     * 正文沿用 turnId 作为消息 id，ProjectSession 按 id 去重，不会重复落盘。
     */
    fun committedMessages(): List<ChatMessageView> {
        val turn = current ?: return emptyList()
        if (turn.phase != TurnPhase.Terminal) return emptyList()
        val text = turn.text.toString()
        val reply = if (text.isEmpty()) emptyList() else listOf(ChatMessageView(turn.turnId, "assistant", text, turnId = turn.turnId))
        return turn.activities.map { it.toMessage(turn.turnId) } + reply + finalReplies(turn)
    }

    private fun finalReplies(turn: TurnState): List<ChatMessageView> =
        turn.finalAnswers.map { (itemId, answer) ->
            ChatMessageView(
                "${turn.turnId}:final:$itemId",
                "assistant",
                answer.summary,
                turnId = turn.turnId,
                hasArtifacts = answer.artifacts.isNotEmpty(),
            )
        }

    private fun applyItem(params: JsonValue.ObjectValue, started: Boolean) {
        val turn = current ?: return
        if (turn.phase == TurnPhase.Terminal) return
        val item = params.fields["item"] as? JsonValue.ObjectValue ?: return
        val type = textOf(item.fields["type"]) ?: return
        if (type == "userMessage" || type == "agentMessage") return
        val itemId = textOf(item.fields["id"])?.takeIf { it.isNotBlank() } ?: return
        val projected = CoreItemProjection.project(item)
        if (projected.toolName == "final_answer") {
            acceptFinalAnswer(turn, item, itemId, projected, started)
            return
        }
        // final_answer 调用的结果条目属于交付本身，不另起工具活动。
        if (projected.callId != null && projected.callId in turn.finalAnswerCalls) return
        val reasoning = type == "reasoning"
        val status = itemStatus(item, started)
        val label = when {
            reasoning -> "思考过程"
            projected.toolName != null && type == "mcpToolCall" -> "MCP · ${projected.toolName}"
            projected.toolName != null -> projected.toolName
            else -> typeLabel(type)
        }
        val body = textOf(item.fields["output"]) ?: textOf(item.fields["text"]) ?: ""
        val summary = textOf(item.fields["summary"]).orEmpty()
        appendActivity(
            itemId = itemId,
            callId = projected.callId,
            role = if (reasoning) "reasoning" else "tool",
            label = label,
            status = status,
            delta = body,
            append = false,
            summary = summary,
            details = if (reasoning) null else ToolDetailsProjection.project(label.removePrefix("MCP · "), projected.input),
        )
    }

    /**
     * 与 Node Host 合并 started/completed 的规则一致：后到的交付覆盖摘要，首个非空的附件列表保留；
     * completed 却始终没有结构化输入是协议错误。
     */
    private fun acceptFinalAnswer(turn: TurnState, item: JsonValue.ObjectValue, itemId: String, projected: CoreItemFields, started: Boolean) {
        projected.callId?.let { turn.finalAnswerCalls += it }
        turn.finalAnswerItems += itemId
        val previous = turn.finalAnswers[itemId]
        val answer = projected.finalAnswer
        if (answer == null) {
            if (!started && previous == null && textOf(item.fields["status"]) == "completed") {
                throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM final_answer item completed without structured input")
            }
            return
        }
        turn.finalAnswers[itemId] = if (previous?.artifacts?.isNotEmpty() == true) answer.copy(artifacts = previous.artifacts) else answer
    }

    private fun appendToolOutput(params: JsonValue.ObjectValue, delta: String) {
        if (delta.isEmpty()) return
        val turn = current ?: return
        val itemId = textOf(params.fields["itemId"])
        val callId = textOf(params.fields["callId"])
        if ((callId != null && callId in turn.finalAnswerCalls) || (itemId != null && itemId in turn.finalAnswerItems)) return
        appendActivity(
            itemId = itemId,
            callId = callId,
            role = "tool",
            label = "调用工具",
            status = "running",
            delta = delta,
            append = true,
        )
    }

    private fun appendActivity(
        itemId: String?,
        callId: String?,
        role: String,
        label: String,
        status: String,
        delta: String,
        append: Boolean,
        summary: String = "",
        details: com.codem.intellij.webview.ToolDetailsView? = null,
    ) {
        val turn = current ?: return
        if (turn.phase == TurnPhase.Terminal) return
        val id = if (role == "reasoning") {
            "${turn.turnId}:${itemId ?: "reasoning"}"
        } else {
            toolMessageId(turn, itemId, callId)
        }
        val existing = turn.activities.find { it.id == id }
        if (existing == null) {
            val created = TurnActivity(id, role, label, status)
            if (delta.isNotEmpty()) created.text.append(delta)
            created.summary = summary
            created.details = details
            turn.activities += created
            return
        }
        if (label.isNotBlank() && (existing.label == "调用工具" || existing.label == "思考过程")) existing.label = label
        // 已终态的条目不能被迟到的 progress 打回 running。
        if (status != "running" || existing.status == "running") existing.status = status
        if (append && delta.isNotEmpty()) existing.text.append(delta)
        else if (!append && delta.isNotEmpty()) {
            existing.text.setLength(0)
            existing.text.append(delta)
        }
        if (summary.isNotBlank()) existing.summary = summary
        if (details != null) existing.details = details
    }

    private fun toolMessageId(turn: TurnState, itemId: String?, callId: String?): String {
        val itemKey = itemId?.let { "item:$it" }
        val callKey = callId?.let { "call:$it" }
        val existing = (callKey?.let { turn.toolMessageIds[it] }) ?: itemKey?.let { turn.toolMessageIds[it] }
        val id = existing ?: "${turn.turnId}:tool:${itemId ?: callId ?: turn.activities.size}"
        if (itemKey != null) turn.toolMessageIds[itemKey] = id
        if (callKey != null) turn.toolMessageIds[callKey] = id
        return id
    }

    private fun finishActivities(turn: TurnState, status: String) {
        val terminal = when (status) {
            "completed" -> "completed"
            "stopped" -> "interrupted"
            else -> "failed"
        }
        for (activity in turn.activities) {
            if (activity.status != "running") continue
            // 轮次成功不能证明缺结果的工具成功。
            activity.status = if (terminal == "completed" && activity.role == "tool") "incomplete" else terminal
        }
    }

    private fun itemStatus(item: JsonValue.ObjectValue, started: Boolean): String {
        if ((item.fields["isError"] as? JsonValue.Bool)?.value == true) return "failed"
        return when (textOf(item.fields["status"])) {
            "inProgress" -> "running"
            "completed" -> "completed"
            "failed" -> "failed"
            "declined" -> "declined"
            "interrupted" -> "interrupted"
            else -> if (started) "running" else "completed"
        }
    }

    private fun typeLabel(type: String): String = when (type) {
        "commandExecution" -> "执行命令"
        "fileChange" -> "修改文件"
        "mcpToolCall" -> "调用工具"
        "webSearch" -> "搜索"
        "contextCompaction" -> "整理上下文"
        "toolCall" -> "调用工具"
        "toolResult" -> "工具结果"
        "subagent" -> "子任务"
        "reasoning" -> "思考过程"
        else -> "调用工具"
    }

    private fun append(target: StringBuilder?, delta: JsonValue?) {
        if (target == null) return
        val text = (delta as? JsonValue.Text)?.value ?: return
        if (text.isEmpty()) return
        target.append(text)
    }

    private fun textOf(value: JsonValue?): String? = (value as? JsonValue.Text)?.value

    private fun turnIdOf(params: JsonValue.ObjectValue): String {
        val nested = (params.fields["turn"] as? JsonValue.ObjectValue)?.fields?.get("id")
        val direct = params.fields["turnId"]
        val value = (nested as? JsonValue.Text)?.value ?: (direct as? JsonValue.Text)?.value
        return value?.takeIf { it.isNotBlank() } ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "turn id is required")
    }
}

data class FinalAnswerArtifact(
    val kind: String,
    val title: String,
    val source: String?,
    val uri: String?,
    val path: String?,
    val filename: String?,
    val alt: String?,
    val mime: String?,
    val spec: JsonValue,
)

/** Core final_answer 的结构化交付：摘要与附件都保留，不被当作普通工具调用丢弃。 */
data class FinalAnswer(
    val status: String,
    val kind: String,
    val summary: String,
    val artifacts: List<FinalAnswerArtifact>,
)

internal data class CoreItemFields(
    val toolName: String?,
    val callId: String?,
    val input: JsonValue.ObjectValue?,
    val finalAnswer: FinalAnswer?,
)

/**
 * `@codem/app-server` parseAppServerItem 中决定展示的字段：toolName 是 packages/ui toolPresentation 的键，
 * callId 关联进度，input 进入工具详情，final_answer 按 parseFinalAnswer 严格解析。
 * 与 packages/contracts/core/itemProjection.json 逐例对照；结构不符按 InvalidFrame 拒绝。
 */
internal object CoreItemProjection {
    private val FINAL_ANSWER_FIELDS = setOf("status", "kind", "summary", "artifacts")
    private val ARTIFACT_FIELDS = setOf("kind", "title", "source", "uri", "path", "filename", "alt", "mime", "spec")
    private val ARTIFACT_KINDS = setOf("file", "image", "chart", "url")
    private val ANSWER_STATUSES = setOf("complete", "partial", "blocked")

    fun project(item: JsonValue.ObjectValue): CoreItemFields {
        val fields = item.fields
        val type = (fields["type"] as? JsonValue.Text)?.value
        val toolName = nonBlank(fields["tool"]) ?: when (type) {
            "subagent" -> "dispatch"
            "contextCompaction" -> "compact"
            else -> null
        }
        val callId = nonBlank(fields["callId"])
            ?: nonBlank(fields["subagentId"])
            ?: if (toolName != null) nonBlank(fields["id"]) ?: invalid("item.id must be non-empty") else null
        val input = objectOrNull(fields["arguments"], "item.arguments") ?: when (type) {
            "subagent" -> compactObject("label" to nonBlank(fields["label"])?.let(JsonValue::Text), "kind" to nonBlank(fields["subagentKind"])?.let(JsonValue::Text))
            "contextCompaction" -> compactObject("replaced" to nonNegativeInteger(fields["replaced"]), "kept" to nonNegativeInteger(fields["kept"]))
            else -> null
        }
        val finalAnswer = if (toolName == "final_answer" && input != null) parseFinalAnswer(input, "item.arguments") else null
        return CoreItemFields(toolName, callId, input, finalAnswer)
    }

    private fun parseFinalAnswer(answer: JsonValue.ObjectValue, label: String): FinalAnswer {
        requireOnlyFields(answer, FINAL_ANSWER_FIELDS, label)
        val status = when (val value = answer.fields["status"]) {
            null -> "complete"
            else -> (value as? JsonValue.Text)?.value?.takeIf { it in ANSWER_STATUSES } ?: invalid("$label.status has an invalid value")
        }
        val kind = if ((answer.fields["kind"] as? JsonValue.Text)?.value == "chat") "chat" else "task"
        val summary = nonBlank(answer.fields["summary"]) ?: invalid("$label.summary must be non-empty")
        val artifacts = when (val value = answer.fields["artifacts"]) {
            null -> emptyList()
            is JsonValue.ArrayValue -> value.items.mapIndexed { index, artifact -> parseArtifact(artifact, "$label.artifacts[$index]") }
            else -> invalid("$label.artifacts must be an array")
        }
        return FinalAnswer(status, kind, summary, artifacts)
    }

    private fun parseArtifact(value: JsonValue, label: String): FinalAnswerArtifact {
        val artifact = value as? JsonValue.ObjectValue ?: invalid("$label must be an object")
        requireOnlyFields(artifact, ARTIFACT_FIELDS, label)
        val fields = artifact.fields
        return FinalAnswerArtifact(
            kind = (fields["kind"] as? JsonValue.Text)?.value?.takeIf { it in ARTIFACT_KINDS } ?: invalid("$label.kind has an invalid value"),
            title = (fields["title"] as? JsonValue.Text)?.value ?: invalid("$label.title must be a string"),
            source = nullableString(fields["source"], "$label.source"),
            uri = nullableString(fields["uri"], "$label.uri"),
            path = nullableString(fields["path"], "$label.path"),
            filename = nullableString(fields["filename"], "$label.filename"),
            alt = nullableString(fields["alt"], "$label.alt"),
            mime = nullableString(fields["mime"], "$label.mime"),
            spec = fields["spec"] ?: JsonValue.Null,
        )
    }

    private fun requireOnlyFields(value: JsonValue.ObjectValue, allowed: Set<String>, label: String) {
        if (value.fields.keys.any { it !in allowed }) invalid("$label has unsupported fields")
    }

    private fun objectOrNull(value: JsonValue?, label: String): JsonValue.ObjectValue? = when (value) {
        null, JsonValue.Null -> null
        is JsonValue.ObjectValue -> value
        else -> invalid("$label must be an object")
    }

    private fun nullableString(value: JsonValue?, label: String): String? = when (value) {
        null, JsonValue.Null -> null
        is JsonValue.Text -> value.value
        else -> invalid("$label must be a string")
    }

    private fun nonBlank(value: JsonValue?): String? = (value as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() }

    private fun nonNegativeInteger(value: JsonValue?): JsonValue? =
        (value as? JsonValue.NumberValue)?.takeIf { it.value >= 0 && it.value == Math.floor(it.value) && !it.value.isInfinite() }

    private fun compactObject(vararg entries: Pair<String, JsonValue?>): JsonValue.ObjectValue? {
        val present = entries.mapNotNull { (key, value) -> value?.let { key to it } }
        return if (present.isEmpty()) null else JsonValue.ObjectValue(linkedMapOf(*present.toTypedArray()))
    }

    private fun invalid(reason: String): Nothing =
        throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM App Server $reason")
}
