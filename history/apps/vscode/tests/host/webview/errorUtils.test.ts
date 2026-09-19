import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AssistantMessage } from "@codem/ui/types/session"
import {
  unwrapError,
  parseAssistantError,
  parseProviderAuthError,
  isUnauthorizedPaidModelError,
  isUnauthorizedPromotionLimitError,
} from "../../../webview-ui/src/utils/errorUtils.ts"

type AssistantError = AssistantMessage["error"]

describe("unwrapError", () => {
  it("returns plain string messages unchanged", () => {
    assert.equal(unwrapError("something went wrong"), "something went wrong")
  })

  it("extracts message from JSON error object with error.message", () => {
    const input = JSON.stringify({ error: { message: "rate limit exceeded" } })
    assert.equal(unwrapError(input), "rate limit exceeded")
  })

  it("returns original message for malformed JSON", () => {
    assert.equal(unwrapError("{not valid json"), "{not valid json")
  })

  it("strips leading 'Error: ' prefix before parsing", () => {
    const json = JSON.stringify({ message: "connection refused" })
    assert.equal(unwrapError(`Error: ${json}`), "connection refused")
  })

  it("formats empty provider rate-limit errors", () => {
    const body = {
      type: "error",
      sequence_number: 2,
      error: { type: "tokens", code: "rate_limit_exceeded", message: "", param: null },
    }
    const input = JSON.stringify({ message: JSON.stringify(body) })

    assert.equal(unwrapError(input), "Provider rate limit exceeded. Please try again shortly.")
  })

  it("preserves provider details when a rate-limit message is present", () => {
    const input = JSON.stringify({
      type: "error",
      error: { type: "tokens", code: "rate_limit_exceeded", message: "Try again in 30 seconds." },
    })

    assert.equal(unwrapError(input), "tokens: Try again in 30 seconds.")
  })
})

describe("parseAssistantError", () => {
  it("returns null for null input", () => {
    assert.equal(parseAssistantError(null), null)
  })

  it("returns null for undefined input", () => {
    assert.equal(parseAssistantError(undefined), null)
  })

  it("returns null for non-APIError (e.g. MessageAbortedError)", () => {
    const error: AssistantError = { name: "MessageAbortedError", data: { message: "aborted" } }
    assert.equal(parseAssistantError(error), null)
  })

  it("returns null when APIError has no data", () => {
    // Simulate a malformed error where data is missing at runtime
    const error = { name: "APIError" } as unknown as AssistantError
    assert.equal(parseAssistantError(error), null)
  })

  it("extracts statusCode and message from APIError data", () => {
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 401, message: "Unauthorized", isRetryable: false },
    }
    const result = parseAssistantError(error)
    assert.deepEqual(result, { statusCode: 401, code: undefined, message: "Unauthorized" })
  })

  it("extracts code from responseBody JSON with error.code", () => {
    const responseBody = JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } })
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 401, message: "Unauthorized", isRetryable: false, responseBody },
    }
    const result = parseAssistantError(error)
    assert.deepEqual(result, { statusCode: 401, code: "PAID_MODEL_AUTH_REQUIRED", message: "Unauthorized" })
  })

  it("extracts code from responseBody JSON with top-level code", () => {
    const responseBody = JSON.stringify({ code: "PROMOTION_MODEL_LIMIT_REACHED" })
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 429, message: "Too Many Requests", isRetryable: false, responseBody },
    }
    const result = parseAssistantError(error)
    assert.deepEqual(result, { statusCode: 429, code: "PROMOTION_MODEL_LIMIT_REACHED", message: "Too Many Requests" })
  })

  it("handles invalid responseBody JSON gracefully", () => {
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 500, message: "Server Error", isRetryable: false, responseBody: "not json" },
    }
    const result = parseAssistantError(error)
    assert.deepEqual(result, { statusCode: 500, code: undefined, message: "Server Error" })
  })

  it("handles missing responseBody", () => {
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 403, message: "Forbidden", isRetryable: false },
    }
    const result = parseAssistantError(error)
    assert.deepEqual(result, { statusCode: 403, code: undefined, message: "Forbidden" })
  })
})

describe("parseProviderAuthError", () => {
  it("extracts provider auth errors", () => {
    const error: AssistantError = {
      name: "ProviderAuthError",
      data: { providerID: "openai", message: "Sign in again" },
    }

    assert.deepEqual(parseProviderAuthError(error), { providerID: "openai", message: "Sign in again" })
  })

  it("returns null for non-provider-auth errors", () => {
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 401, message: "Unauthorized", isRetryable: false },
    }

    assert.equal(parseProviderAuthError(error), null)
  })
})

describe("isUnauthorizedPaidModelError", () => {
  it("returns true for 401 + PAID_MODEL_AUTH_REQUIRED", () => {
    assert.equal(isUnauthorizedPaidModelError({ statusCode: 401, code: "PAID_MODEL_AUTH_REQUIRED" }), true)
  })

  it("returns false for 401 + different code", () => {
    assert.equal(isUnauthorizedPaidModelError({ statusCode: 401, code: "SOMETHING_ELSE" }), false)
  })

  it("returns false for null input", () => {
    assert.equal(isUnauthorizedPaidModelError(null), false)
  })
})

describe("isUnauthorizedPromotionLimitError", () => {
  it("returns true for 401 + PROMOTION_MODEL_LIMIT_REACHED", () => {
    assert.equal(isUnauthorizedPromotionLimitError({ statusCode: 401, code: "PROMOTION_MODEL_LIMIT_REACHED" }), true)
  })

  it("returns true for 429 + PROMOTION_MODEL_LIMIT_REACHED", () => {
    assert.equal(isUnauthorizedPromotionLimitError({ statusCode: 429, code: "PROMOTION_MODEL_LIMIT_REACHED" }), true)
  })

  it("returns false for null input", () => {
    assert.equal(isUnauthorizedPromotionLimitError(null), false)
  })
})
