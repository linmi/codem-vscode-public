import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { it, type TestContext } from "node:test"
import { createVSIX, listFiles, PackageManager } from "@vscode/vsce"
import { APP_SERVER_CLI_VERSION, APP_SERVER_CORE_VERSION, appServerAuthPackageName, appServerRuntimePackageName, type AppServerRuntimeTarget } from "@codem/app-server"
import { packageTarget, stageVsix } from "../scripts/support/vsixPackage.ts"

it("requires a native target and rejects attempts to relabel a package", () => {
  for (const platform of ["darwin", "win32"] as const) {
    for (const arch of ["arm64", "x64"] as const) assert.equal(packageTarget(`${platform}-${arch}`, platform, arch), `${platform}-${arch}`)
  }
  assert.equal(packageTarget(undefined, "win32", "x64"), "win32-x64")
  assert.throws(() => packageTarget("win32-x64", "darwin", "arm64"), /does not match/)
  assert.throws(() => packageTarget("web", "darwin", "arm64"), /does not match/)
  assert.throws(() => packageTarget(undefined, "win32", "ia32"), /does not support/)
})

for (const target of ["darwin-arm64", "darwin-x64", "win32-x64", "win32-arm64"] as const) {
  it(`stages only the distribution files for ${target}`, async t => {
    const fixture = await extensionFixture(t, target)
    const destination = join(fixture.temporary, "staged")
    assert.equal(await stageVsix(fixture.root, destination, target), `codem-0.2.0-${target}.vsix`)
    const files = await listFiles({ cwd: destination, packageManager: PackageManager.None })
    assert.deepEqual(files.map(file => file.replaceAll("\\", "/")).sort(), [...fixture.expectedFiles].sort())
    const manifest = JSON.parse(await readFile(join(destination, "package.json"), "utf8"))
    for (const key of ["scripts", "dependencies", "devDependencies", "private", "files"]) assert.equal(manifest[key], undefined)
    assert.equal(manifest.main, "./dist/extension.cjs")
    assert.deepEqual(manifest.engines, { vscode: "^1.105.1" })
    await assert.rejects(stageVsix(fixture.root, destination, target), /EEXIST/)
  })
}

it("rejects a wrong runtime target, corrupt executable and missing webview before producing a VSIX", async t => {
  const fixture = await extensionFixture(t, "win32-x64")
  const destination = join(fixture.temporary, "staged")
  await assert.rejects(stageVsix(fixture.root, destination, "win32-arm64"), /this host requires/)
  await writeFile(join(fixture.root, "bin/app-server/codem-core.exe"), "corrupt")
  await assert.rejects(stageVsix(fixture.root, destination, "win32-x64"), /SHA-256 mismatch/)
  await writeFile(join(fixture.root, "bin/app-server/codem-core.exe"), "fixture binary")
  await rm(join(fixture.root, "dist/webview.js"))
  await assert.rejects(stageVsix(fixture.root, destination, "win32-x64"), /ENOENT/)
})

it("the pinned vsce packages the staged extension without npm workspace resolution or credentials", async t => {
  const fixture = await extensionFixture(t, "win32-x64")
  const destination = join(fixture.temporary, "staged")
  const name = await stageVsix(fixture.root, destination, "win32-x64")
  const archive = join(fixture.temporary, name)
  await createVSIX({ cwd: destination, packagePath: archive, target: "win32-x64", dependencies: false })
  const bytes = await readFile(archive)
  assert.equal(bytes.readUInt32LE(0), 0x04034b50)
  assert.ok(bytes.includes(Buffer.from("extension.vsixmanifest")))
  assert.ok(bytes.includes(Buffer.from("extension/bin/app-server/codem-core.exe")))
  assert.ok(!bytes.includes(Buffer.from(".env")))
})

async function extensionFixture(t: TestContext, target: AppServerRuntimeTarget) {
  const temporary = await mkdtemp(join(tmpdir(), "codem vsix 中文 "))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = join(temporary, "source")
  const executableName = target.startsWith("win32") ? "codem-core.exe" : "codem-core"
  const authExecutableName = target.startsWith("win32") ? "codem-auth.exe" : "codem-auth"
  const expectedFiles = ["package.json", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.txt", "dist/extension.cjs", "dist/webview.js", "dist/webview.css", "assets/codem.png", "assets/codemMark.svg", "assets/codemActivity.svg", ...["runtime.json", "LICENSE.core", "LICENSE.auth", executableName, authExecutableName].map(name => `bin/app-server/${name}`)]
  const files = [...expectedFiles.filter(file => !["README.md", "THIRD_PARTY_NOTICES.txt"].includes(file)), "packaging/README.md", "dist/THIRD_PARTY_NOTICES.txt", ".env", "dist/extension.cjs.map", "dist/extensionSmoke.cjs", "dist/previewNavigation.js", "src/secret.ts", "node_modules/unused/index.js"]
  for (const file of files) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), "fixture binary") }
  for (const file of [executableName, authExecutableName]) await chmod(join(root, "bin/app-server", file), 0o755)
  const digest = createHash("sha256").update("fixture binary").digest("hex")
  await writeFile(join(root, "bin/app-server/runtime.json"), JSON.stringify({ schemaVersion: 2, target, packageName: appServerRuntimePackageName(target), coreVersion: APP_SERVER_CORE_VERSION, executableName, sha256: digest, authPackageName: appServerAuthPackageName(target), cliVersion: APP_SERVER_CLI_VERSION, authExecutableName, authSha256: digest }))
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "codem", displayName: "CodeM", description: "VSIX fixture", publisher: "codem", activationEvents: ["onCommand:codem.open"], license: "MIT", version: "0.2.0", main: "./dist/extension.cjs", engines: { vscode: "^1.105.1" }, repository: { type: "git", url: "https://github.com/linmi/codem-vscode.git" }, private: true, scripts: { "vscode:prepublish": "must-not-execute" }, dependencies: { "@codem/app-server": "workspace:*" }, devDependencies: { "@vscode/vsce": "4.0.0" }, files: ["**"] }))
  return { temporary, root, expectedFiles }
}
