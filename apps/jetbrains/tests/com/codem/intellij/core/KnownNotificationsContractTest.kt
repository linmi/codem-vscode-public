package com.codem.intellij.core

import com.codem.intellij.contracts.ContractFixtures
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

/**
 * `core/knownNotifications.json` 由 TypeScript 测试与 `APP_SERVER_KNOWN_NOTIFICATIONS` 逐项比对；
 * 这里再与 Kotlin 副本逐项比对，三处任何一处漂移都会失败。
 */
class KnownNotificationsContractTest {
    @Test
    fun matchesTheSharedKnownNotificationSample() {
        val sample = ContractFixtures.json("core/knownNotifications.json")
        val methods = sample.required("methods").asArray().items.map { it.asText() }
        assertEquals(methods.size, methods.toSet().size, "knownNotifications.json lists a method twice")
        assertEquals(methods, KnownNotifications.methods.toList())
    }

    @Test
    fun treatsMethodsOutsideTheSampleAsUnknown() {
        val sample = ContractFixtures.json("core/knownNotifications.json")
        val expected = sample.required("expected").required("unknownMethod").asObject()
        assertEquals("unknown-notification", expected.required("class").asText())
        assertFalse(KnownNotifications.isKnown("item/unknown/noise"))
        assertFalse(KnownNotifications.isKnown(""))
    }
}
