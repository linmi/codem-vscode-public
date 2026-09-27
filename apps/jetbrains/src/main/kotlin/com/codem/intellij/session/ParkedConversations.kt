package com.codem.intellij.session

import com.codem.intellij.core.JsonValue
import com.codem.intellij.webview.LiveSessionView
import java.util.concurrent.CompletableFuture

/** A turn the chat handed to the background. Core keeps running it; this records what the chat needs to take it back. */
data class ParkedTurn(
    val threadId: String,
    val title: String,
    /** The settings the thread is subscribed with; a running thread keeps them when it returns. */
    val settings: ThreadSettings,
    val turnId: String,
    val submissionId: String?,
)

/** What the chat receives when it takes a parked thread back into the foreground. */
data class ReclaimedTurn(
    val settings: ThreadSettings,
    /** Null once the turn has ended: the chat reads the result from Core's history. */
    val turnId: String?,
    val submissionId: String?,
    /** Still subscribed on this connection, so the chat must not resume it again. */
    val subscribed: Boolean,
)

/**
 * Conversations left running when the chat switched to another thread, ported from the VS Code
 * `parkedConversations.ts`. Owns their subscriptions until the turn ends (then asks for a release) or the chat takes
 * them back; never projects their messages, which Core records. Their open requests stay with [InteractionRouter].
 *
 * Not thread-safe: [ProjectSession] calls it under its lock and runs every release RPC outside the lock.
 */
class ParkedConversations {
    private class Entry(
        val threadId: String,
        val title: String,
        val settings: ThreadSettings,
        var turnId: String,
        var submissionId: String?,
        var status: String,
    ) {
        /** The chat is restoring this thread; it will own the subscription, so an ended turn is not released here. */
        var claimed = false
        var subscribed = true
        /** The unsubscribe that follows an ended turn; a restore waits for it so it never resumes a thread being released. */
        var releasing: CompletableFuture<Void>? = null
        val running get() = status == RUNNING
    }

    private val entries = linkedMapOf<String, Entry>()

    fun has(threadId: String): Boolean = threadId in entries

    /** A background turn would be interrupted by closing the connection. */
    fun running(): Boolean = entries.values.any { it.running }

    /** Requests of a background turn are kept for its return; ended ones have nothing left to ask. */
    fun accepts(threadId: String): Boolean = entries[threadId]?.running == true

    /** Returns the thread to release when the turn had already ended by the time it was parked. */
    fun park(turn: ParkedTurn, ended: String? = null): String? {
        entries.remove(turn.threadId)
        val entry = Entry(turn.threadId, turn.title, turn.settings, turn.turnId, turn.submissionId, ended?.let(::endedStatus) ?: RUNNING)
        entries[turn.threadId] = entry
        return if (entry.running) null else endedLocked(entry)
    }

    /**
     * Marks a thread as being restored and returns the release in flight, if any, for the caller to wait on outside
     * the lock. Null when the thread is not parked.
     */
    fun claim(threadId: String): Claim? {
        val entry = entries[threadId] ?: return null
        entry.claimed = true
        return Claim(entry.releasing)
    }

    class Claim(val releasing: CompletableFuture<Void>?)

    /** The restore failed: the thread stays parked, and an ended turn is released as if it had never been claimed. */
    fun unclaim(threadId: String): String? {
        val entry = entries[threadId]?.takeIf { it.claimed } ?: return null
        entry.claimed = false
        return if (entry.running) null else endedLocked(entry)
    }

    /** The chat now owns the thread and its subscription. */
    fun take(threadId: String): ReclaimedTurn? = preview(threadId)?.also { entries.remove(threadId) }

    /** What [take] would hand over now, without handing it over; decides whether the thread must be resumed. */
    fun preview(threadId: String): ReclaimedTurn? {
        val entry = entries[threadId] ?: return null
        return ReclaimedTurn(
            settings = entry.settings,
            turnId = entry.turnId.takeIf { entry.running },
            submissionId = entry.submissionId,
            subscribed = entry.subscribed && entry.releasing == null,
        )
    }

