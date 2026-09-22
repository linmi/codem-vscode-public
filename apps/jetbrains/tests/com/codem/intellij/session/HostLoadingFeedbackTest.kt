package com.codem.intellij.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HostLoadingFeedbackTest {
    @Test
    fun pendingStatesStayReadableAndTimeoutsStayShort() {
        assertTrue(HostLoadingFeedback.connectStillPending("connecting"))
        assertFalse(HostLoadingFeedback.connectStillPending("ready"))
        assertFalse(HostLoadingFeedback.connectStillPending("failed"))
        assertTrue(HostLoadingFeedback.ACCOUNT_MS <= 8_000)
        assertTrue(HostLoadingFeedback.CONNECT_MS <= 12_000)
        assertEquals("正在检查登录状态", HostLoadingFeedback.CHECKING)
        assertEquals("正在连接 CodeM…", HostLoadingFeedback.CONNECTING)
        assertTrue(HostLoadingFeedback.ACCOUNT_TIMEOUT.contains("重试"))
        assertTrue(HostLoadingFeedback.CONNECT_TIMEOUT.contains("重试"))
    }
}
