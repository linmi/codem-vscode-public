import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const vscodeRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")

describe("routeEarlyMessage product-cut commands", () => {
  it("does not resume, promote, or accept leftover suggestions", () => {
    const source = readFileSync(join(vscodeRoot, "src/kilo-provider/early-message.ts"), "utf8")
    assert.equal(source.includes('"resumeSession"'), false)
    assert.equal(source.includes('"promoteBackgroundJob"'), false)
    assert.equal(source.includes("routeSuggestionWebviewMessage"), false)
    assert.equal(source.includes("promoteBackgroundJob"), false)
    assert.equal(source.includes("resume:"), false)
  })
})
