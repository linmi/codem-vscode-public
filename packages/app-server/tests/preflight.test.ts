import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  APP_SERVER_CORE_VERSION,
  REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES,
  REQUIRED_APP_SERVER_ITEM_STATUSES,
  REQUIRED_APP_SERVER_ITEM_TYPES,
  validateAppServerInitializeResult,
} from "../src/index.ts"

const runtime = { coreVersion: APP_SERVER_CORE_VERSION, executablePath: "/fixture/codem-core" }

describe("App Server initialize validation", () => {
  it("accepts protocol 1 with the complete required capability surface", () => {
    assert.deepEqual(validateAppServerInitializeResult(initializeResult(completeCapabilities()), runtime), {
      protocolVersion: 1,
      agentVersion: `${APP_SERVER_CORE_VERSION}+1.g0123456`,
    })
  })

  it("rejects a missing required capability", () => {
    const capabilities = completeCapabilities()
    ;(capabilities.threads as Record<string, unknown>).modelSelection = false
    assert.throws(
      () => validateAppServerInitializeResult(initializeResult(capabilities), runtime),
      /missing required capability threads\.modelSelection=true/u,
    )
  })

  it("rejects an unsupported protocol version", () => {
    assert.throws(
      () => validateAppServerInitializeResult(initializeResult(completeCapabilities(), 2), runtime),
      /protocol 2 is not supported; expected 1/u,
    )
  })
})

function initializeResult(capabilities: Record<string, unknown>, protocolVersion = 1): Record<string, unknown> {
  return {
    protocolVersion,
    agentInfo: { version: `${APP_SERVER_CORE_VERSION}+1.g0123456` },
    capabilities,
  }
}

function completeCapabilities(): Record<string, unknown> {
  const capabilities: Record<string, unknown> = {}
  for (const path of REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES) {
    assignNested(capabilities, path, true)
  }
  assignNested(capabilities, "items.types", [...REQUIRED_APP_SERVER_ITEM_TYPES])
  assignNested(capabilities, "items.statuses", [...REQUIRED_APP_SERVER_ITEM_STATUSES])
  return capabilities
}

function assignNested(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".")
  let current = target
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment]
    if (typeof next === "object" && next !== null && !Array.isArray(next)) {
      current = next as Record<string, unknown>
    } else {
      const created: Record<string, unknown> = {}
      current[segment] = created
      current = created
    }
  }
  current[segments.at(-1)!] = value
}
