package com.codem.intellij.account

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** `auth status --json` 与 `auth login --json` 输出的解析，对照 packages/app-server/src/authentication.ts。 */
class AuthOutputParsingTest {
    @Test
    fun statusReadsEveryFieldAndTreatsNullAsAbsent() {
        val status = parseStatus(
            """{"loggedIn":true,"authMethod":"cli","routerCredential":true,"serverUrl":"https://codem.example","tenantId":"t1","userId":"u1","displayName":"User"}""",
        )
        assertEquals(AuthStatus(true, "cli", true, "https://codem.example", "t1", "u1", "User"), status)
        assertEquals(AuthStatus(false, null, null, null, null, null, null), parseStatus("""{"loggedIn":false,"authMethod":null,"routerCredential":null}"""))
    }

    @Test
    fun statusWithoutABooleanLoggedInIsNotAStatus() {
        for (text in listOf("", "not json", "[]", "{}", """{"loggedIn":"true"}""", """{"loggedIn":null}""")) {
            assertNull(parseStatus(text), text)
        }
    }

    @Test
    fun loginEventsNeedANonBlankTypeAndReadOtherFieldsLeniently() {
        assertEquals(LoginEvent("login_session", "https://codem.example/device", null, null), parseLoginEvent("""{"type":"login_session","authorizationUrl":"https://codem.example/device"}"""))
        // authentication.ts eventString: a non-string optional field is absent, the event still counts.
        assertEquals(LoginEvent("login_error", null, null, null), parseLoginEvent("""{"type":"login_error","code":7,"message":{"text":"no"}}"""))
        for (line in listOf("", "[]", """{"type":" "}""", """{"type":1}""", """{"code":"x"}""")) {
            assertNull(parseLoginEvent(line), line)
        }
    }
}
