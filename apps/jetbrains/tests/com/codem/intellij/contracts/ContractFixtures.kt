package com.codem.intellij.contracts

import com.codem.intellij.core.JsonValue
import java.nio.file.Files
import java.nio.file.Path

/**
 * 读取 `packages/contracts` 共用样本。路径由 Gradle `codem.contracts` 注入并声明为测试输入；
 * 缺失即失败，不回退到内联副本，否则 TypeScript 侧改动不会让 Kotlin 测试失败。
 */
object ContractFixtures {
    private val root: Path by lazy {
        val configured = System.getProperty("codem.contracts")
            ?: error("codem.contracts is not set; run the Kotlin tests through Gradle")
        Path.of(configured).also { check(Files.isDirectory(it)) { "CodeM contracts directory is missing: $it" } }
    }

    fun path(relative: String): Path =
        root.resolve(relative).also { check(Files.isRegularFile(it)) { "CodeM contract sample is missing: $relative" } }

    fun text(relative: String): String = Files.readString(path(relative))

    fun json(relative: String): JsonValue.ObjectValue = JsonValue.parse(text(relative)).asObject()

    fun cases(relative: String): List<JsonValue.ObjectValue> =
        json(relative).fields.getValue("cases").asArray().items.map { it.asObject() }
}
