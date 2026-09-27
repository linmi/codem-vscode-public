package com.codem.intellij.ide

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

class KeepAwakeTest {
    @Test
    fun eachPlatformInhibitorEndsWithTheIde() {
        assertEquals(listOf("caffeinate", "-i", "-w", "42"), Inhibitors.command("Mac OS X", 42))
        val linux = Inhibitors.command("Linux", 42)!!
        assertEquals("systemd-inhibit", linux.first())
        assertTrue("--pid=42" in linux)
        assertTrue(Inhibitors.command("Windows 11", 42)!!.last().endsWith("Wait-Process -Id 42"))
        assertNull(Inhibitors.command("SunOS", 42))
    }

    @Test
    fun togglingStartsAndStopsOneInhibitor() {
        val events = Events()
        val started = CopyOnWriteArrayList<Process>()
        val keepAwake = KeepAwake(listOf("sleep", "30"), events::publish, events::failed, start = { args ->
            ProcessBuilder(args).start().also { started += it }
        })
        keepAwake.toggle()
        assertTrue(keepAwake.on)
        keepAwake.enable()
        assertEquals(1, started.size, "Enabling twice keeps one process")
        keepAwake.toggle()
        assertFalse(keepAwake.on)
        assertTrue(started.single().waitFor(5, TimeUnit.SECONDS), "Disabling ends the process")
        assertEquals(listOf(true, false), events.published)
        assertTrue(events.failures.isEmpty(), "A stopped inhibitor exiting afterwards is not a failure")
    }

    @Test
    fun anInhibitorThatStopsOnItsOwnTurnsKeepAwakeOffAndSaysWhy() {
        val events = Events()
        val keepAwake = KeepAwake(listOf("sh", "-c", "exit 3"), events::publish, events::failed)
        keepAwake.enable()
        events.awaitFailure()
        assertFalse(keepAwake.on)
        assertEquals(listOf(true, false), events.published)
        assertEquals(listOf("防休眠已停止：sh 退出码 3。"), events.failures)
    }

    @Test
    fun aMissingOrUnsupportedInhibitorIsReportedAndStaysOff() {
        val events = Events()
        KeepAwake(listOf("codem-no-such-inhibitor"), events::publish, events::failed).enable()
        assertEquals(listOf("无法开启防休眠：未找到 codem-no-such-inhibitor。"), events.failures)
        val unsupported = KeepAwake(null, events::publish, events::failed)
        unsupported.toggle()
        assertFalse(unsupported.on)
        assertFalse(unsupported.supported)
        assertEquals("当前系统不支持防休眠。", events.failures.last())
        assertTrue(events.published.isEmpty())
    }

    private class Events {
        val published = CopyOnWriteArrayList<Boolean>()
        val failures = CopyOnWriteArrayList<String>()
        fun publish(on: Boolean) { published += on }
        fun failed(message: String) { failures += message }
        fun awaitFailure() {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (failures.isEmpty() && System.nanoTime() < deadline) Thread.onSpinWait()
        }
    }
}
