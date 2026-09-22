import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { capabilityIds, pages, resolvePage } from "../src/docs/content.ts"

test("every published route, capability and displayed example resolves", async () => {
  assert.equal(new Set(pages.map(page => page.id)).size, pages.length)
  for (const id of capabilityIds) assert.ok(pages.some(page => page.id === id))
  for (const page of pages) {
    assert.equal(resolvePage(`#/${page.id}`), page)
    for (const section of page.sections) {
      if (section.code) {
        const source = await readFile(new URL(`../examples/${section.code}.ts`, import.meta.url), "utf8")
        assert.ok(source.includes('from "@codem/app-server"'), `${section.code} must use the public SDK`)
      }
    }
  }
})

test("deep links retain their identity and invalid routes remain explicit", () => {
  assert.equal(resolvePage("")?.id, "overview")
  assert.equal(resolvePage("#/modes")?.id, "modes")
  for (const hash of ["#/missing", "#/%ZZ", "#/../overview", "#/constructor"]) {
    assert.equal(resolvePage(hash), undefined)
  }
})

test("section and method deep links validate targets instead of silently falling back", () => {
  assert.equal(resolvePage("#/modes?section=2")?.id, "modes")
  assert.equal(resolvePage("#/api?method=setModes")?.id, "api")
  for (const hash of ["#/modes?section=999", "#/modes?section=0", "#/api?method=missing", "#/modes?method=setModes", "#/modes?section=1&section=2", "#/modes?unknown=1"]) {
    assert.equal(resolvePage(hash), undefined, hash)
  }
})
