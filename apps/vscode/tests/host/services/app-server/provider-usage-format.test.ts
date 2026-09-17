import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ProviderUsageWindow } from "../../../../webview-ui/src/types/messages/leftover.ts"
import { formatWindow, windowLabel, windowProgress } from "../../../../webview-ui/src/utils/provider-usage-format.ts"

describe("provider usage presentation", () => {
  const window = (value: Partial<ProviderUsageWindow>): ProviderUsageWindow => ({
    id: "quota",
    resource: "general",
    unit: "percent",
    orientation: "remaining_percent",
    state: "active",
    ...value,
  })

  it("formats used and remaining orientations without provider branching", () => {
    assert.equal(formatWindow(window({ remaining: 75, limit: 100 })), "75% remaining")
    assert.equal(formatWindow(window({ orientation: "used_percent", used: 25, limit: 100 })), "25% used")
    assert.equal(windowProgress(window({ remaining: 75, limit: 100 })), 25)
  })

  it("keeps known zero distinct from unknown and preserves contract states", () => {
    assert.equal(formatWindow(window({ remaining: 0, limit: 100, state: "exhausted" })), "0% remaining")
    assert.equal(formatWindow(window({ state: "unknown" })), "Unknown")
    assert.equal(formatWindow(window({ state: "unlimited" })), "Unlimited")
    assert.equal(formatWindow(window({ state: "not_in_plan" })), "Not in plan")
  })

  it("composes window labels from structured periods instead of wire strings", () => {
    assert.equal(windowLabel(window({ resource: "subscription", period: { unit: "month", value: 1 } })), "Monthly quota")
    assert.equal(windowLabel(window({ resource: "subscription", period: { unit: "day", value: 3 } })), "3-day quota")
    assert.equal(windowLabel(window({ period: { unit: "hour", value: 5 } })), "Shared · 5-hour quota")
    assert.equal(windowLabel(window({ period: { unit: "week", value: 1 } })), "Shared · Weekly quota")
    assert.equal(windowLabel(window({ resource: "image" })), "image · Quota")
  })
})
