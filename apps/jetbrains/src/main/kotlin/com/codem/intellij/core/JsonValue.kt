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
    /**
     * 字段读取分三类，调用方按协议语义选择，不在各处自己转型：
     * - `requiredX(key, path)`：缺失、`null` 或类型不符都以 InvalidFrame 失败，错误带 `path.key`；
     * - `optionalX(key, path)`：缺失或 `null` 返回 null，出现但类型不符同样以 InvalidFrame 失败；
     * - `xOrNull(key)`：宽松读取，缺失、`null` 与类型不符都返回 null。只用于 Node Host 同样宽松、
     *   或调用方自己以其它错误类（History、Validation、Capability）失败的字段。
     *
     * `path` 是这个对象在消息里的位置，如 `thread/list threads[0]`。错误只带路径，不回显字段值。
     */
    data class ObjectValue(val fields: Map<String, JsonValue>) : JsonValue() {
        fun optional(key: String): JsonValue? = fields[key]

        fun required(key: String): JsonValue =
            fields[key] ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "missing JSON field $key")

        fun requiredString(key: String, path: String): String = field(key, path).asText("$path.$key")

        fun optionalString(key: String, path: String): String? = present(key)?.asText("$path.$key")

        fun stringOrNull(key: String): String? = (fields[key] as? Text)?.value

        fun requiredObject(key: String, path: String): ObjectValue = field(key, path).asObject("$path.$key")

        fun optionalObject(key: String, path: String): ObjectValue? = present(key)?.asObject("$path.$key")

        fun objectOrNull(key: String): ObjectValue? = fields[key] as? ObjectValue

        fun requiredArray(key: String, path: String): List<JsonValue> = field(key, path).asArray("$path.$key").items

        fun arrayOrNull(key: String): List<JsonValue>? = (fields[key] as? ArrayValue)?.items

        fun requiredBoolean(key: String, path: String): Boolean = field(key, path).asBoolean("$path.$key")

        fun booleanOrNull(key: String): Boolean? = (fields[key] as? Bool)?.value

        /** 整数语义：JSON 数值必须是 Int 范围内的整数，1.5 或 1e10 都不会被截断成别的值。 */
        fun requiredInt(key: String, path: String): Int {
            val label = "$path.$key"
            val number = (field(key, path) as? NumberValue)?.value ?: throw invalidFrame("$label is not an integer")
            if (number.toInt().toDouble() != number) throw invalidFrame("$label is not an integer")
            return number.toInt()
        }

        fun numberOrNull(key: String): Double? = (fields[key] as? NumberValue)?.value

        private fun field(key: String, path: String): JsonValue =
            fields[key] ?: throw invalidFrame("missing JSON field $path.$key")

        private fun present(key: String): JsonValue? = fields[key]?.takeUnless { it == Null }
    }

    fun asObject(path: String = "JSON value"): ObjectValue =
        this as? ObjectValue ?: throw invalidFrame("$path is not an object")

    fun asArray(path: String = "JSON value"): ArrayValue =
        this as? ArrayValue ?: throw invalidFrame("$path is not an array")

    fun asText(path: String = "JSON value"): String =
        (this as? Text)?.value ?: throw invalidFrame("$path is not a string")

    fun asBoolean(path: String = "JSON value"): Boolean =
        (this as? Bool)?.value ?: throw invalidFrame("$path is not a boolean")

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

private fun invalidFrame(message: String) = CodemError.Protocol(CodemError.Class.InvalidFrame, message)

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
    var index = 0
    while (index < text.length) {
        val character = text[index]
        when {
            character == '\\' -> append("\\\\")
            character == '"' -> append("\\\"")
            character == '\n' -> append("\\n")
            character == '\r' -> append("\\r")
            character == '\t' -> append("\\t")
            character.code < 0x20 -> appendUnicodeEscape(character)
            // 成对代理原样写出；孤立代理按 JSON.stringify 转义，避免 UTF-8 编码时被替换成 '?'。
            character.isHighSurrogate() && index + 1 < text.length && text[index + 1].isLowSurrogate() -> {
                append(character).append(text[index + 1])
                index += 1
            }
            character.isSurrogate() -> appendUnicodeEscape(character)
            else -> append(character)
        }
        index += 1
    }
    append('"')
}

private fun StringBuilder.appendUnicodeEscape(character: Char) {
    append("\\u").append(character.code.toString(16).padStart(4, '0'))
}

