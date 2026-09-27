package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.RpcId
import com.codem.intellij.core.RpcPeer
import com.codem.intellij.core.RpcRequest
import java.util.UUID

enum class InteractionKind {
    Permission,
    Question,
    Rewind,
    Plan,
    PlanMode,
}

data class QuestionSpec(
    val id: String,
    val question: String,
    val optionLabels: Set<String>,
    val allowsMultiple: Boolean,
)

data class RewindCheckpoint(val id: String, val label: String)

data class RewindSpec(
    val checkpoints: List<RewindCheckpoint>,
    val modes: Set<String>,
) {
    val checkpointIds: Set<String> = checkpoints.map { it.id }.toSet()
}

data class LabeledChoice(val id: String, val label: String)

data class PendingInteraction(
    val requestId: String,
    val method: String,
    val kind: InteractionKind,
    val threadId: String?,
    val generation: Long,
    val choices: List<LabeledChoice>,
    val questions: List<QuestionSpec>,
    val rewind: RewindSpec?,
    val peer: RpcPeer,
    val id: RpcId,
    val detail: String? = null,
    val description: String = "",
) {
    var panelId: String = UUID.randomUUID().toString()
    var questionIndex = 0
    val answers = mutableMapOf<Int, JsonValue.ObjectValue>()
}

/**
 * One decided response to a Core request. The router decides it while the session holds its lock; the session writes
 * it to the request's own connection only after releasing the lock, so a slow or blocked stdin never holds up
 * snapshots, notifications or other callers. Each request is decided once: it leaves the pending set in the same step.
 */
class CoreReply private constructor(
    private val peer: RpcPeer,
    private val id: RpcId,
    private val result: JsonValue?,
    private val errorCode: Int,
    private val errorMessage: String,
) {
    fun send() {
        if (result != null) peer.respond(id, result) else peer.respondError(id, errorCode, errorMessage)
    }

    companion object {
        fun result(peer: RpcPeer, id: RpcId, result: JsonValue): CoreReply = CoreReply(peer, id, result, 0, "")
        fun error(peer: RpcPeer, id: RpcId, code: Int, message: String): CoreReply = CoreReply(peer, id, null, code, message)
    }
}

/** A panel reply: what to send to Core, if anything yet, and whether a cancelled permission must interrupt the turn. */
data class ReplyDecision(val reply: CoreReply?, val interruptTurn: Boolean = false)

/**
 * 仅当前连接代次、当前会话和允许选项可回复。
 * Core 回包对齐 Node host.interactionResult：审批 outcome、问答 answers、计划 approved、rewind checkpoint。
 * 不把 Webview panelReply 的 choiceIds/text 原样发给 Core。
 * 路由只决定回包，从不写 stdin：调用方持锁判定，释放锁后再发送返回的 [CoreReply]。
 */
class InteractionRouter {
    private val pending = linkedMapOf<String, PendingInteraction>()

    /**
     * Queues an interaction and returns null, or returns the rejection to send. Requests of the foreground [threadId]
     * are accepted, and those of a conversation still running in the [background]; the latter wait until it returns.
     */
    fun handle(request: RpcRequest, peer: RpcPeer, generation: Long, threadId: String?, background: (String) -> Boolean = { false }): CoreReply? {
        val kind = kindOf(request.method)
            ?: return CoreReply.error(peer, request.id, -32601, "Unsupported client request: ${request.method}")
        return try {
            val parsed = parsePending(request, kind, peer, generation, threadId)
            val owned = parsed.threadId == threadId || (parsed.threadId != null && background(parsed.threadId))
            if (!owned || parsed.requestId in pending) throw CodemError.Validation("CodeM request belongs to another thread or repeats a pending identity")
            pending[parsed.requestId] = parsed
            null
        } catch (_: CodemError) {
            CoreReply.error(peer, request.id, -32602, "Invalid CodeM client request: ${request.method}")
        }
    }

