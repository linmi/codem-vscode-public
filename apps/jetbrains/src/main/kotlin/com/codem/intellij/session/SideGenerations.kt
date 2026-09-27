package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import java.util.concurrent.CompletableFuture

/**
 * The one IDE text generation in flight (the terminal command today). It borrows the thread's side-question slot,
 * like VS Code ChatController.generateText, and never starts an Agent turn.
 *
 * Owns the generation's question, the side question id Core gave it, the answer so far and its outcome. Every call
 * runs under ProjectSession's lock. The slot is held from [begin] until [release], also while a cancelled question
 * waits for Core to settle it, so a second generation cannot collide with it; [clear] ends it when the connection or
 * thread goes away. Side questions the chat asked itself never match the question and are left alone.
 */
class SideGenerations {
    class Active internal constructor(val question: String) {
        internal var threadId: String? = null
        internal var sideQuestionId: String? = null
        internal val answer = StringBuilder()
        /** Completes with the answer, or fails with a user-visible CodeM error. */
        val outcome = CompletableFuture<String>()
    }

    private var active: Active? = null

    val busy: Boolean get() = active != null

    fun begin(question: String): Active {
        if (active != null) throw CodemError.Conflict(BUSY)
        return Active(question).also { active = it }
    }

    /** thread/sideQuestion/start answered with [id]; a started notification may have named it first. */
    fun accept(generation: Active, threadId: String, id: String) {
        if (active !== generation) return
        val known = generation.sideQuestionId
        if (known != null && known != id) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM side question response conflicts with its notification")
        }
        generation.threadId = threadId
        generation.sideQuestionId = id
    }

    fun sideQuestionOf(generation: Active): Pair<String, String>? {
        if (active !== generation) return null
        val thread = generation.threadId ?: return null
        val id = generation.sideQuestionId ?: return null
        return thread to id
    }

    /** Applies one thread/sideQuestion/ notification of the subscribed thread. Others' side questions are ignored. */
    fun apply(method: String, params: JsonValue.ObjectValue) {
        val generation = active ?: return
        when (method) {
            "thread/sideQuestion/started" -> {
                val value = params.requiredObject("sideQuestion", method)
                // Core trims the question before echoing it; the generation stores the trimmed text it sent.
                if (value.requiredString("question", method) != generation.question) return
                val id = value.requiredString("id", method)
                if (generation.sideQuestionId == null) generation.sideQuestionId = id
            }
            "thread/sideQuestion/delta" -> {
                if (params.requiredString("sideQuestionId", method) != generation.sideQuestionId) return
                val delta = params.stringOrNull("delta") ?: params.stringOrNull("deltaText") ?: return
                generation.answer.append(delta)
            }
            "thread/sideQuestion/completed" -> {
                val value = params.requiredObject("sideQuestion", method)
                if (value.requiredString("id", method) != generation.sideQuestionId) return
                when (value.requiredString("status", method)) {
                    "completed" -> {
                        val text = generation.answer.toString()
                        if (text.isBlank()) generation.outcome.completeExceptionally(CodemError.Validation(EMPTY))
                        else generation.outcome.complete(text)
                    }
                    "interrupted" -> generation.outcome.completeExceptionally(CodemError.Cancelled(CANCELLED))
                    "failed" -> generation.outcome.completeExceptionally(CodemError.Validation(FAILED))
                    else -> throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM side question terminal status")
                }
            }
        }
    }

    fun release(generation: Active) {
        if (active === generation) active = null
    }

    /** The connection or thread went away: the question cannot finish on it any more. */
    fun clear() {
        active?.outcome?.completeExceptionally(CodemError.Cancelled(INTERRUPTED))
        active = null
    }

    companion object {
        const val BUSY = "CodeM 正在生成，请等待这次生成结束后重试。"
        const val EMPTY = "CodeM 模型没有返回可用内容，请重试。"
        const val CANCELLED = "CodeM 生成已取消。"
        const val FAILED = "CodeM 生成失败，请重试。"
        const val TIMED_OUT = "CodeM 生成等待超过 45 秒，已取消。"
        const val INTERRUPTED = "CodeM 连接或会话已变化，生成已取消。"
        const val NOT_READY = "CodeM 未连接或正忙，请连接后等待当前任务结束再生成。"
    }
}
