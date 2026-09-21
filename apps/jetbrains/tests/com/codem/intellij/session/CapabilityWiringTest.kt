package com.codem.intellij.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CapabilityWiringTest {
    @Test
    fun cycle3PriorityCapabilitiesAreDomainAndUiWired() {
        val expected = listOf(
            "A03", "A08", "A09", "A10", "A11",
            "B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", "B11", "B12", "B13", "B14",
        )
        for (id in expected) {
            val entry = CapabilityWiring.entry(id)
            assertEquals(CapabilityWiring.Status.DomainWired, entry.domain, id)
            assertEquals(CapabilityWiring.Status.UiWired, entry.ui, id)
        }
        assertTrue(CapabilityWiring.entry("B03").note.contains("warning"))
        assertEquals(CapabilityWiring.Status.OutOfScope, CapabilityWiring.entry("C01").domain)
    }
}
