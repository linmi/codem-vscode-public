package com.codem.intellij.session

import com.codem.intellij.core.JsonValue
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CompletableFuture

class ParkedConversationsTest {
    private fun turn(id: String) = ParkedTurn(id, "title $id", ThreadSettings(), "turn-$id", "req-$id")

    private fun completed(id: String, status: String = "completed") = JsonValue.obj(
        "threadId" to JsonValue.Text(id),
        "turn" to JsonValue.obj("id" to JsonValue.Text("turn-$id"), "status" to JsonValue.Text(status)),
    )

    @Test
    fun anEndedTurnAsksForItsReleaseAndStaysListedUntilViewed() {
        val parked = ParkedConversations()
        assertNull(parked.park(turn("a")))
        assertTrue(parked.accepts("a"))
        val outcome = parked.apply("turn/completed", completed("a", "interrupted"))
        assertEquals("a", outcome.release)
        assertEquals("a", outcome.revoke)
        assertFalse(parked.running())
        assertFalse(parked.accepts("a"), "An ended turn has no requests left to keep")
        assertEquals(listOf("stopped"), parked.views { false }.map { it.status })
        val release = CompletableFuture<Void>()
        assertTrue(parked.releasing("a", release))
        parked.apply("thread/closed", JsonValue.obj("threadId" to JsonValue.Text("a")))
        assertTrue(parked.has("a"), "The close that follows our own release keeps the entry")
        parked.released("a", release, unsubscribed = true)
        assertEquals(false, parked.take("a")!!.subscribed)
    }

    @Test
    fun aClaimedTurnIsNotReleasedUntilTheRestoreGivesUp() {
        val parked = ParkedConversations()
        parked.park(turn("a"))
        assertNull(parked.claim("a")!!.releasing)
        assertNull(parked.apply("turn/completed", completed("a")).release, "The restore owns the subscription")
        assertEquals("a", parked.unclaim("a"))
        assertNull(parked.claim("missing"))
    }

    @Test
    fun aRunningTurnHandsOverItsTurnAndAwaitingApprovalComesFromOpenRequests() {
        val parked = ParkedConversations()
        parked.park(turn("a"))
        parked.park(turn("b"))
        assertEquals(listOf("b" to "running", "a" to "awaitingApproval"), parked.views { it == "a" }.map { it.id to it.status })
        val taken = parked.take("a")!!
        assertEquals("turn-a", taken.turnId)
        assertEquals("req-a", taken.submissionId)
        assertTrue(taken.subscribed)
        assertFalse(parked.has("a"))
    }

    @Test
    fun archivedThreadsLeaveAndOnlyTheNewestEndedOnesAreKept() {
        val parked = ParkedConversations()
        parked.park(turn("gone"))
        parked.apply("thread/archived", JsonValue.obj("threadId" to JsonValue.Text("gone")))
        assertFalse(parked.has("gone"))
        repeat(ParkedConversations.MAX_ENDED + 2) { index -> parked.park(turn("t$index"), ended = "completed") }
        assertEquals(ParkedConversations.MAX_ENDED, parked.views { false }.size)
        assertFalse(parked.has("t0"))
        assertTrue(parked.has("t${ParkedConversations.MAX_ENDED + 1}"))
    }
}
