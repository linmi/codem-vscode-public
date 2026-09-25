package com.codem.intellij.session

import com.codem.intellij.contracts.ContractFixtures
import com.codem.intellij.core.CodemError
import com.codem.intellij.webview.BackgroundTaskView
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** contracts.test.ts runs the same `core/backgroundTaskWake.json` cases through parseAppServerBackgroundWake. */
class BackgroundTasksTest {
    @Test
    fun parsesWakesLikeTheNodeHost() {
        val cases = ContractFixtures.cases("core/backgroundTaskWake.json")
        assertTrue(cases.any { it.requiredObject("expected", "case").requiredString("kind", "expected") == "accepted" })
        assertTrue(cases.any { it.requiredObject("expected", "case").requiredString("kind", "expected") == "protocol-error" })
        for (case in cases) {
            val name = case.requiredString("name", "case")
            val method = case.requiredString("method", name)
            val params = case.requiredObject("params", name)
            val expected = case.requiredObject("expected", name)
            assertTrue(method in BackgroundTasks.wakeMethods, name)
            if (expected.requiredString("kind", name) == "accepted") {
                val want = BackgroundWake(expected.requiredString("turnId", name), expected.requiredString("phase", name), expected.requiredString("taskId", name))
                assertEquals(want, BackgroundTasks.parseWake(method, params), name)
                continue
            }
            assertEquals("invalid-frame", expected.requiredString("class", name), name)
            val error = assertThrows(CodemError.Protocol::class.java, { BackgroundTasks.parseWake(method, params) }, name)
            assertEquals(CodemError.Class.InvalidFrame, error.errorClass, name)
            val field = expected.requiredString("field", name)
            assertTrue(error.message.orEmpty().contains(field), "$name must name $field: ${error.message}")
        }
    }

    @Test
    fun aRepeatedTaskKeepsItsHandleAndLabelAndMovesLast() {
        val ids = ArrayDeque(listOf("h1", "h2"))
        val tasks = BackgroundTasks { ids.removeFirst() }
        tasks.wake("thread-1", BackgroundWake("turn-1", "queued", "task-1"))
        tasks.wake("thread-1", BackgroundWake("turn-1", "skipped", "task-2"))
        tasks.wake("thread-1", BackgroundWake("turn-1", "started", "task-1"))
        assertEquals(
            listOf(BackgroundTaskView("h2", "后台任务 2", "skipped"), BackgroundTaskView("h1", "后台任务 1", "started")),
            tasks.views("thread-1"),
        )
        assertEquals(emptyList<BackgroundTaskView>(), tasks.views("thread-2"))
    }

    @Test
    fun onlyTheOwningThreadCanCancelAHandle() {
        val tasks = BackgroundTasks { "h1" }
        tasks.wake("thread-1", BackgroundWake("turn-1", "queued", "task-1"))
        assertEquals("task-1", tasks.owned("h1", "thread-1").taskId)
        assertThrows(CodemError.Validation::class.java) { tasks.owned("h1", "thread-2") }
        assertThrows(CodemError.Validation::class.java) { tasks.owned("task-1", "thread-1") }
    }

    @Test
    fun aCancelResultIsDroppedWhenTheTaskIsGone() {
        val tasks = BackgroundTasks { "h1" }
        tasks.wake("thread-1", BackgroundWake("turn-1", "queued", "task-1"))
        val task = tasks.owned("h1", "thread-1")
        tasks.settle("h1", task, "cancelled")
        assertEquals(listOf(BackgroundTaskView("h1", "后台任务 1", "cancelled")), tasks.views("thread-1"))
        tasks.clear()
        tasks.settle("h1", task, "noop")
        assertEquals(emptyList<BackgroundTaskView>(), tasks.views("thread-1"))
    }

    @Test
    fun aWakeForAnotherThreadDropsTheOldThreadsTasks() {
        val ids = ArrayDeque(listOf("h1", "h2"))
        val tasks = BackgroundTasks { ids.removeFirst() }
        tasks.wake("thread-1", BackgroundWake("turn-1", "queued", "task-1"))
        tasks.wake("thread-2", BackgroundWake("turn-9", "queued", "task-9"))
        assertEquals(listOf(BackgroundTaskView("h2", "后台任务 1", "queued")), tasks.views("thread-2"))
        assertThrows(CodemError.Validation::class.java) { tasks.owned("h1", "thread-1") }
    }
}
