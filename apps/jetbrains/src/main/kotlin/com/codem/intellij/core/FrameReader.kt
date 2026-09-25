package com.codem.intellij.core

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/**
 * 按字节切分 stdout 后逐帧严格解码 UTF-8。一次 read 可能是半行、多行粘连或截断在多字节字符中间；
 * 0x0A 不会出现在 UTF-8 多字节序列内，所以只解码完整行。单帧超限明确失败，禁止截断协议帧后继续。
 */
class FrameReader(
    private val maxBufferBytes: Int = 8 * 1024 * 1024,
) {
    private var pending = EMPTY
    private var pendingBytes = 0
    private val decoder = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)

    fun push(chunk: ByteArray, length: Int = chunk.size): List<String> {
        require(length in 0..chunk.size) { "FrameReader length $length is outside chunk of ${chunk.size} bytes" }
        val frames = mutableListOf<String>()
        var start = 0
        for (index in 0 until length) {
            if (chunk[index] != NEWLINE) continue
            val line = if (pendingBytes == 0) {
                checkFrameSize(index - start)
                decode(chunk, start, index - start)
            } else {
                append(chunk, start, index - start)
                decode(pending, 0, pendingBytes).also { releasePending() }
            }.trimEnd('\r')
            if (line.isNotEmpty()) frames += line
            start = index + 1
        }
        append(chunk, start, length - start)
        return frames
    }

    /** 尚未收到换行的半帧；末尾被截断的多字节字符显示为 U+FFFD，仅供诊断。 */
    fun leftover(): String = String(pending, 0, pendingBytes, StandardCharsets.UTF_8)

    private fun append(bytes: ByteArray, offset: Int, length: Int) {
        if (length == 0) return
        val size = pendingBytes + length
        checkFrameSize(size)
        if (size > pending.size) pending = pending.copyOf(maxOf(size, minOf(maxOf(pending.size * 2, INITIAL_CAPACITY), maxBufferBytes)))
        bytes.copyInto(pending, pendingBytes, offset, offset + length)
        pendingBytes = size
    }

    private fun releasePending() {
        pendingBytes = 0
        if (pending.size > RETAINED_CAPACITY) pending = EMPTY
    }

    private fun checkFrameSize(bytes: Int) {
        if (bytes > maxBufferBytes) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM stdout exceeded $maxBufferBytes bytes before a complete frame")
        }
    }

    private fun decode(bytes: ByteArray, offset: Int, length: Int): String = try {
        decoder.decode(ByteBuffer.wrap(bytes, offset, length)).toString()
    } catch (error: CharacterCodingException) {
        throw CodemError.Protocol(CodemError.Class.InvalidJson, "CodeM stdout was not valid UTF-8", error)
    }

    private companion object {
        const val NEWLINE = '\n'.code.toByte()
        const val INITIAL_CAPACITY = 8 * 1024
        const val RETAINED_CAPACITY = 64 * 1024
        val EMPTY = ByteArray(0)
    }
}
