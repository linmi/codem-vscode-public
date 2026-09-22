import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { apiEntries, coverage, eventReference } from "../src/docs/apiReference.ts"
import { pages } from "../src/docs/content.ts"
import { searchDocs } from "../src/docs/docSearch.ts"

test("every coverage claim points to a displayed example that actually calls the documented Host method", async () => {
  const displayed = new Set(pages.flatMap(page => page.sections.flatMap(section => section.code ? [section.code] : [])))
  for (const entry of apiEntries) {
    assert.ok(pages.some(page => page.id === entry.page), entry.name)
    assert.ok(entry.signature && entry.purpose && entry.boundary)
    if (entry.example !== null) {
      assert.ok(displayed.has(entry.example), `${entry.name}: example is not reachable`)
      const code = (await readFile(new URL(`../examples/${entry.example}.ts`, import.meta.url), "utf8")).replace(/\/\/[^\n]*/g, "")
      assert.match(code, new RegExp(`\\bhost\\.${entry.name}\\s*\\(`), `${entry.name}: comments do not count as a call`)
    }
  }
  assert.equal(coverage.methodsWithExamples, apiEntries.filter(entry => entry.example !== null).length)
  assert.equal(coverage.eventTypes, Object.keys(eventReference).length)
})

test("search supports Chinese, API names, whitespace, multiple terms and empty results", () => {
  assert.ok(searchDocs("权限").some(page => page.id === "modes"))
  assert.ok(searchDocs("  SETMODES  ").some(page => page.id === "modes"))
  assert.ok(searchDocs("terminateBackgroundTerminal").some(page => page.id === "resources"))
  assert.ok(searchDocs("模式 revision").some(page => page.id === "modes"))
  assert.ok(searchDocs("turn-completed").some(page => page.id === "events"))
  assert.ok(searchDocs("setModes").some(page => page.id === "api"))
  assert.equal(searchDocs("no-such-codem-method").length, 0)
  assert.equal(searchDocs("   ").length, pages.length)
  assert.equal(searchDocs("<script>alert(1)</script>").length, 0)
})