    /**
     * Consumes every event of a parked thread. [handled] is false for events the chat handles itself; [release] names
     * a thread whose turn ended and must now be unsubscribed; [revoke] names a thread whose open requests are over.
     */
    fun apply(method: String, params: JsonValue.ObjectValue): Outcome {
        val threadId = params.stringOrNull("threadId") ?: return Outcome.IGNORED
        val entry = entries[threadId] ?: return Outcome.IGNORED
        when (method) {
            "turn/started" -> if (!entry.running && entry.subscribed && entry.releasing == null) {
                // Core woke the thread before the release; it keeps running here until it ends again.
                turnIdOf(params)?.let { entry.turnId = it }
                entry.submissionId = null
                entry.status = RUNNING
            }
            "turn/completed" -> if (entry.running && turnIdOf(params) == entry.turnId) {
                val status = params.objectOrNull("turn")?.stringOrNull("status") ?: params.stringOrNull("status")
                entry.status = endedStatus(status)
                val release = if (entry.claimed) null else endedLocked(entry)
                return Outcome(true, release, threadId)
            }
            "thread/closed", "thread/archived", "thread/deleted" -> {
                // Archived, deleted or dropped by Core: nothing is left to take back. A close that follows our own
                // release keeps the ended conversation listed until it is viewed.
                val ownRelease = method == "thread/closed" && (entry.releasing != null || !entry.subscribed)
                if (!ownRelease) entries.remove(threadId)
                return Outcome(true, null, threadId)
            }
        }
        return Outcome.HANDLED
    }

    data class Outcome(val handled: Boolean, val release: String? = null, val revoke: String? = null) {
        companion object {
            val IGNORED = Outcome(false)
            val HANDLED = Outcome(true)
        }
    }

    /** Records the release the session started for [threadId]; returns false when it is no longer ours to release. */
    fun releasing(threadId: String, future: CompletableFuture<Void>): Boolean {
        val entry = entries[threadId]?.takeIf { !it.claimed && !it.running && it.subscribed && it.releasing == null } ?: return false
        entry.releasing = future
        return true
    }

    /** The release finished; a successful one leaves the thread unsubscribed. */
    fun released(threadId: String, future: CompletableFuture<Void>, unsubscribed: Boolean) {
        val entry = entries[threadId]?.takeIf { it.releasing === future } ?: return
        entry.releasing = null
        if (unsubscribed) entry.subscribed = false
    }

    /** The connection is gone; Core ended every parked turn with it. */
    fun clear() = entries.clear()

    /** Newest first, as the VS Code list. */
    fun views(awaiting: (String) -> Boolean): List<LiveSessionView> =
        entries.values.reversed().map { entry ->
            val status = if (entry.running && awaiting(entry.threadId)) "awaitingApproval" else entry.status
            LiveSessionView(entry.threadId, entry.title, status)
        }

    /** Ended conversations stay listed until viewed; the oldest beyond the limit are dropped. */
    private fun endedLocked(entry: Entry): String? {
        val ended = entries.values.filter { !it.running && !it.claimed }
        for (item in ended.take((ended.size - MAX_ENDED).coerceAtLeast(0))) {
            if (item !== entry) entries.remove(item.threadId)
        }
        return entry.threadId.takeIf { entry.subscribed && entry.releasing == null }
    }

    private fun turnIdOf(params: JsonValue.ObjectValue): String? =
        params.objectOrNull("turn")?.stringOrNull("id") ?: params.stringOrNull("turnId")

    companion object {
        const val MAX_ENDED = 10
        private const val RUNNING = "running"

        /** Core's terminal status as the list shows it; anything not completed or interrupted counts as failed. */
        fun endedStatus(status: String?): String = when (status) {
            "completed" -> "completed"
            "interrupted" -> "stopped"
            else -> "failed"
        }
    }
}
