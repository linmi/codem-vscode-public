import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { it } from "node:test"
import { bundleNotices } from "../scripts/support/bundleNotices.ts"

it("collects each bundled dependency once, traverses type-only manifests and rejects missing licenses", async t => {
  const root = await mkdtemp(join(tmpdir(), "codem notices "))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dependency = join(root, "node_modules", "fixture")
  await mkdir(join(dependency, "dist"), { recursive: true })
  await mkdir(join(root, "packaging"))
  await mkdir(join(root, "node_modules/@codem/ui/src/components"), { recursive: true })
  await writeFile(join(root, "packaging/uiNotices.txt"), "UI notice")
  await writeFile(join(root, "node_modules/@codem/ui/src/components/shadcnLicense.md"), "shadcn notice")
  await writeFile(join(dependency, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }))
  await writeFile(join(dependency, "dist/package.json"), '{"type":"module"}')
  for (const file of ["a.js", "b.js"]) await writeFile(join(dependency, "dist", file), "")
  const inputs = ["node_modules/fixture/dist/a.js", "node_modules/fixture/dist/b.js", "src/entry.ts"]
  await assert.rejects(bundleNotices(root, inputs), /Missing license text.*fixture@1.0.0/)
  await writeFile(join(dependency, "LICENSE.md"), "Fixture copyright and license")
  const result = await bundleNotices(root, inputs)
  assert.equal(result.split("fixture@1.0.0").length, 2)
  for (const text of ["Fixture copyright and license", "UI notice", "shadcn notice"]) assert.ok(result.includes(text))
})
