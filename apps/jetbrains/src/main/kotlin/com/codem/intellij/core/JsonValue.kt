package com.codem.intellij.core

/**
 * 协议帧使用的最小 JSON 模型。
 * 不依赖 IntelliJ / Gson，避免领域层引入编辑器 classloader。
 */
sealed class JsonValue {
    data object Null : JsonValue()
    data class Bool(val value: Boolean) : JsonValue()
    data class NumberValue(val value: Double, val literal: String) : JsonValue()
    data class Text(val value: String) : JsonValue()
    data class ArrayValue(val items: List<JsonValue>) : JsonValue()
    data class ObjectValue(val fields: Map<String, JsonValue>) : JsonValue() {
        fun optional(key: String): JsonValue? = fields[key]

        fun required(key: String): JsonValue =
            fields[key] ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "missing JSON field $key")
    }

    fun asObject(): ObjectValue =
        this as? ObjectValue ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "JSON value is not an object")

    fun asArray(): ArrayValue =
        this as? ArrayValue ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "JSON value is not an array")

    fun asText(): String =
        (this as? Text)?.value ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "JSON value is not a string")

    fun asBoolean(): Boolean =
        (this as? Bool)?.value ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "JSON value is not a boolean")

    companion object {
        fun obj(vararg pairs: Pair<String, JsonValue>): ObjectValue = ObjectValue(linkedMapOf(*pairs))

        fun parse(text: String): JsonValue {
            val parser = JsonParser(text)
            val value = parser.parseValue()
            parser.expectEnd()
            return value
        }
    }
}

fun JsonValue.optional(key: String): JsonValue? = (this as? JsonValue.ObjectValue)?.optional(key)

fun JsonValue.required(key: String): JsonValue = asObject().required(key)

fun encodeJson(value: JsonValue): String = buildString { appendJson(value) }

private fun StringBuilder.appendJson(value: JsonValue) {
    when (value) {
        JsonValue.Null -> append("null")
        is JsonValue.Bool -> append(value.value)
        is JsonValue.NumberValue -> append(value.literal)
        is JsonValue.Text -> appendQuoted(value.value)
        is JsonValue.ArrayValue -> {
            append('[')
            value.items.forEachIndexed { index, item ->
                if (index > 0) append(',')
                appendJson(item)
            }
            append(']')
        }
        is JsonValue.ObjectValue -> {
            append('{')
            value.fields.entries.forEachIndexed { index, (key, field) ->
                if (index > 0) append(',')
                appendQuoted(key)
                append(':')
                appendJson(field)
            }
            append('}')
        }
    }
}

private fun StringBuilder.appendQuoted(text: String) {
    append('"')
    for (character in text) {
        when (character) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (character.code < 0x20) append("\\u").append(character.code.toString(16).padStart(4, '0')) else append(character)
        }
    }
    append('"')
}

private class JsonParser(private val source: String) {
    private var index = 0

    fun parseValue(): JsonValue {
        skipWhitespace()
        if (index >= source.length) throw CodemError.Protocol(CodemError.Class.InvalidJson, "empty JSON")
        return when (source[index]) {
            '{' -> parseObject()
            '[' -> parseArray()
            '"' -> JsonValue.Text(parseString())
            't' -> parseLiteral("true", JsonValue.Bool(true))
            'f' -> parseLiteral("false", JsonValue.Bool(false))
            'n' -> parseLiteral("null", JsonValue.Null)
            '-', in '0'..'9' -> parseNumber()
            else -> throw CodemError.Protocol(CodemError.Class.InvalidJson, "unexpected JSON token")
        }
    }

    fun expectEnd() {
        skipWhitespace()
        if (index != source.length) throw CodemError.Protocol(CodemError.Class.InvalidJson, "trailing JSON content")
    }

    private fun parseObject(): JsonValue.ObjectValue {
        expect('{')
        val fields = linkedMapOf<String, JsonValue>()
        skipWhitespace()
        if (peek('}')) {
            index += 1
            return JsonValue.ObjectValue(fields)
        }
        while (true) {
            skipWhitespace()
            val key = parseString()
            skipWhitespace()
            expect(':')
            fields[key] = parseValue()
            skipWhitespace()
            when {
                peek(',') -> index += 1
                peek('}') -> {
                    index += 1
                    return JsonValue.ObjectValue(fields)
                }
                else -> throw CodemError.Protocol(CodemError.Class.InvalidJson, "invalid JSON object")
            }
        }
    }

    private fun parseArray(): JsonValue.ArrayValue {
        expect('[')
        val items = mutableListOf<JsonValue>()
        skipWhitespace()
        if (peek(']')) {
            index += 1
            return JsonValue.ArrayValue(items)
        }
        while (true) {
            items += parseValue()
            skipWhitespace()
            when {
                peek(',') -> index += 1
                peek(']') -> {
                    index += 1
                    return JsonValue.ArrayValue(items)
                }
                else -> throw CodemError.Protocol(CodemError.Class.InvalidJson, "invalid JSON array")
            }
        }
    }

    private fun parseString(): String {
        expect('"')
        val text = StringBuilder()
        while (index < source.length) {
            val character = source[index++]
            when (character) {
                '"' -> return text.toString()
                '\\' -> text.append(parseEscape())
                else -> text.append(character)
            }
        }
        throw CodemError.Protocol(CodemError.Class.InvalidJson, "unterminated JSON string")
    }

    private fun parseEscape(): Char {
        if (index >= source.length) throw CodemError.Protocol(CodemError.Class.InvalidJson, "unterminated JSON escape")
        return when (val character = source[index++]) {
            '"', '\\', '/' -> character
            'b' -> '\b'
            'f' -> '\u000c'
            'n' -> '\n'
            'r' -> '\r'
            't' -> '\t'
            'u' -> {
                if (index + 4 > source.length) throw CodemError.Protocol(CodemError.Class.InvalidJson, "invalid unicode escape")
                source.substring(index, index + 4).toInt(16).toChar().also { index += 4 }
            }
            else -> throw CodemError.Protocol(CodemError.Class.InvalidJson, "invalid JSON escape")
        }
    }

    private fun parseNumber(): JsonValue.NumberValue {
        val start = index
        if (peek('-')) index += 1
        if (peek('0')) index += 1
        else while (index < source.length && source[index] in '0'..'9') index += 1
        if (peek('.')) {
            index += 1
            while (index < source.length && source[index] in '0'..'9') index += 1
        }
        if (peek('e') || peek('E')) {
            index += 1
            if (peek('+') || peek('-')) index += 1
            while (index < source.length && source[index] in '0'..'9') index += 1
        }
        val literal = source.substring(start, index)
        val number = try {
            literal.toDouble()
        } catch (error: NumberFormatException) {
            throw CodemError.Protocol(CodemError.Class.InvalidJson, "invalid JSON number", error)
        }
        if (number.isNaN() || number.isInfinite()) {
            throw CodemError.Protocol(CodemError.Class.InvalidJson, "invalid JSON number")
        }
        return JsonValue.NumberValue(number, literal)
    }

    private fun parseLiteral(literal: String, value: JsonValue): JsonValue {
        if (!source.startsWith(literal, index)) throw CodemError.Protocol(CodemError.Class.InvalidJson, "invalid JSON literal")
        index += literal.length
        return value
    }

    private fun expect(character: Char) {
        if (!peek(character)) throw CodemError.Protocol(CodemError.Class.InvalidJson, "expected $character")
        index += 1
    }

    private fun peek(character: Char): Boolean = index < source.length && source[index] == character

    private fun skipWhitespace() {
        while (index < source.length && source[index].isWhitespace()) index += 1
    }
}