    /** Only cancelling a permission asks the session to interrupt the turn; it sends nothing itself. */
    fun reply(panelId: String, generation: Long, threadId: String?, choiceIds: List<String>, text: String, cancelled: Boolean): ReplyDecision {
        val current = current(threadId)?.takeIf { it.panelId == panelId }
            ?: throw CodemError.Conflict("CodeM interaction is no longer current")
        if (current.generation != generation || current.threadId != threadId) {
            throw CodemError.Conflict("CodeM interaction belongs to another session")
        }
        try {
            if (cancelled) {
                if (choiceIds.isNotEmpty() || text.isNotEmpty()) throw CodemError.Validation("CodeM cancelled reply must not contain answers")
                if (current.kind == InteractionKind.Permission) return ReplyDecision(null, interruptTurn = true)
                val reply = CoreReply.result(current.peer, current.id, cancelledResult(current))
                pending.remove(current.requestId)
                return ReplyDecision(reply)
            }
            if (choiceIds == listOf("previous") && current.kind == InteractionKind.Question && current.questionIndex > 0 && text.isEmpty()) {
                current.questionIndex--
                current.panelId = UUID.randomUUID().toString()
                return ReplyDecision(null)
            }
            val choices = displayedChoices(current)
            if (choiceIds.toSet().size != choiceIds.size) throw CodemError.Validation("CodeM interaction requires distinct options")
            val values = choiceIds.map { id ->
                val index = choices.indices.firstOrNull { "choice-$it" == id }
                    ?: throw CodemError.Validation("CodeM interaction rejected an unknown option")
                choices[index].id
            }
            if (current.kind == InteractionKind.Question) {
                val question = current.questions[current.questionIndex]
                if (!question.allowsMultiple && values.size > 1) throw CodemError.Validation("CodeM question does not allow multiple selection")
                if (values.isEmpty() && text.isBlank()) throw CodemError.Validation("CodeM question requires an answer")
                current.answers[current.questionIndex] = JsonValue.obj(
                    "question" to JsonValue.Text(question.question),
                    "selected" to JsonValue.ArrayValue(values.map { JsonValue.Text(it) }),
                    "freeText" to if (text.isBlank()) JsonValue.Null else JsonValue.Text(text.trim()),
                )
                if (current.questionIndex < current.questions.lastIndex) {
                    current.questionIndex++
                    current.panelId = UUID.randomUUID().toString()
                    return ReplyDecision(null)
                }
            }
            val reply = CoreReply.result(current.peer, current.id, coreResult(current, values, text, false))
            pending.remove(current.requestId)
            return ReplyDecision(reply)
        } catch (error: Throwable) {
            // A rejected submission must not leave the shared panel permanently aria-busy.
            current.panelId = UUID.randomUUID().toString()
            throw error
        }
    }

    fun renewPanel(threadId: String?) { current(threadId)?.panelId = UUID.randomUUID().toString() }

    /** A background conversation with an open request shows as awaiting approval. */
    fun hasPending(threadId: String): Boolean = pending.values.any { it.threadId == threadId }

    fun revokeThread(generation: Long, threadId: String?): List<CoreReply> =
        pending.values.filter { it.generation == generation && it.threadId == threadId }.map(::retire)

    fun revoke(generation: Long): List<CoreReply> =
        pending.values.filter { it.generation != generation }.map(::retire)

    private fun retire(interaction: PendingInteraction): CoreReply {
        pending.remove(interaction.requestId)
        return CoreReply.error(interaction.peer, interaction.id, -32000, "CodeM interaction is no longer active")
    }

    /** Only the foreground conversation's requests are shown; a background one keeps its own until it returns. */
    fun current(threadId: String?): PendingInteraction? = pending.values.lastOrNull { it.threadId == threadId }

