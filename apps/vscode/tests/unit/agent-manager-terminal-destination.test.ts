import { describe, expect, it } from "bun:test"
import { resolveTerminalDestination } from "../../src/agent-manager/terminal-destination"

describe("Agent Manager terminal destination", () => {
  it("defaults unset settings to the Agent Manager panel", () => {
    expect(resolveTerminalDestination(undefined)).toBe("agentManager")
  })

  it("preserves explicit destinations and falls back safely for invalid settings", () => {
    expect(resolveTerminalDestination("invalid")).toBe("vscode")
    expect(resolveTerminalDestination("vscode")).toBe("vscode")
    expect(resolveTerminalDestination("agentManager")).toBe("agentManager")
  })
})
