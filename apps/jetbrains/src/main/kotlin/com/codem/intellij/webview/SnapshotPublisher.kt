package com.codem.intellij.webview

import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * The single, ordered owner of what the page is shown.
 *
 * Callers on any thread (Core reader, pool, watchdog, EDT) change their own state and then ask for a publication.
 * Publications run one at a time on [executor], which must be serial and FIFO. Each one composes the view from the
 * latest state at that moment, never from a snapshot captured earlier on the caller's thread, and stamps it with the
 * next value of one monotonic version. An older view therefore cannot be delivered after a newer one, and the page
 * drops any snapshot below the last version it applied.
 *
 * Host-owned state (account, and the phase, notice and composer fields shown before a session exists) lives here.
 * [update] applies atomically and is visible at once through [local]; its publication follows asynchronously.
 */
class SnapshotPublisher(
    initialLocal: ChatSnapshot,
    private val executor: Executor,
    private val compose: (local: ChatSnapshot) -> ChatSnapshot,
    private val deliver: (ChatSnapshot) -> Unit,
    private val onError: (Throwable) -> Unit = {},
) {
    private val local = AtomicReference(initialLocal)
    private val refreshQueued = AtomicBoolean(false)
    @Volatile private var closed = false
    // Only read and written by publications, which the serial executor runs one at a time.
    private var version = 0L

    /** Host-owned state after every [update] that has returned. */
    fun local(): ChatSnapshot = local.get()

    /** The view the page would get now, for decisions. It is neither stamped nor delivered. */
    fun current(): ChatSnapshot = compose(local.get())

    /**
     * Changes host-owned state, then publishes with the same change applied over the composed view. A host change is
     * shown at once even while a session supplies the view; the session fields it overrides last until the next
     * publication.
     */
    fun update(change: (ChatSnapshot) -> ChatSnapshot) {
        local.updateAndGet(change)
        schedule { publish(change) }
    }

    /** Publishes the latest state with a one-off overlay, such as a transient notice. */
    fun show(overlay: (ChatSnapshot) -> ChatSnapshot) {
        schedule { publish(overlay) }
    }

    /** Publishes the latest state. A refresh that has not started yet already covers later requests. */
    fun refresh() {
        if (!refreshQueued.compareAndSet(false, true)) return
        val queued = schedule {
            refreshQueued.set(false)
            publish(null)
        }
        if (!queued) refreshQueued.set(false)
    }

    /** Stops publishing; queued publications are dropped. The executor stays with its owner. */
    fun close() {
        closed = true
    }

    private fun schedule(task: () -> Unit): Boolean {
        if (closed) return false
        return try {
            executor.execute(task)
            true
        } catch (_: RejectedExecutionException) {
            false
        }
    }

    private fun publish(overlay: ((ChatSnapshot) -> ChatSnapshot)?) {
        if (closed) return
        try {
            val composed = compose(local.get())
            val view = overlay?.invoke(composed) ?: composed
            version += 1
            deliver(view.copy(version = version))
        } catch (error: Throwable) {
            onError(error)
        }
    }
}
