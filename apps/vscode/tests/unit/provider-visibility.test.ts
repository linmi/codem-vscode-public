import { describe, expect, it } from "bun:test"

import {
  disabledProviderOptions,
  providersWithKiloFallback,
  visibleConnectedIds,
} from "../../webview-ui/src/components/settings/provider-visibility"

describe("visibleConnectedIds", () => {
  it("hides CodeM from the connected list when auth is missing", () => {
    const ids = visibleConnectedIds(["kilo", "openrouter"], { openrouter: "api" })

    expect(ids).toEqual(["openrouter"])
  })

  it("keeps CodeM in the connected list when auth exists", () => {
    const ids = visibleConnectedIds(["kilo", "openrouter"], { kilo: "oauth", openrouter: "api" })

    expect(ids).toEqual(["kilo", "openrouter"])
  })

  it("leaves non-CodeM providers untouched", () => {
    const ids = visibleConnectedIds(["anthropic"], {})

    expect(ids).toEqual(["anthropic"])
  })
})

describe("disabledProviderOptions", () => {
  it("includes CodeM and excludes already disabled providers", () => {
    const options = disabledProviderOptions(
      {
        kilo: { id: "kilo", name: "CodeM Gateway", env: [], models: {} },
        openai: { id: "openai", name: "OpenAI", env: [], models: {} },
        anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
      },
      ["openai"],
    )

    expect(options).toEqual([
      { value: "anthropic", label: "Anthropic" },
      { value: "kilo", label: "CodeM Gateway" },
    ])
  })

  it("sorts options by provider name", () => {
    const options = disabledProviderOptions(
      {
        zed: { id: "zed", name: "Zed", env: [], models: {} },
        alpha: { id: "alpha", name: "Alpha", env: [], models: {} },
      },
      [],
    )

    expect(options).toEqual([
      { value: "alpha", label: "Alpha" },
      { value: "zed", label: "Zed" },
    ])
  })
})

describe("providersWithKiloFallback", () => {
  it("adds CodeM when backend providers omit it", () => {
    const providers = providersWithKiloFallback({
      anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
    })

    expect(providers.kilo?.name).toBe("CodeM Gateway")
    expect(providers.anthropic?.name).toBe("Anthropic")
  })

  it("keeps the backend CodeM provider when present", () => {
    const providers = providersWithKiloFallback({
      kilo: { id: "kilo", name: "Custom CodeM Name", env: [], models: {} },
    })

    expect(providers.kilo?.name).toBe("Custom CodeM Name")
  })
})
