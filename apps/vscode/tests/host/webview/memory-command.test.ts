import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { parseMemoryCommand, type ParsedMemoryCommand } from "../../../webview-ui/src/utils/memory-command.ts"

type MemoryOperation =
  | "enable"
  | "status"
  | "inspect"
  | "disable"
  | "rebuild"
  | "remember"
  | "correct"
  | "forget"
  | "purge"
  | "auto"
type Case = {
  name: string
  input: string
  result: "none" | "help" | "show" | "operation" | "usage"
  operation?: MemoryOperation
  mode?: "status" | "on" | "off"
  confirm?: boolean
  text?: string
  query?: string
  reason?: string
  rest?: string
}

const cases = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/kilo-memory/tests/command-cases.json"),
    "utf8",
  ),
) as Case[]

function expected(item: Case): ParsedMemoryCommand | undefined {
  if (item.result === "none") return
  if (item.result === "help") return { kind: "help" }
  if (item.result === "show") return { kind: "show", rest: item.rest ?? "" }
  if (item.result === "usage") return { kind: "usage", reason: item.reason ?? "" }
  if (!item.operation) throw new Error(`Missing operation for fixture: ${item.name}`)
  if (item.operation === "remember" || item.operation === "correct") {
    if (!item.text) throw new Error(`Missing text for fixture: ${item.name}`)
    return { kind: "operation", operation: item.operation, text: item.text }
  }
  if (item.operation === "forget") {
    if (!item.query) throw new Error(`Missing query for fixture: ${item.name}`)
    return { kind: "operation", operation: item.operation, query: item.query }
  }
  if (item.operation === "auto") {
    if (!item.mode) throw new Error(`Missing mode for fixture: ${item.name}`)
    return { kind: "operation", operation: item.operation, mode: item.mode }
  }
  if (item.operation === "purge") {
    if (item.confirm !== true) throw new Error(`Missing confirmation for fixture: ${item.name}`)
    return { kind: "operation", operation: item.operation, confirm: true }
  }
  return { kind: "operation", operation: item.operation, rest: item.rest ?? "" }
}

describe("parseMemoryCommand", () => {
  it("matches shared command fixtures", () => {
    for (const item of cases) {
      const parsed = parseMemoryCommand(item.input)
      if (item.result === "usage") {
        assert.equal(parsed?.kind, "usage", item.name)
        assert.equal(parsed && "reason" in parsed ? parsed.reason.includes(item.reason ?? "") : false, true, item.name)
        continue
      }
      assert.deepEqual(parsed, expected(item), item.name)
    }
  })
})
