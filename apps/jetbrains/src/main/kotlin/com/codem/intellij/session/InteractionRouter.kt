package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.RpcId
import com.codem.intellij.core.RpcPeer
import com.codem.intellij.core.RpcRequest

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

data class RewindSpec(
    val checkpointIds: Set<String>,
    val modes: Set<String>,
)

data class PendingInteraction(
    val requestId: String,
    val method: String,
    val kind: InteractionKind,
    val threadId: String?,
    val generation: Long,
    val allowedChoiceIds: Set<String>,
    val questions: List<QuestionSpec>,
    val rewind: RewindSpec?,
    val peer: RpcPeer,
    val id: RpcId,
)

/**
 * 仅当前连接代次、当前会话和允许选项可回复。
 * Core 回包对齐 Node host.interactionResult：审批 outcome、问答 answers、计划 approved、rewind checkpoint。
 * 不把 Webview panelReply 的 choiceIds/text 原样发给 Core。
 */
class InteractionRouter {
    private val pending = linkedMapOf<String, PendingInteraction>()

    fun handle(request: RpcRequest, peer: RpcPeer, generation: Long, threadId: String?): Boolean {
        val kind = kindOf(request.method)
        if (kind == null) {
            peer.respondError(request.id, -32601, "Unsupported client request: ${request.method}")
            return false
        }
        return try {
            val parsed = parsePending(request, kind, peer, generation, threadId)
            pending[parsed.requestId] = parsed
            true
        } catch (_: CodemError) {
            peer.respondError(request.id, -32602, "Invalid CodeM client request: ${request.method}")
            false
        }
    }

    fun reply(requestId: String, generation: Long, threadId: String?, choiceIds: List<String>, text: String, cancelled: Boolean) {
        val current = pending[requestId] ?: throw CodemError.Conflict("CodeM interaction $requestId is not pending")
        if (current.generation != generation || (current.threadId != null && current.threadId != threadId)) {
            throw CodemError.Conflict("CodeM interaction $requestId belongs to another session")
        }
        if (!cancelled && current.allowedChoiceIds.isNotEmpty() && choiceIds.any { it !in current.allowedChoiceIds }) {
            throw CodemError.Validation("CodeM interaction $requestId rejected an unknown option")
        }
        val result = coreResult(current, choiceIds, text, cancelled)
        pending.remove(requestId)
        current.peer.respond(current.id, result)
    }

    fun revoke(generation: Long) {
        val stale = pending.values.filter { it.generation != generation }
        stale.forEach { interaction ->
            pending.remove(interaction.requestId)
            try {
                interaction.peer.respondError(interaction.id, -32000, "CodeM interaction belongs to a retired connection")
            } catch (_: Exception) {
            }
        }
    }

    fun current(): PendingInteraction? = pending.values.lastOrNull()

    /** UI 只拿到当前请求的选项，不写死 approval-1。 */
    fun panelView(): com.codem.intellij.webview.PendingPanelView? {
        val current = current() ?: return null
        val kind = when (current.kind) {
            InteractionKind.Permission -> "approval"
            InteractionKind.Question -> "question"
            InteractionKind.Plan, InteractionKind.PlanMode -> "plan"
            InteractionKind.Rewind -> "rewind"
        }
        val title = when (current.kind) {
            InteractionKind.Permission -> "需要审批"
            InteractionKind.Question -> current.questions.firstOrNull()?.question ?: "需要回答"
            InteractionKind.Plan, InteractionKind.PlanMode -> "确认计划"
            InteractionKind.Rewind -> "选择回退"
        }
        return com.codem.intellij.webview.PendingPanelView(
            id = current.requestId,
            kind = kind,
            title = title,
            description = current.method.substringAfterLast('/'),
            choices = current.allowedChoiceIds.map { com.codem.intellij.webview.PanelChoiceView(it, it) },
            allowText = current.kind == InteractionKind.Question || current.kind == InteractionKind.Plan,
            multiple = current.questions.any { it.allowsMultiple },
        )
    }

