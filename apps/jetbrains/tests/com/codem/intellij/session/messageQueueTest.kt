package com.codem.intellij.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MessageQueueTest {
    @Test
    fun messagesLeaveInOrderAndEditsAndRemovalsApply() {
        val queue = MessageQueue()
        assertTrue(queue.add("t1", "first"))
        assertTrue(queue.add("t1", "second"))
        assertTrue(queue.add("t1", "third"))
        val (first, second, third) = queue.view("t1").items
        assertTrue(queue.edit(second.id, "second!"))
        assertFalse(queue.edit(second.id, "   "), "An edit must keep text")
        assertTrue(queue.remove(third.id))
        assertEquals(first, queue.next("t1"))
        assertEquals("second!", queue.next("t1")?.text)
        assertNull(queue.next("t1"))
    }

    @Test
    fun aPausedQueueSendsNothingUntilResumed() {
        val queue = MessageQueue()
        queue.add("t1", "later")
        queue.pause()
        assertTrue(queue.view("t1").paused)
        assertNull(queue.next("t1"))
        queue.resume()
        assertEquals("later", queue.next("t1")?.text)
        queue.pause()
        assertFalse(queue.view("t1").paused, "An empty queue has nothing to pause")
    }

    @Test
    fun anotherThreadDropsTheQueueAndCannotTakeFromIt() {
        val queue = MessageQueue()
        queue.add("t1", "for t1")
        assertNull(queue.next("t2"))
        assertEquals(com.codem.intellij.webview.MessageQueueView(), queue.view("t2"))
        queue.follow("t2")
        queue.follow("t1")
        assertTrue(queue.view("t1").items.isEmpty(), "Following another thread dropped the queue")
    }

    @Test
    fun aRefusedDispatchReturnsToTheHeadPausedAndTheQueueIsBounded() {
        val queue = MessageQueue()
        queue.add("t1", "a")
        queue.add("t1", "b")
        val head = queue.next("t1")!!
        queue.restore("t1", head)
        assertEquals(listOf("a", "b"), queue.view("t1").items.map { it.text })
        assertTrue(queue.view("t1").paused)
        queue.restore("t2", head)
        assertEquals(2, queue.view("t1").items.size, "A stale thread cannot restore into this queue")
        repeat(18) { assertTrue(queue.add("t1", "m$it")) }
        assertFalse(queue.add("t1", "one too many"))
        assertFalse(queue.add("t1", "x".repeat(32_001)))
    }
}
