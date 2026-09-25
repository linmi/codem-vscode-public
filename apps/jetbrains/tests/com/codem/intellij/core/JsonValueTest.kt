package com.codem.intellij.core

import com.codem.intellij.contracts.ContractFixtures
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList

/**
 * `core/jsonText.json` 的每个用例同时由 TypeScript 测试与 `JSON.parse` 比对；
 * 这里要求 Kotlin 解析得出同一结果（含对象键顺序），或以 InvalidJson 拒绝。
 */
class JsonValueTest {
    @Test
    fun agreesWithJsonParseOnEverySharedSample() {
        val cases = ContractFixtures.cases("core/jsonText.json")
        check(cases.isNotEmpty())
        for (case in cases) {
            val name = case.required("name").asText()
            val text = case.required("text").asText()
            val expected = case.required("expected").asObject()
            when (val kind = expected.required("kind").asText()) {
                "accepted" -> {
                    val parsed = JsonValue.parse(text)
                    assertSameJson(expected.required("value"), parsed, name)
                    assertSameJson(parsed, JsonValue.parse(encodeJson(parsed)), "$name round trip")
                }
                "protocol-error" -> {
                    assertEquals("invalid-json", expected.required("class").asText(), name)
                    assertInvalidJson(text, name)
                }
                else -> error("$name has unsupported expected kind $kind")
            }
        }
    }

    /** 重复键策略：与 JSON.parse 相同，后值覆盖前值，键保留首次出现的位置。 */
    @Test
    fun duplicateKeysKeepTheLastValueAtTheFirstPosition() {
        val parsed = JsonValue.parse("""{"a":1,"b":2,"a":3}""").asObject()
        assertEquals(listOf("a", "b"), parsed.fields.keys.toList())
        assertEquals("3", (parsed.required("a") as JsonValue.NumberValue).literal)
    }

    /** JSON.parse 会把它们读成 Infinity；Kotlin 无法把 Infinity 写回 JSON，所以拒绝。 */
    @Test
    fun rejectsNumbersOutsideTheDoubleRange() {
        for (text in listOf("1e400", "-1e400", "[1e999]")) assertInvalidJson(text, text)
        assertEquals(1.0e308, (JsonValue.parse("1e308") as JsonValue.NumberValue).value)
    }

    @Test
    fun limitsNestingDepthWithoutOverflowingTheStack() {
        val limit = 512
        JsonValue.parse("[".repeat(limit) + "]".repeat(limit))
        JsonValue.parse("""{"a":""".repeat(limit) + "null" + "}".repeat(limit))
        assertInvalidJson("[".repeat(limit + 1) + "]".repeat(limit + 1), "arrays past the limit")
        assertInvalidJson("""{"a":""".repeat(limit + 1) + "null" + "}".repeat(limit + 1), "objects past the limit")
        // 未闭合的超深输入也必须是协议错误，而不是 StackOverflowError 打断读线程。
        assertInvalidJson("[".repeat(200_000), "unterminated deep input")
    }

    @Test
    fun serializerKeepsPairsRawAndEscapesWhatUtf8CannotCarry() {
        assertEquals("\"\uD83D\uDE00\"", encodeJson(JsonValue.Text("\uD83D\uDE00")))
        assertEquals("\"\\ud800\"", encodeJson(JsonValue.Text("\uD800")))
        assertEquals("\"\\ude00\\ud83d\"", encodeJson(JsonValue.Text("\uDE00\uD83D")))
        assertEquals("\"\\u0000\\u0008\\u000c\\u001f\\n\\r\\t\\\\\\\"\"", encodeJson(JsonValue.Text("\u0000\b\u000c\u001f\n\r\t\\\"")))
        assertEquals("\"\u007f\u2028\"", encodeJson(JsonValue.Text("\u007f\u2028")))
    }

    /** 帧经 UTF-8 传输：任意 UTF-16 码元（含孤立代理）编码后再解码解析，必须得到原值。 */
    @Test
    fun everyCodeUnitSurvivesAUtf8RoundTrip() {
        val units = (0..0xFFFF).map { it.toChar() }
        for (unit in units) assertUtf8RoundTrip(unit.toString())
        assertUtf8RoundTrip("a\uD83D\uDE00b\uD800c")
        assertUtf8RoundTrip(units.joinToString(""))
    }

    @Test
    fun failureMessagesDoNotEchoFrameContent() {
        val error = assertThrows(CodemError.Protocol::class.java) { JsonValue.parse("{\"token\":\"sk-secret\u0001\"}") }
        assertEquals(CodemError.Class.InvalidJson, error.errorClass)
        assertFalse(error.message!!.contains("secret"))
    }

    /** 修复前 `\uZZZZ` 抛出 NumberFormatException，越过 RpcPeer 只捕获 CodemError 的边界。 */
    @Test
    fun invalidEscapeInACoreFrameFailsTheConnectionAsInvalidJson() {
        val errors = CopyOnWriteArrayList<CodemError>()
        val peer = RpcPeer({}, {}, {}, { errors += it })
        peer.consume("""{"jsonrpc":"2.0","method":"warning","params":{"message":"\uZZZZ"}}""")
        assertEquals(CodemError.Class.InvalidJson, errors.single().errorClass)
    }

    private fun assertUtf8RoundTrip(value: String) {
        val wire = String(encodeJson(JsonValue.Text(value)).toByteArray(Charsets.UTF_8), Charsets.UTF_8)
        assertEquals(JsonValue.Text(value), JsonValue.parse(wire))
    }

    private fun assertInvalidJson(text: String, name: String) {
        val error = assertThrows(CodemError.Protocol::class.java, { JsonValue.parse(text) }, name)
        assertEquals(CodemError.Class.InvalidJson, error.errorClass, name)
    }

    /** 数字按数值比较（`1E+2` 与 `100` 相同）；对象键顺序属于结果的一部分。 */
    private fun assertSameJson(expected: JsonValue, actual: JsonValue, name: String) {
        when (expected) {
            is JsonValue.NumberValue -> {
                assertTrue(actual is JsonValue.NumberValue, name)
                assertTrue(expected.value == (actual as JsonValue.NumberValue).value, "$name: ${expected.literal} != ${actual.literal}")
            }
            is JsonValue.ArrayValue -> {
                val items = (actual as? JsonValue.ArrayValue)?.items ?: error("$name: expected an array")
                assertEquals(expected.items.size, items.size, name)
                expected.items.zip(items).forEach { (left, right) -> assertSameJson(left, right, name) }
            }
            is JsonValue.ObjectValue -> {
                val fields = (actual as? JsonValue.ObjectValue)?.fields ?: error("$name: expected an object")
                assertEquals(expected.fields.keys.toList(), fields.keys.toList(), name)
                expected.fields.forEach { (key, value) -> assertSameJson(value, fields.getValue(key), "$name.$key") }
            }
            else -> assertEquals(expected, actual, name)
        }
    }
}