/**
 * RFC 8259 严格解析：只认四种空白、只认标准数字语法、字符串内控制字符必须转义，
 * `\u` 后必须是四位十六进制。任何失败都是 [CodemError.Class.InvalidJson]，不泄漏其它异常。
 *
 * 重复键：与 `JSON.parse` 一致，后出现的值覆盖先前的值，键保留首次出现的位置。
 * Core（serde_json）与 Webview（JSON.stringify）都不会产出重复键；采用同一策略是为了
 * 让 Kotlin 与 TypeScript 两端对同一输入得出同一结果，而不是各自解释。
 *
 * 孤立代理的 `\u` 转义按语法接受（与 `JSON.parse` 一致），序列化时再转义回去。
 * 数字超出 Double 范围时拒绝，因为 NaN/Infinity 无法写回 JSON。
 * 嵌套深度上限 [MAX_DEPTH]，避免递归耗尽读线程栈。
 */
private class JsonParser(private val source: String) {
    private var index = 0
    private var depth = 0

    fun parseValue(): JsonValue {
        skipWhitespace()
        if (index >= source.length) fail(if (index == 0) "empty JSON" else "unexpected end of JSON")
        return when (source[index]) {
            '{' -> nested { parseObject() }
            '[' -> nested { parseArray() }
            '"' -> JsonValue.Text(parseString())
            't' -> parseLiteral("true", JsonValue.Bool(true))
            'f' -> parseLiteral("false", JsonValue.Bool(false))
            'n' -> parseLiteral("null", JsonValue.Null)
            '-', in '0'..'9' -> parseNumber()
            else -> fail("unexpected JSON token")
        }
    }

    fun expectEnd() {
        skipWhitespace()
        if (index != source.length) fail("trailing JSON content")
    }

    private inline fun <T> nested(parse: () -> T): T {
        if (depth >= MAX_DEPTH) fail("JSON nesting exceeds $MAX_DEPTH levels")
        depth += 1
        try {
            return parse()
        } finally {
            depth -= 1
        }
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
                else -> fail("invalid JSON object")
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
                else -> fail("invalid JSON array")
            }
        }
    }

    private fun parseString(): String {
        expect('"')
        val text = StringBuilder()
        while (index < source.length) {
            val character = source[index++]
            when {
                character == '"' -> return text.toString()
                character == '\\' -> text.append(parseEscape())
                character.code < 0x20 -> fail("unescaped control character in JSON string")
                else -> text.append(character)
            }
        }
        fail("unterminated JSON string")
    }

    private fun parseEscape(): Char {
        if (index >= source.length) fail("unterminated JSON escape")
        return when (val character = source[index++]) {
            '"', '\\', '/' -> character
            'b' -> '\b'
            'f' -> '\u000c'
            'n' -> '\n'
            'r' -> '\r'
            't' -> '\t'
            'u' -> {
                if (index + 4 > source.length) fail("invalid unicode escape")
                var code = 0
                repeat(4) {
                    val digit = Character.digit(source[index], 16)
                    if (digit < 0 || source[index].code > 0x7f) fail("invalid unicode escape")
                    code = code * 16 + digit
                    index += 1
                }
                code.toChar()
            }
            else -> fail("invalid JSON escape")
        }
    }

    /** number = [ minus ] int [ frac ] [ exp ]，int = zero / ( digit1-9 *DIGIT )。 */
    private fun parseNumber(): JsonValue.NumberValue {
        val start = index
        if (peek('-')) index += 1
        when {
            peek('0') -> index += 1
            index < source.length && source[index] in '1'..'9' -> skipDigits()
            else -> fail("invalid JSON number")
        }
        if (peek('.')) {
            index += 1
            if (skipDigits() == 0) fail("invalid JSON number")
        }
        if (peek('e') || peek('E')) {
            index += 1
            if (peek('+') || peek('-')) index += 1
            if (skipDigits() == 0) fail("invalid JSON number")
        }
        val literal = source.substring(start, index)
        val number = try {
            literal.toDouble()
        } catch (error: NumberFormatException) {
            throw CodemError.Protocol(CodemError.Class.InvalidJson, "invalid JSON number at offset $start", error)
        }
        if (number.isNaN() || number.isInfinite()) fail("JSON number is out of range")
        return JsonValue.NumberValue(number, literal)
    }

    private fun skipDigits(): Int {
        val start = index
        while (index < source.length && source[index] in '0'..'9') index += 1
        return index - start
    }

    private fun parseLiteral(literal: String, value: JsonValue): JsonValue {
        if (!source.startsWith(literal, index)) fail("invalid JSON literal")
        index += literal.length
        return value
    }

    private fun expect(character: Char) {
        if (!peek(character)) fail("expected $character")
        index += 1
    }

    private fun peek(character: Char): Boolean = index < source.length && source[index] == character

    /** RFC 8259 §2：只有空格、制表、换行、回车是空白；不接受 Unicode 空白。 */
    private fun skipWhitespace() {
        while (index < source.length) {
            when (source[index]) {
                ' ', '\t', '\n', '\r' -> index += 1
                else -> return
            }
        }
    }

    private fun fail(reason: String): Nothing =
        throw CodemError.Protocol(CodemError.Class.InvalidJson, "$reason at offset $index")

    companion object {
        const val MAX_DEPTH = 512
    }
}
