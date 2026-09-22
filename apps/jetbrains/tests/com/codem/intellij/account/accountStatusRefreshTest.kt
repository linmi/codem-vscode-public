package com.codem.intellij.account

import com.codem.intellij.webview.AccountView
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class AccountStatusRefreshTest {
    private var view = AccountView()
    private val states = mutableListOf<AccountView>()
    private val refresh = AccountStatusRefresh({ view }) { next -> view = next; states.add(next) }

    @Test
    fun successReleasesReadAndNextRefreshPerformsANewAttempt() {
        val first = requireNotNull(refresh.begin())
        assertNull(refresh.begin())
        assertEquals("checking", view.status)
        assertTrue(refresh.finish(first, AccountView(status = "signedIn")))
        val second = requireNotNull(refresh.begin())
        assertNotEquals(first, second)
        assertEquals("signedIn", view.status)
        assertTrue(view.refreshing)
        assertFalse(refresh.finish(first, AccountProjection.error("late timeout")))
        assertNull(refresh.begin())
        assertTrue(refresh.finish(second, AccountProjection.signedOut()))
        assertEquals("signedOut", view.status)
        assertNotNull(refresh.begin())
    }

    @Test
    fun failureAndTimeoutAllowRetryAndRejectLateResults() {
        for (failure in listOf("read failed", "read timeout")) {
            val first = requireNotNull(refresh.begin())
            assertTrue(refresh.finish(first, AccountProjection.error(failure)))
            assertEquals(failure, view.message)
            val retry = requireNotNull(refresh.begin())
            assertFalse(refresh.finish(first, AccountView(status = "signedIn")))
            assertEquals("checking", view.status)
            assertTrue(refresh.finish(retry, AccountProjection.signedOut()))
        }
    }

    @Test
    fun loginAndLogoutRevokeStatusResultsAndCloseRejectsNewReads() {
        val first = requireNotNull(refresh.begin())
        refresh.replace(AccountProjection.signingIn())
        assertNull(refresh.begin())
        assertFalse(refresh.finish(first, AccountProjection.signedOut()))
        assertEquals("signingIn", view.status)
        refresh.replace(AccountProjection.cancelled())
        val second = requireNotNull(refresh.begin())
        refresh.replace(AccountProjection.signedOut())
        assertFalse(refresh.finish(second, AccountView(status = "signedIn")))
        assertEquals("signedOut", view.status)
        val third = requireNotNull(refresh.begin())
        refresh.close()
        val last = view
        assertFalse(refresh.finish(third, AccountProjection.error("late error")))
        refresh.replace(AccountView(status = "signedIn"))
        assertNull(refresh.begin())
        assertEquals(last, view)
    }

    @Test
    fun completionAndTimeoutPublishExactlyOneTerminalState() {
        val attempt = requireNotNull(refresh.begin())
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val pending = listOf(AccountView(status = "signedIn"), AccountProjection.error("timeout")).map { account ->
                pool.submit<Boolean> { start.await(); refresh.finish(attempt, account) }
            }
            start.countDown()
            assertEquals(1, pending.count { it.get(2, TimeUnit.SECONDS) })
            assertEquals(2, states.size) // loading and exactly one terminal result
            assertNotNull(refresh.begin())
        } finally {
            pool.shutdownNow()
            assertTrue(pool.awaitTermination(2, TimeUnit.SECONDS))
        }
    }
}
