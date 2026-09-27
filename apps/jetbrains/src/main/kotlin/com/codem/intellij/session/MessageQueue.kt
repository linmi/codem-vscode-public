package com.codem.intellij.session

import com.codem.intellij.webview.MessageQueueView
import com.codem.intellij.webview.QueuedMessageView
import java.util.UUID

/**
 * Messages typed while a turn runs, waiting to be sent as the next turns of the same thread. Port of VS Code
 * messageQueue.ts.
 *
 * Owns the queued text and whether it may dispatch. ProjectSession decides when a turn has ended and calls [next]; a
 * stopped or failed turn pauses the queue so nothing is sent without the user asking again. The queue belongs to one
 * Core thread: following another thread (switch, new chat, lost connection, sign-out) drops it, and nothing is
 * persisted beyond the IDE process. Every call runs under ProjectSession's lock.
 */
class MessageQueue {
    private var threadId: String? = null
    private var items = listOf<QueuedMessageView>()
    private var paused = false

    /** Drops the queue when the current thread is no longer the one it was built for. */
    fun follow(threadId: String?) {
        if (threadId == this.threadId) return
        this.threadId = threadId
        items = emptyList()
        paused = false
    }

    fun add(threadId: String, text: String): Boolean {
        follow(threadId)
        if (text.isBlank() || text.length > MAX_TEXT || items.size >= MAX_QUEUED_MESSAGES) return false
        items = items + QueuedMessageView(UUID.randomUUID().toString(), text)
        return true
    }

    fun edit(id: String, text: String): Boolean {
        if (text.isBlank() || text.length > MAX_TEXT || items.none { it.id == id }) return false
        items = items.map { if (it.id == id) it.copy(text = text) else it }
        return true
    }

    fun remove(id: String): Boolean {
        val before = items.size
        items = items.filter { it.id != id }
        if (items.isEmpty()) paused = false
        return items.size != before
    }

    /** A turn ended without completing: keep every message, send none until the user resumes. */
    fun pause() {
        if (items.isNotEmpty()) paused = true
    }

    fun resume() {
        paused = false
    }

    /** Removes and returns the head for dispatch; null while paused, empty, or bound to another thread. */
    fun next(threadId: String?): QueuedMessageView? {
        if (paused || threadId == null || threadId != this.threadId) return null
        val head = items.firstOrNull() ?: return null
        items = items.drop(1)
        return head
    }

    /** A dispatch that Core did not accept goes back to the head, paused, so it is neither lost nor retried. */
    fun restore(threadId: String?, item: QueuedMessageView) {
        if (threadId != this.threadId) return
        items = listOf(item) + items
        paused = true
    }

    fun view(threadId: String?): MessageQueueView =
        if (threadId != this.threadId) MessageQueueView() else MessageQueueView(items, paused)

    companion object {
        /** Enough to line up follow-ups without letting one run hoard unbounded prompt text. */
        const val MAX_QUEUED_MESSAGES = 20
        private const val MAX_TEXT = 32_000
    }
}
