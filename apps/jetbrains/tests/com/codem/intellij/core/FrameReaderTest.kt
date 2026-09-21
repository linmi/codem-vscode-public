package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class FrameReaderTest {
    @Test
    fun splitsHalfLinesAndStickyFrames() {
        val reader = FrameReader()
        assertTrue(reader.push("""{"id":1}""".toByteArray()).isEmpty())
        assertEquals(listOf("""{"id":1}""", """{"id":2}"""), reader.push("\n{\"id\":2}\n{\"id\":3".toByteArray()))
        assertEquals(listOf("""{"id":3}"""), reader.push("}\n".toByteArray()))
    }

    @Test
    fun failsInsteadOfTruncatingAnOversizedBuffer() {
        val reader = FrameReader(maxBufferBytes = 16)
        var failed = false
        try {
            reader.push("0123456789abcdef0123456789".toByteArray())
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.InvalidFrame
        }
        assertTrue(failed)
    }
}