    private fun displayedChoices(current: PendingInteraction): List<LabeledChoice> =
        if (current.kind == InteractionKind.Question) current.questions[current.questionIndex].optionLabels.map { LabeledChoice(it, it) }
        else current.choices

    /** Opaque per-page handles, including Chinese options; raw Core identities never reach the UI. */
    fun panelView(threadId: String?): com.codem.intellij.webview.PendingPanelView? {
        val current = current(threadId) ?: return null
        val kind = when (current.kind) {
            InteractionKind.Permission -> "approval"
            InteractionKind.Question -> "question"
            InteractionKind.Plan, InteractionKind.PlanMode -> "plan"
            InteractionKind.Rewind -> "rewind"
        }
        val question = current.questions.getOrNull(current.questionIndex)
        val saved = current.answers[current.questionIndex]
        val selected = saved?.arrayOrNull("selected").orEmpty().map { it.asText() }
        return com.codem.intellij.webview.PendingPanelView(
            id = current.panelId, kind = kind,
            title = when (current.kind) {
                InteractionKind.Permission -> "需要审批"
                InteractionKind.Question -> "需要回答 · ${current.questionIndex + 1}/${current.questions.size}"
                InteractionKind.Plan -> "审阅计划"
                InteractionKind.PlanMode -> "进入计划模式？"
                InteractionKind.Rewind -> "选择回退"
            },
            description = question?.question ?: current.description,
            choices = displayedChoices(current).mapIndexed { index, choice ->
                com.codem.intellij.webview.PanelChoiceView("choice-$index", choice.label, choice.id in selected)
            },
            allowText = current.kind == InteractionKind.Question || current.kind == InteractionKind.Plan,
            multiple = question?.allowsMultiple ?: false,
            detail = current.detail,
            backChoiceId = if (question != null && current.questionIndex > 0) "previous" else null,
            initialText = saved?.stringOrNull("freeText") ?: "",
            confirmLabel = if (question != null) {
                if (current.questionIndex == current.questions.lastIndex) "提交回答" else "下一步"
            } else null,
        )
    }

    private fun displayText(text: String): String =
        if (SafeNotice.containsSensitive(text)) "部分操作详情包含敏感信息，已隐藏" else text.take(8000)

    private fun detail(params: JsonValue.ObjectValue): String? {
        val preview = params.objectOrNull("preview") ?: return null
        val path = preview.stringOrNull("path")?.substringAfterLast('/')?.substringAfterLast('\\')
        val content = listOf("diffExcerpt", "changeSummary", "command", "summary", "url", "query")
            .firstNotNullOfOrNull { preview.stringOrNull(it) }
        return listOfNotNull(path, content?.let(::displayText)).joinToString("\n").takeIf { it.isNotBlank() }
    }

    private fun parsePending(
        request: RpcRequest,
        kind: InteractionKind,
        peer: RpcPeer,
        generation: Long,
        threadId: String?,
    ): PendingInteraction {
        val params = request.params
        val key = params.stringOrNull("requestId")?.takeIf { it.isNotBlank() }
            ?: request.id.toString()
        val requestThread = params.stringOrNull("threadId") ?: threadId
        return when (kind) {
            InteractionKind.Permission -> {
                val options = permissionChoices(params)
                if (options.isEmpty()) throw CodemError.Validation("CodeM ${request.method} requires approval options")
                PendingInteraction(key, request.method, kind, requestThread, generation, options, emptyList(), null, peer, request.id, detail(params), params.stringOrNull("reason")?.let(::displayText) ?: "")
            }
            InteractionKind.Question -> {
                val questions = questionSpecs(params)
                if (questions.isEmpty()) throw CodemError.Validation("CodeM ${request.method} requires questions")
                val labels = questions.flatMap { it.optionLabels }.map { LabeledChoice(it, it) }
                PendingInteraction(key, request.method, kind, requestThread, generation, labels, questions, null, peer, request.id)
            }
            InteractionKind.Rewind -> {
                val spec = rewindSpec(params)
                val choices = spec.checkpoints.map { LabeledChoice(it.id, it.label) } + spec.modes.map { LabeledChoice(it, it) }
                PendingInteraction(key, request.method, kind, requestThread, generation, choices, emptyList(), spec, peer, request.id)
            }
            InteractionKind.Plan, InteractionKind.PlanMode -> {
                val allowed = listOf(LabeledChoice("approve", "同意"), LabeledChoice("reject", "拒绝"))
                PendingInteraction(key, request.method, kind, requestThread, generation, allowed, emptyList(), null, peer, request.id, params.stringOrNull("plan")?.let(::displayText))
            }
        }
    }

