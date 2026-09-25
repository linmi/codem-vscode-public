package com.codem.intellij.webview

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class SnapshotPublisherTest {
    /** Core reader, pool, watchdog and EDT all publish at once: delivered versions only move forward, and so does state. */
    @Test
    fun concurrentPublicationsNeverGoBackwards() {
        val source = AtomicLong(0)
        val delivered = CopyOnWriteArrayList<ChatSnapshot>()
        val executor = Executors.newSingleThreadExecutor()
        val publisher = SnapshotPublisher(
            initialLocal = initialSnapshot(),
            executor = executor,
            compose = { local -> local.copy(notice = source.get().toString()) },
            deliver = { delivered += it },
        )
        val start = CountDownLatch(1)
        val threads = (0 until 8).map { worker ->
            Thread {
                start.await()
                repeat(400) { index ->
                    source.incrementAndGet()
                    when ((worker + index) % 3) {
                        0 -> publisher.refresh()
                        1 -> publisher.show { it.copy(canRetry = true) }
                        else -> publisher.update { it.copy(sendKey = if (index % 2 == 0) "enter" else "modEnter") }
                    }
                }
            }.apply { start() }
        }
        start.countDown()
        threads.forEach { it.join(10_000) }
        executor.shutdown()
        assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS))

        val versions = delivered.map { it.version }
        assertEquals((1L..versions.size.toLong()).toList(), versions, "every publication takes the next version")
        val states = delivered.map { it.notice!!.toLong() }
        assertEquals(states.sorted(), states, "a publication never shows older state than the one before it")
        assertEquals(source.get(), states.last(), "the last publication shows the latest state")
    }

    /**
     * The reported overwrite: a pool thread asks to show a notice while the turn is still running, then the Core
     * reader completes the turn before that publication runs. The notice is composed when it is published, so it
     * cannot bring the running turn back over turn/completed.
     */
    @Test
    fun staleCaptureCannotOverwriteACompletedTurn() {
        val executor = ManualExecutor()
        var phase = "running"
        val delivered = mutableListOf<ChatSnapshot>()
        val publisher = SnapshotPublisher(
            initialLocal = initialSnapshot(),
            executor = executor,
            compose = { local -> local.copy(phase = phase) },
            deliver = { delivered += it },
        )

        publisher.show { it.copy(notice = "CodeM action failed") }
        phase = "ready"
        publisher.refresh()
        executor.runAll()

        assertEquals(listOf(1L, 2L), delivered.map { it.version })
        assertEquals(listOf("ready", "ready"), delivered.map { it.phase })
        assertEquals("CodeM action failed", delivered.first().notice)
    }

    @Test
    fun hostUpdatesAreVisibleAtOnceAndShownOverTheComposedView() {
        val executor = ManualExecutor()
        val delivered = mutableListOf<ChatSnapshot>()
        val publisher = SnapshotPublisher(
            initialLocal = initialSnapshot(),
            executor = executor,
            // A session supplies phase and notice; the host keeps its own phase underneath.
            compose = { local -> local.copy(phase = "running", notice = "session") },
            deliver = { delivered += it },
        )

        publisher.update { it.copy(phase = "failed", notice = "timed out", account = AccountView(status = "signedIn")) }
        assertEquals("failed", publisher.local().phase, "host state changes before the publication runs")
        assertEquals("signedIn", publisher.current().account.status)
        assertTrue(delivered.isEmpty())

        executor.runAll()
        assertEquals("failed", delivered.single().phase)
        assertEquals("timed out", delivered.single().notice)

        publisher.refresh()
        executor.runAll()
        assertEquals("running", delivered.last().phase, "the overlay lasts until the next publication")
    }

    @Test
    fun queuedRefreshesCoalesceButLaterChangesArePublished() {
        val executor = ManualExecutor()
        var state = 0
        val delivered = mutableListOf<ChatSnapshot>()
        val publisher = SnapshotPublisher(initialSnapshot(), executor, { it.copy(notice = state.toString()) }, { delivered += it })

        repeat(5) { state++; publisher.refresh() }
        executor.runAll()
        assertEquals(listOf("5"), delivered.map { it.notice })

        state++
        publisher.refresh()
        executor.runAll()
        assertEquals(listOf("5", "6"), delivered.map { it.notice })
    }

    @Test
    fun closedPublisherDeliversNothingAndToleratesAStoppedExecutor() {
        val executor = ManualExecutor()
        val delivered = mutableListOf<ChatSnapshot>()
        val errors = mutableListOf<Throwable>()
        val publisher = SnapshotPublisher(initialSnapshot(), executor, { it }, { delivered += it }, { errors += it })

        publisher.refresh()
        publisher.close()
        executor.runAll()
        publisher.update { it.copy(notice = "late") }
        publisher.show { it }
        executor.runAll()
        assertTrue(delivered.isEmpty())

        val stopped = Executors.newSingleThreadExecutor().apply { shutdown() }
        val open = SnapshotPublisher(initialSnapshot(), stopped, { it }, { delivered += it }, { errors += it })
        open.refresh()
        open.update { it.copy(notice = "after dispose") }
        assertEquals("after dispose", open.local().notice)
        assertTrue(delivered.isEmpty())
        assertTrue(errors.isEmpty())
    }

    @Test
    fun deliveryFailureIsReportedAndLaterPublicationsContinue() {
        val executor = ManualExecutor()
        val delivered = mutableListOf<ChatSnapshot>()
        val errors = mutableListOf<Throwable>()
        var fail = true
        val publisher = SnapshotPublisher(initialSnapshot(), executor, { it }, {
            if (fail) throw IllegalStateException("fixture page is gone")
            delivered += it
        }, { errors += it })

        publisher.refresh()
        executor.runAll()
        fail = false
        publisher.refresh()
        executor.runAll()
        assertEquals(1, errors.size)
        assertEquals(listOf(2L), delivered.map { it.version })
    }

    /** Serial FIFO executor whose tasks run only when the test says so, to force an interleaving. */
    private class ManualExecutor : Executor {
        private val tasks = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) { tasks.addLast(command) }
        fun runAll() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
    }
}
