package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.RpcNotification

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
    val startedAt: Long = System.currentTimeMillis(),
    var finishedAt: Long? = null,
)

/**
 * 流式文本保留空格、换行和制表符；空增量是合法 no-op。
 * 只有 turn/completed 才能进入终态。activity 不是终态。
 * 思考/工具走 item 事件投影，不另存 transcript。
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
                // VS Code：provider_stream → 模型正在生成；其余 → Core 正在处理。
                val source = textOf(notification.params.fields["source"])
                val raw = textOf(notification.params.fields["activity"])
                turn.activity = when {
                    source == "provider_stream" -> "模型正在生成"
                    !raw.isNullOrBlank() && raw != "working" -> raw
                    else -> "Core 正在处理"
                }
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

    fun liveMessages(): List<com.codem.intellij.webview.ChatMessageView> {
        val turn = current ?: return emptyList()
        if (turn.phase == TurnPhase.Terminal) return emptyList()
        return turn.activities.map { it.toMessage(turn.turnId) }
    }

    fun committedMessages(): List<com.codem.intellij.webview.ChatMessageView> {
        val turn = current ?: return emptyList()
        if (turn.phase != TurnPhase.Terminal) return emptyList()
        return turn.activities.map { it.toMessage(turn.turnId) }
    }

    private fun applyItem(params: JsonValue.ObjectValue, started: Boolean) {
        val item = params.fields["item"] as? JsonValue.ObjectValue ?: return
        val type = textOf(item.fields["type"]) ?: return
        if (type == "userMessage" || type == "agentMessage") return
        val toolName = textOf(item.fields["tool"]) ?: textOf(item.fields["toolName"])
        if (toolName == "final_answer") return
        val itemId = textOf(item.fields["id"]) ?: return
        val reasoning = type == "reasoning"
        val status = itemStatus(item, started)
        val label = when {
            reasoning -> "思考过程"
            !toolName.isNullOrBlank() && type == "mcpToolCall" -> "MCP · $toolName"
            !toolName.isNullOrBlank() -> toolName
            else -> typeLabel(type)
        }
        val body = textOf(item.fields["output"]) ?: textOf(item.fields["text"]) ?: ""
        val summary = textOf(item.fields["summary"]).orEmpty()
        val input = item.fields["arguments"] ?: item.fields["input"]
        appendActivity(
            itemId = itemId,
            callId = textOf(item.fields["callId"]),
            role = if (reasoning) "reasoning" else "tool",
            label = label,
            status = status,
            delta = body,
            append = false,
            summary = summary,
            details = if (reasoning) null else ToolDetailsProjection.project(label.removePrefix("MCP · "), input),
        )
    }

    private fun appendToolOutput(params: JsonValue.ObjectValue, delta: String) {
        if (delta.isEmpty()) return
        appendActivity(
            itemId = textOf(params.fields["itemId"]),
            callId = textOf(params.fields["callId"]),
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
