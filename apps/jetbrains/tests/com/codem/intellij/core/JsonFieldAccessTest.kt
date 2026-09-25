package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/** Typed field reads on [JsonValue.ObjectValue]: required, optional and lenient each treat missing, null and wrong types one way. */
class JsonFieldAccessTest {
    private val sample = JsonValue.parse(
        """{"text":"hi","blank":"","nothing":null,"number":3,"whole":3.0,"fraction":1.5,"huge":1e10,"negative":-2,"flag":true,"list":[1],"object":{"a":1},"secret":"sk-secret"}""",
    ).asObject()

    @Test
    fun requiredReadsFailWithTheFieldPathWhenMissingNullOrMistyped() {
        assertEquals("hi", sample.requiredString("text", "frame"))
        assertEquals("", sample.requiredString("blank", "frame"))
        assertEquals(JsonValue.obj("a" to JsonValue.NumberValue(1.0, "1")), sample.requiredObject("object", "frame"))
        assertEquals(listOf(JsonValue.NumberValue(1.0, "1")), sample.requiredArray("list", "frame"))
        assertEquals(true, sample.requiredBoolean("flag", "frame"))

        assertInvalidFrame("missing JSON field frame.absent") { sample.requiredString("absent", "frame") }
        assertInvalidFrame("frame.nothing is not a string") { sample.requiredString("nothing", "frame") }
        assertInvalidFrame("frame.number is not a string") { sample.requiredString("number", "frame") }
        assertInvalidFrame("frame.list is not an object") { sample.requiredObject("list", "frame") }
        assertInvalidFrame("frame.object is not an array") { sample.requiredArray("object", "frame") }
        assertInvalidFrame("frame.text is not a boolean") { sample.requiredBoolean("text", "frame") }
        assertInvalidFrame("missing JSON field frame.absent") { sample.requiredBoolean("absent", "frame") }
    }

    @Test
    fun optionalReadsTreatMissingAndNullAsAbsentButRejectOtherTypes() {
        assertEquals("hi", sample.optionalString("text", "frame"))
        assertNull(sample.optionalString("absent", "frame"))
        assertNull(sample.optionalString("nothing", "frame"))
        assertInvalidFrame("frame.flag is not a string") { sample.optionalString("flag", "frame") }

        assertEquals(sample.requiredObject("object", "frame"), sample.optionalObject("object", "frame"))
        assertNull(sample.optionalObject("absent", "frame"))
        assertNull(sample.optionalObject("nothing", "frame"))
        assertInvalidFrame("frame.text is not an object") { sample.optionalObject("text", "frame") }

        assertEquals(true, sample.optionalBoolean("flag", "frame"))
        assertNull(sample.optionalBoolean("absent", "frame"))
        assertNull(sample.optionalBoolean("nothing", "frame"))
        assertInvalidFrame("frame.text is not a boolean") { sample.optionalBoolean("text", "frame") }
    }

    @Test
    fun lenientReadsReturnNullForMissingNullAndMistypedFields() {
        assertEquals("hi", sample.stringOrNull("text"))
        assertEquals(sample.requiredObject("object", "frame"), sample.objectOrNull("object"))
        assertEquals(listOf(JsonValue.NumberValue(1.0, "1")), sample.arrayOrNull("list"))
        assertEquals(true, sample.booleanOrNull("flag"))
        assertEquals(1.5, sample.numberOrNull("fraction"))
        for (key in listOf("absent", "nothing")) {
            assertNull(sample.stringOrNull(key), key)
            assertNull(sample.objectOrNull(key), key)
            assertNull(sample.arrayOrNull(key), key)
            assertNull(sample.booleanOrNull(key), key)
            assertNull(sample.numberOrNull(key), key)
        }
        assertNull(sample.stringOrNull("number"))
        assertNull(sample.objectOrNull("list"))
        assertNull(sample.arrayOrNull("object"))
        assertNull(sample.booleanOrNull("text"))
        assertNull(sample.numberOrNull("text"))
    }

    /** 与 Node Host 的整数校验一致：非整数、超出 Int 的值和字符串都不会被截断成别的数。 */
    @Test
    fun requiredIntAcceptsOnlyWholeNumbersInRange() {
        assertEquals(3, sample.requiredInt("number", "frame"))
        assertEquals(3, sample.requiredInt("whole", "frame"))
        assertEquals(-2, sample.requiredInt("negative", "frame"))
        assertInvalidFrame("frame.fraction is not an integer") { sample.requiredInt("fraction", "frame") }
        assertInvalidFrame("frame.huge is not an integer") { sample.requiredInt("huge", "frame") }
        assertInvalidFrame("frame.text is not an integer") { sample.requiredInt("text", "frame") }
        assertInvalidFrame("frame.nothing is not an integer") { sample.requiredInt("nothing", "frame") }
        assertInvalidFrame("missing JSON field frame.absent") { sample.requiredInt("absent", "frame") }
    }

    @Test
    fun elementConversionsNameTheirPathAndKeepTheDefaultMessage() {
        assertInvalidFrame("frame.items[2] is not an object") { JsonValue.Text("x").asObject("frame.items[2]") }
        assertInvalidFrame("JSON value is not an object") { JsonValue.Text("x").asObject() }
        assertInvalidFrame("JSON value is not a string") { JsonValue.Null.asText() }
    }

    @Test
    fun failuresNameTheFieldWithoutEchoingItsValue() {
        val error = assertThrows(CodemError.Protocol::class.java) { sample.requiredInt("secret", "frame") }
        assertFalse(error.message!!.contains("sk-secret"), error.message)
    }

    private fun assertInvalidFrame(message: String, read: () -> Any?) {
        val error = assertThrows(CodemError.Protocol::class.java) { read() }
        assertEquals(CodemError.Class.InvalidFrame, error.errorClass, message)
        assertEquals(message, error.message)
    }
}
