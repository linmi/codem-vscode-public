package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.webview.BackgroundTaskView
import java.util.UUID

/** One `backgroundTask/wake*` notification, read as parseAppServerBackgroundWake reads it. */
data class BackgroundWake(val turnId: String, val phase: String, val taskId: String)

/**
 * The background tasks Core woke in the current conversation, kept the way VS Code BackgroundTasks keeps them.
 * The view gets an opaque id, a label and a phase. Core's taskId and the owning thread stay here, so a cancel
 * sends the task's own taskId on its own thread and refuses a handle this conversation never received.
 * Not thread-safe: ProjectSession calls it under its lock.
 */
class BackgroundTasks(private val newId: () -> String = { UUID.randomUUID().toString() }) {
    class Task internal constructor(val threadId: String, val taskId: String, val label: String, val phase: String)

    private val tasks = linkedMapOf<String, Task>()

    /** A repeated taskId keeps its handle and label and moves last. Tasks of any other thread are dropped. */
    fun wake(threadId: String, wake: BackgroundWake) {
        tasks.entries.removeIf { it.value.threadId != threadId }
        val previous = tasks.entries.firstOrNull { it.value.taskId == wake.taskId }
        val id = previous?.key ?: newId()
        val label = previous?.value?.label ?: "后台任务 ${tasks.size + 1}"
        tasks.remove(id)
        tasks[id] = Task(threadId, wake.taskId, label, wake.phase)
    }

    /** The task behind a view handle, only while it belongs to [threadId]. */
    fun owned(id: String, threadId: String): Task {
        val task = tasks[id] ?: throw CodemError.Validation("CodeM background task is not in this conversation")
        if (task.threadId != threadId) throw CodemError.Validation("CodeM background task belongs to another conversation")
        return task
    }

    /** Records Core's cancel status, unless the task was dropped while the request ran. */
    fun settle(id: String, task: Task, status: String) {
        val current = tasks[id] ?: return
        if (current.threadId != task.threadId || current.taskId != task.taskId) return
        tasks[id] = Task(current.threadId, current.taskId, current.label, status)
    }

    fun views(threadId: String?): List<BackgroundTaskView> =
        tasks.filterValues { it.threadId == threadId }.map { (id, task) -> BackgroundTaskView(id, task.label, task.phase) }

    fun clear() = tasks.clear()

    companion object {
        private val phases = mapOf(
            "backgroundTask/wakeQueued" to "queued",
            "backgroundTask/wakeStarted" to "started",
            "backgroundTask/wakeSkipped" to "skipped",
        )

        val wakeMethods: Set<String> = phases.keys

        /** As parseAppServerBackgroundWake: the method decides the phase, and turnId and taskId are non-blank strings. */
        fun parseWake(method: String, params: JsonValue.ObjectValue): BackgroundWake {
            val phase = phases[method] ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM $method is not a background wake")
            return BackgroundWake(nonBlank(params, "turnId", method), phase, nonBlank(params, "taskId", method))
        }

        private fun nonBlank(params: JsonValue.ObjectValue, key: String, method: String): String =
            params.requiredString(key, method).takeIf { it.isNotBlank() }
                ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM $method.$key must be non-empty")
    }
}
