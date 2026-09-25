package com.codem.intellij.webview

import com.codem.intellij.contracts.ContractFixtures
import com.codem.intellij.core.CodemError
import com.codem.intellij.core.optional
import com.codem.intellij.core.required
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/** `packages/contracts/webview` 样本同时约束 TypeScript `parseUiAction` 与 Kotlin `parseViewAction`。 */
class ViewContractTest {
    @Test
    fun sendAndPanelActionsFollowTheSharedSamples() {
        val cases = ContractFixtures.cases("webview/sendAction.json") + ContractFixtures.cases("webview/panelReply.json")
        check(cases.isNotEmpty())
        for (case in cases) {
            val name = case.required("name").asText()
            val input = case.required("input")
            val expected = case.required("expected").asObject()
            when (val kind = expected.required("kind").asText()) {
                "accepted" -> {
                    val action = parseViewAction(input)
                    val type = expected.optional("type")?.asText() ?: input.required("type").asText()
                    assertEquals(type, actionType(action), name)
                }
                "rejected" -> {
                    assertEquals("invalid-action", expected.required("class").asText(), name)
                    assertThrows(CodemError::class.java, { parseViewAction(input) }, name)
                }
                else -> error("$name has unsupported expected kind $kind")
            }
        }
    }

    @Test
    fun firstPaintMatchesTheSharedInitialSnapshot() {
        val sample = ContractFixtures.json("webview/initialSnapshot.json")
        val expected = sample.required("expected").asObject()
        val snapshot = initialSnapshot()
        val encoded = encodeChatSnapshot(snapshot)
        for ((key, value) in expected.fields) {
            if (key == "hiddenUntilReady") continue
            assertEquals(value, encoded.fields[key], "initial snapshot field $key")
        }
        assertEquals(expected.required("hiddenUntilReady").asArray().items.map { it.asText() }, hiddenUntilReady())
        val controls = visibleControls(snapshot)
        assertFalse(controls.retry)
        assertFalse(controls.resume)
        assertFalse(controls.older)
        // 账户页开合归界面；Host 只下发请求序号，首屏没有请求，也不再下发 accountOpen。
        assertFalse(encoded.fields.containsKey("accountOpen"))
    }

    /** 对应 Webview 线协议的 `type`，如 `SetWorkMode` → `setWorkMode`。 */
    private fun actionType(action: ViewAction): String =
        action::class.simpleName!!.replaceFirstChar { it.lowercase() }
}
