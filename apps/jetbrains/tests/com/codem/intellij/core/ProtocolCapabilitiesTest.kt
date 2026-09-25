package com.codem.intellij.core

import com.codem.intellij.contracts.ContractFixtures
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/** initialize 校验与 `@codem/app-server` preflight.validateAppServerInitializeResult 对照。 */
class ProtocolCapabilitiesTest {
    private val handshake: JsonValue.ObjectValue = ContractFixtures.json("core/initializeHandshake.json")
        .requiredArray("events", "handshake").first().asObject()
        .requiredObject("frame", "handshake events[0]")
        .requiredObject("result", "handshake events[0].frame")

    @Test
    fun acceptsTheSharedHandshake() {
        val initialized = ProtocolCapabilities.validateInitialize(handshake, RuntimeLocator.CORE_VERSION)
        assertEquals(ProtocolCapabilities.PROTOCOL_VERSION, initialized.protocolVersion)
    }

    @Test
    fun requiresEveryBooleanCapabilityToBeTrue() {
        for (replacement in listOf(null, JsonValue.Bool(false), JsonValue.Text("true"), JsonValue.Null)) {
            assertRejected("turns.steer=$replacement", withCapability("turns", "steer", replacement))
        }
        // 中间段不是对象时，与 Node 的 nestedValue 一样视为缺失。
        assertRejected("turns as array", withCapabilities { it + ("turns" to JsonValue.ArrayValue(emptyList())) })
    }

    @Test
    fun requiresItemTypesAndStatusesAsArraysWithEveryMember() {
        assertRejected("items.types missing", withCapability("items", "types", null))
        assertRejected("items.types as object", withCapability("items", "types", JsonValue.obj()))
        val types = ProtocolCapabilities.requiredItemTypes.map(JsonValue::Text)
        assertRejected("items.types without subagent", withCapability("items", "types", JsonValue.ArrayValue(types.dropLast(1))))
        // 非字符串成员不算数，也不会让校验出错。
        val padded = JsonValue.ArrayValue(listOf(JsonValue.NumberValue(1.0, "1")) + types)
        ProtocolCapabilities.validateInitialize(withCapability("items", "types", padded), RuntimeLocator.CORE_VERSION)
        assertRejected("items.statuses as text", withCapability("items", "statuses", JsonValue.Text("completed")))
    }

    private fun assertRejected(name: String, result: JsonValue.ObjectValue) {
        val error = assertThrows(CodemError.Protocol::class.java, { ProtocolCapabilities.validateInitialize(result, RuntimeLocator.CORE_VERSION) }, name)
        assertEquals(CodemError.Class.Capability, error.errorClass, name)
    }

    private fun withCapability(group: String, key: String, value: JsonValue?): JsonValue.ObjectValue = withCapabilities { capabilities ->
        val fields = LinkedHashMap(capabilities.getValue(group).asObject().fields)
        if (value == null) fields.remove(key) else fields[key] = value
        capabilities + (group to JsonValue.ObjectValue(fields))
    }

    private fun withCapabilities(change: (Map<String, JsonValue>) -> Map<String, JsonValue>): JsonValue.ObjectValue {
        val capabilities = handshake.requiredObject("capabilities", "initialize").fields
        return JsonValue.ObjectValue(handshake.fields + ("capabilities" to JsonValue.ObjectValue(change(capabilities))))
    }
}
