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
        assertFrameError(CodemError.Class.InvalidFrame) { reader.push("0123456789abcdef0123456789".toByteArray()) }
    }

    @Test
    fun decodesMultiByteCharactersSplitAtEveryByteOffset() {
        // 2-, 3- and 4-byte UTF-8 sequences, so every split lands inside some character.
        val frame = """{"text":"é中😀文"}"""
        val bytes = "$frame\n".toByteArray(Charsets.UTF_8)
        for (offset in 0..bytes.size) {
            val reader = FrameReader()
            val frames = reader.push(bytes.copyOfRange(0, offset)) + reader.push(bytes.copyOfRange(offset, bytes.size))
            assertEquals(listOf(frame), frames, "split at byte $offset")
        }
        val reader = FrameReader()
        assertEquals(listOf(frame), bytes.flatMap { reader.push(byteArrayOf(it)) }, "one byte per read")
    }

    @Test
    fun decodesCjkFrameLargerThanOneStdoutRead() {
        val frame = """{"text":"${"中文帧".repeat(4000)}"}"""
        val bytes = "$frame\n".toByteArray(Charsets.UTF_8)
        assertTrue(bytes.size > 3 * 8192)
        // Same shape as the stdout pump: one reused 8192-byte buffer, stale bytes past `length`.
        val reader = FrameReader()
        val buffer = ByteArray(8192) { 0xFF.toByte() }
        val frames = mutableListOf<String>()
        var position = 0
        while (position < bytes.size) {
            val read = minOf(buffer.size, bytes.size - position)
            bytes.copyInto(buffer, 0, position, position + read)
            frames += reader.push(buffer, read)
            position += read
        }
        assertEquals(listOf(frame), frames)
        assertEquals("", reader.leftover())
    }

    @Test
    fun returnsCompleteFramesAndKeepsPartialFrameFromOneChunk() {
        val reader = FrameReader()
        val partial = """{"id":3,"text":"尾"""
        val tail = "巴\"}\n"
        val tailBytes = tail.toByteArray(Charsets.UTF_8)
        val first = "{\"id\":1,\"text\":\"一\"}\r\n\n{\"id\":2,\"text\":\"二\"}\n$partial".toByteArray(Charsets.UTF_8) + tailBytes.copyOfRange(0, 1)
        assertEquals(listOf("""{"id":1,"text":"一"}""", """{"id":2,"text":"二"}"""), reader.push(first))
        assertEquals(partial + "�", reader.leftover())
        assertEquals(listOf(partial + tail.trimEnd('\n')), reader.push(tailBytes.copyOfRange(1, tailBytes.size)))
        assertEquals("", reader.leftover())
    }

    @Test
    fun rejectsMalformedUtf8() {
        val prefix = "{\"text\":\"".toByteArray()
        val lines = listOf(
            byteArrayOf(0xFF.toByte()),
            byteArrayOf(0xC3.toByte(), 0x28),
            byteArrayOf(0xC0.toByte(), 0xAF.toByte()),
            byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte()),
            byteArrayOf(0xE4.toByte(), 0xB8.toByte()),
        ).map { prefix + it + "\"}\n".toByteArray() } +
            listOf(prefix + byteArrayOf(0xE4.toByte(), 0xB8.toByte(), 0x0A))
        for (line in lines) {
            assertFrameError(CodemError.Class.InvalidJson) { FrameReader().push(line) }
            // A malformed sequence split across reads must still fail once its line completes.
            val reader = FrameReader()
            assertTrue(reader.push(line.copyOfRange(0, prefix.size + 1)).isEmpty())
            assertFrameError(CodemError.Class.InvalidJson) { reader.push(line.copyOfRange(prefix.size + 1, line.size)) }
        }
    }

    @Test
    fun limitsEachFrameAndReleasesBytesOnceItCompletes() {
        val reader = FrameReader(maxBufferBytes = 16)
        repeat(4) {
            assertTrue(reader.push("0123456789".toByteArray()).isEmpty())
            assertEquals(listOf("0123456789abcdef"), reader.push("abcdef\n".toByteArray()))
        }
        reader.push("0123456789".toByteArray())
        assertFrameError(CodemError.Class.InvalidFrame) { reader.push("abcdefg".toByteArray()) }
        assertFrameError(CodemError.Class.InvalidFrame) { FrameReader(maxBufferBytes = 16).push("0123456789abcdefg\n".toByteArray()) }
    }

    private fun assertFrameError(expected: CodemError.Class, block: () -> Unit) {
        val error = runCatching(block).exceptionOrNull()
        assertTrue(error is CodemError && error.errorClass == expected, "expected $expected, got $error")
    }
}
