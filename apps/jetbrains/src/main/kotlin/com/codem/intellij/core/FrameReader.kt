package com.codem.intellij.core

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/**
 * 按 UTF-8 分块解析 stdout。一次 read 可能是半行或多行粘连，不能假设一帧。
 * 超限明确失败，禁止截断协议帧后继续。
 */
class FrameReader(
    private val maxBufferBytes: Int = 8 * 1024 * 1024,
) {
    private val buffer = StringBuilder()
    private var bufferedBytes = 0
    private val decoder = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)

    fun push(chunk: ByteArray, length: Int = chunk.size): List<String> {
        if (length == 0) return emptyList()
        val text = try {
            decoder.decode(ByteBuffer.wrap(chunk, 0, length)).toString()
        } catch (error: CharacterCodingException) {
            throw CodemError.Protocol(CodemError.Class.InvalidJson, "CodeM stdout was not valid UTF-8", error)
        }
        bufferedBytes += length
        if (bufferedBytes > maxBufferBytes) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM stdout exceeded $maxBufferBytes bytes before a complete frame")
        }
        buffer.append(text)
        val frames = mutableListOf<String>()
        while (true) {
            val newline = buffer.indexOf("\n")
            if (newline < 0) break
            val line = buffer.substring(0, newline).trimEnd('\r')
            buffer.delete(0, newline + 1)
            if (line.isNotEmpty()) frames += line
        }
        bufferedBytes = buffer.toString().toByteArray(StandardCharsets.UTF_8).size
        return frames
    }

    fun leftover(): String = buffer.toString()
}