    private fun coreResult(
        current: PendingInteraction,
        choiceIds: List<String>,
        text: String,
        cancelled: Boolean,
    ): JsonValue.ObjectValue {
        if (cancelled) return cancelledResult(current)
        return when (current.kind) {
            InteractionKind.Permission -> {
                if (choiceIds.size != 1) {
                    throw CodemError.Validation("CodeM interaction ${current.requestId} requires a single approval option")
                }
                JsonValue.obj("outcome" to JsonValue.obj("optionId" to JsonValue.Text(choiceIds.single())))
            }
            InteractionKind.Question -> JsonValue.obj("answers" to JsonValue.ArrayValue(current.questions.indices.map { current.answers.getValue(it) }))
            InteractionKind.Rewind -> rewindResult(current, choiceIds, text)
            InteractionKind.Plan -> {
                val approved = parseApproved(choiceIds)
                if (approved) {
                    JsonValue.obj("approved" to JsonValue.Bool(true))
                } else {
                    JsonValue.obj("approved" to JsonValue.Bool(false), "feedback" to JsonValue.Text(text))
                }
            }
            InteractionKind.PlanMode -> JsonValue.obj("approved" to JsonValue.Bool(parseApproved(choiceIds)))
        }
    }

    private fun cancelledResult(current: PendingInteraction): JsonValue.ObjectValue = when (current.kind) {
        InteractionKind.Permission ->
            throw CodemError.Validation("CodeM permission reply cannot be cancelled; choose an offered option")
        InteractionKind.Question -> JsonValue.obj("cancelled" to JsonValue.Bool(true))
        InteractionKind.Rewind -> JsonValue.obj("status" to JsonValue.Text("cancelled"))
        InteractionKind.Plan -> JsonValue.obj("approved" to JsonValue.Bool(false), "feedback" to JsonValue.Text(""))
        InteractionKind.PlanMode -> JsonValue.obj("approved" to JsonValue.Bool(false))
    }

    private fun rewindResult(current: PendingInteraction, choiceIds: List<String>, text: String): JsonValue.ObjectValue {
        val spec = current.rewind ?: throw CodemError.Validation("CodeM rewind reply is missing checkpoints")
        val checkpointId = choiceIds.getOrNull(0) ?: throw CodemError.Validation("CodeM rewind requires a checkpoint")
        val mode = choiceIds.getOrNull(1) ?: text.takeIf { it in REWIND_MODES }
            ?: throw CodemError.Validation("CodeM rewind requires a mode")
        if (checkpointId !in spec.checkpointIds) throw CodemError.Validation("CodeM rewind checkpoint was not offered")
        if (mode !in spec.modes) throw CodemError.Validation("CodeM rewind mode was not offered")
        return JsonValue.obj(
            "status" to JsonValue.Text("selected"),
            "checkpointId" to JsonValue.Text(checkpointId),
            "mode" to JsonValue.Text(mode),
        )
    }

    private fun parseApproved(choiceIds: List<String>): Boolean {
        val choice = choiceIds.singleOrNull() ?: throw CodemError.Validation("CodeM plan reply requires a single approval choice")
        return when (choice) {
            "approve" -> true
            "reject" -> false
            else -> throw CodemError.Validation("CodeM plan reply is invalid")
        }
    }

