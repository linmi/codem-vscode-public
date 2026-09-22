package com.codem.intellij.session

import com.codem.intellij.core.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class FileDiffProjectionTest {
    private val body = """{"tool_call_id":"call","background_task_id":null,"path":"sample.txt","change_type":"modified","is_binary":false,"truncated":false,"stats":{"lines_added":1,"lines_removed":1},"raw_unified":null,"hunks":[{"old_start":1,"old_count":2,"new_start":1,"new_count":2,"lines":[{"kind":"context","old_line":1,"new_line":1,"text":"  kept"},{"kind":"delete","old_line":2,"new_line":null,"text":"before"},{"kind":"insert","old_line":null,"new_line":2,"text":"after"}]}]}"""
    private fun frame(delta: String = body, sequence: Int = 0, complete: Boolean = true, call: String = "call") = JsonValue.obj(
        "itemId" to JsonValue.Text("item"), "callId" to JsonValue.Text(call),
        "encoding" to JsonValue.Text("json"), "delta" to JsonValue.Text(delta),
        "sequence" to JsonValue.NumberValue(sequence.toDouble(), sequence.toString()), "complete" to JsonValue.Bool(complete),
    )

    @Test
    fun splitFramesPreserveTextAndRejectReplay() {
        val assembler = FileDiffAssembler()
        val half = body.length / 2
        assertNull(assembler.accept(frame(body.take(half), complete = false)))
        val content = assembler.accept(frame(body.drop(half), 1))!!
        assertEquals("complete", content.preview)
        assertEquals("  kept\nbefore" to "  kept\nafter", content.texts())
        assertThrows(CodemError.Protocol::class.java) { assembler.accept(frame()) }
    }

    @Test
    fun partialBinaryAndOmittedDoNotPretendToBeCompleteText() {
        val partial = body.replace("\"truncated\":false", "\"truncated\":true").replace("\"lines_added\":1", "\"lines_added\":5")
        assertEquals("partial", FileDiffAssembler().accept(frame(partial))!!.preview)
        val omitted = partial.substringBefore("\"hunks\":") + "\"hunks\":[]}"
        assertEquals("omitted", FileDiffAssembler().accept(frame(omitted))!!.preview)
        assertNull(FileDiffAssembler().accept(frame(omitted))!!.texts())
        assertEquals("rawPartial", FileDiffAssembler().accept(frame(omitted.replace("\"raw_unified\":null", "\"raw_unified\":\"raw diff\"")))!!.preview)
        val binary = omitted.replace("\"is_binary\":false", "\"is_binary\":true")
        assertEquals("binary", FileDiffAssembler().accept(frame(binary))!!.preview)
        assertNull(FileDiffAssembler().accept(frame(binary))!!.texts())
    }

    @Test
    fun malformedFieldsAndInconsistentHunksAreRejected() {
        val malformed = listOf(
            body.replace("\"tool_call_id\":\"call\"", "\"tool_call_id\":\"other\""),
            body.replace("\"background_task_id\":null", "\"background_task_id\":\"other\""),
            body.replace("\"is_binary\":false", "\"is_binary\":\"false\""),
            body.replace("\"is_binary\":false", "\"is_binary\":true"),
            body.replace("\"lines_added\":1", "\"lines_added\":1.5"),
            body.replace("\"lines_removed\":1", "\"lines_removed\":2"),
            body.replace("\"old_count\":2", "\"old_count\":3"),
            body.replace("\"old_start\":1", "\"old_start\":0"),
            body.replace("\"old_line\":2", "\"old_line\":3"),
            body.replace("\"new_line\":null", "\"new_line\":2"),
            body.replace("\"text\":\"after\"", "\"text\":null"),
            body.replace("\"change_type\":\"modified\"", "\"change_type\":\"unknown\""),
            "{broken",
        )
        malformed.forEachIndexed { index, invalid ->
            assertThrows(CodemError.Protocol::class.java, { FileDiffAssembler().accept(frame(invalid)) }, "Malformed case $index")
        }
    }

    @Test
    fun sequencesIdentityAndBufferLimitAreEnforced() {
        assertThrows(CodemError.Protocol::class.java) { FileDiffAssembler().accept(frame(sequence = 1)) }
        val assembler = FileDiffAssembler()
        assembler.accept(frame("", complete = false))
        assertThrows(CodemError.Protocol::class.java) { assembler.accept(frame(sequence = 1, call = "other")) }
        assertThrows(CodemError.Protocol::class.java) { FileDiffAssembler(10).accept(frame()) }
        val fractional = frame().copy(fields = frame().fields + ("sequence" to JsonValue.NumberValue(0.5, "0.5")))
        assertThrows(CodemError.Protocol::class.java) { FileDiffAssembler().accept(fractional) }
    }
}