    private fun parsePending(
        request: RpcRequest,
        kind: InteractionKind,
        peer: RpcPeer,
        generation: Long,
        threadId: String?,
    ): PendingInteraction {
        val params = request.params
        val key = (params.fields["requestId"] as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() }
            ?: request.id.toString()
        val requestThread = (params.fields["threadId"] as? JsonValue.Text)?.value ?: threadId
        return when (kind) {
            InteractionKind.Permission -> {
                val options = permissionOptionIds(params)
                if (options.isEmpty()) throw CodemError.Validation("CodeM ${request.method} requires approval options")
                PendingInteraction(key, request.method, kind, requestThread, generation, options, emptyList(), null, peer, request.id)
            }
            InteractionKind.Question -> {
                val questions = questionSpecs(params)
                if (questions.isEmpty()) throw CodemError.Validation("CodeM ${request.method} requires questions")
                val labels = questions.flatMap { it.optionLabels }.toSet()
                PendingInteraction(key, request.method, kind, requestThread, generation, labels, questions, null, peer, request.id)
            }
            InteractionKind.Rewind -> {
                val spec = rewindSpec(params)
                PendingInteraction(key, request.method, kind, requestThread, generation, spec.checkpointIds + spec.modes, emptyList(), spec, peer, request.id)
            }
            InteractionKind.Plan, InteractionKind.PlanMode -> {
                val allowed = setOf("true", "false", "approve", "reject", "approved", "agree")
                PendingInteraction(key, request.method, kind, requestThread, generation, allowed, emptyList(), null, peer, request.id)
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
            InteractionKind.Question -> questionResult(current, choiceIds, text)
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

    private fun questionResult(current: PendingInteraction, choiceIds: List<String>, text: String): JsonValue.ObjectValue {
        if (current.questions.size != 1) {
            throw CodemError.Validation("CodeM question reply requires one answer per question")
        }
        val question = current.questions.single()
        if (!question.allowsMultiple && choiceIds.size > 1) {
            throw CodemError.Validation("CodeM question ${question.id} does not allow multiple selection")
        }
        val freeText = if (text.isEmpty()) JsonValue.Null else JsonValue.Text(text)
        val answer = JsonValue.obj(
            "question" to JsonValue.Text(question.question),
            "selected" to JsonValue.ArrayValue(choiceIds.map { JsonValue.Text(it) }),
            "freeText" to freeText,
        )
        return JsonValue.obj("answers" to JsonValue.ArrayValue(listOf(answer)))
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
            "true", "approve", "approved", "agree" -> true
            "false", "reject" -> false
            else -> throw CodemError.Validation("CodeM plan reply is invalid")
        }
    }

    private fun permissionOptionIds(params: JsonValue.ObjectValue): Set<String> {
        val options = (params.fields["options"] as? JsonValue.ArrayValue)?.items.orEmpty()
        return options.mapNotNull { option ->
            val fields = (option as? JsonValue.ObjectValue)?.fields ?: return@mapNotNull null
            ((fields["optionId"] as? JsonValue.Text) ?: (fields["id"] as? JsonValue.Text))?.value?.takeIf { it.isNotBlank() }
        }.toSet()
    }

    private fun questionSpecs(params: JsonValue.ObjectValue): List<QuestionSpec> {
        val questions = (params.fields["questions"] as? JsonValue.ArrayValue)?.items
            ?: throw CodemError.Validation("CodeM user questions must be an array")
        return questions.mapIndexed { index, entry ->
            val question = entry.asObject()
            val text = (question.fields["question"] as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() }
                ?: throw CodemError.Validation("CodeM user questions[$index].question is required")
            val labels = ((question.fields["options"] as? JsonValue.ArrayValue)?.items.orEmpty()).mapNotNull { option ->
                ((option as? JsonValue.ObjectValue)?.fields?.get("label") as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() }
            }.toSet()
            val multi = (question.fields["allowsMultipleSelection"] as? JsonValue.Bool)?.value == true ||
                (question.fields["multi_select"] as? JsonValue.Bool)?.value == true
            QuestionSpec(
                id = (question.fields["id"] as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() } ?: "question-${index + 1}",
                question = text,
                optionLabels = labels,
                allowsMultiple = multi,
            )
        }
    }

    private fun rewindSpec(params: JsonValue.ObjectValue): RewindSpec {
        val checkpoints = (params.fields["checkpoints"] as? JsonValue.ArrayValue)?.items
            ?: throw CodemError.Validation("CodeM rewind requires checkpoints")
        val ids = checkpoints.mapIndexed { index, entry ->
            ((entry as? JsonValue.ObjectValue)?.fields?.get("id") as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() }
                ?: throw CodemError.Validation("CodeM rewind checkpoints[$index].id is required")
        }.toSet()
        if (ids.isEmpty()) throw CodemError.Validation("CodeM rewind requires checkpoints")
        val modes = ((params.fields["modes"] as? JsonValue.ArrayValue)?.items.orEmpty()).mapNotNull { item ->
            (item as? JsonValue.Text)?.value?.takeIf { it in REWIND_MODES }
        }.toSet()
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