    /** 回复仍用 optionId；界面文案用 Core 给的 label，没有 label 才退回 id。 */
    private fun permissionChoices(params: JsonValue.ObjectValue): List<LabeledChoice> {
        val options = params.arrayOrNull("options").orEmpty()
        return options.filterIsInstance<JsonValue.ObjectValue>().mapNotNull { option ->
            val id = (option.stringOrNull("optionId") ?: option.stringOrNull("id"))?.takeIf { it.isNotBlank() }
                ?: return@mapNotNull null
            val label = option.stringOrNull("label")?.takeIf { it.isNotBlank() } ?: id
            LabeledChoice(id, label)
        }
    }

    private fun questionSpecs(params: JsonValue.ObjectValue): List<QuestionSpec> {
        val questions = params.arrayOrNull("questions")
            ?: throw CodemError.Validation("CodeM user questions must be an array")
        return questions.mapIndexed { index, entry ->
            val question = entry.asObject("user questions[$index]")
            val text = question.stringOrNull("question")?.takeIf { it.isNotBlank() }
                ?: throw CodemError.Validation("CodeM user questions[$index].question is required")
            val labels = question.arrayOrNull("options").orEmpty().filterIsInstance<JsonValue.ObjectValue>().mapNotNull { option ->
                option.stringOrNull("label")?.takeIf { it.isNotBlank() }
            }.toSet()
            if ("allowsMultipleSelection" in question.fields || "multi_select" in question.fields) {
                throw CodemError.Validation("CodeM user questions[$index] must use multiSelect")
            }
            val multi = when (val field = question.fields["multiSelect"]) {
                null -> false
                is JsonValue.Bool -> field.value
                else -> throw CodemError.Validation("CodeM user questions[$index].multiSelect must be boolean")
            }
            QuestionSpec(
                id = question.stringOrNull("id")?.takeIf { it.isNotBlank() } ?: "question-${index + 1}",
                question = text,
                optionLabels = labels,
                allowsMultiple = multi,
            )
        }
    }

    private fun rewindSpec(params: JsonValue.ObjectValue): RewindSpec {
        val checkpoints = params.arrayOrNull("checkpoints")
            ?: throw CodemError.Validation("CodeM rewind requires checkpoints")
        val ids = checkpoints.mapIndexed { index, entry ->
            // Any CodemError here becomes the same -32602 rejection in handle(); the class is not observable.
            val checkpoint = entry.asObject("rewind checkpoints[$index]")
            val id = checkpoint.stringOrNull("id")?.takeIf { it.isNotBlank() }
                ?: throw CodemError.Validation("CodeM rewind checkpoints[$index].id is required")
            val label = checkpoint.stringOrNull("label")?.takeIf { it.isNotBlank() } ?: id
            RewindCheckpoint(id, label)
        }
        if (ids.isEmpty()) throw CodemError.Validation("CodeM rewind requires checkpoints")
        val modes = params.arrayOrNull("modes").orEmpty()
            .filterIsInstance<JsonValue.Text>()
            .map { it.value }
            .filter { it in REWIND_MODES }
            .toSet()
        if (modes.isEmpty()) throw CodemError.Validation("CodeM rewind requires modes")
        return RewindSpec(ids, modes)
    }

    companion object {
        private val REWIND_MODES = setOf("code", "conversation", "both")

        fun kindOf(method: String): InteractionKind? = when (method) {
            "item/tool/requestApproval",
            "item/command/requestApproval",
            "item/fileChange/requestApproval",
            "item/permissions/requestApproval",
            -> InteractionKind.Permission
            "item/tool/requestUserInput" -> InteractionKind.Question
            "item/plan/requestApproval" -> InteractionKind.Plan
            "item/planMode/requestApproval" -> InteractionKind.PlanMode
            "item/rewind/requestSelection" -> InteractionKind.Rewind
            else -> null
        }
    }
}
