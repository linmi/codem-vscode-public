import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { appServerRuntimeTarget, resolveBundledAppServerRuntime, type AppServerRuntimeTarget } from "@codem/app-server"

export function packageTarget(requested: string | undefined, platform: NodeJS.Platform = process.platform, arch = process.arch): AppServerRuntimeTarget {
  const native = appServerRuntimeTarget(platform, arch)
  if (requested !== undefined && requested !== native) throw new Error(`VSIX target ${requested} does not match this build host (${native}); build on the matching native runner`)
  return native
}

/** Copy an explicit distribution surface into an empty, task-owned directory. */
export async function stageVsix(root: string, destination: string, target: AppServerRuntimeTarget): Promise<string> {
  const [platform, arch] = target.split("-")
  await resolveBundledAppServerRuntime({ extensionRoot: root, platform: platform as NodeJS.Platform, arch })
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>
  if (manifest.name !== "codem" || typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Invalid CodeM VSIX name or version")
  if (manifest.main !== "./dist/extension.cjs") throw new Error("Unexpected CodeM VSIX entrypoint")
  for (const key of ["scripts", "dependencies", "devDependencies", "packageManager", "files", "private"]) delete manifest[key]
  const windows = platform === "win32"
  const files = [
    ["LICENSE", "LICENSE"], ["packaging/README.md", "README.md"],
    ["dist/extension.cjs", "dist/extension.cjs"], ["dist/webview.js", "dist/webview.js"], ["dist/webview.css", "dist/webview.css"],
    ["dist/THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
    ...["codem.png", "codemMark.svg", "codemActivity.svg"].map(name => [`assets/${name}`, `assets/${name}`]),
    ...["runtime.json", "LICENSE.core", "LICENSE.auth", windows ? "codem-core.exe" : "codem-core", windows ? "codem-auth.exe" : "codem-auth"]
      .map(name => [`bin/app-server/${name}`, `bin/app-server/${name}`]),
  ]
  // The caller owns this fresh directory. Existing staging contents are never reused.
  await mkdir(destination)
  for (const [source, output] of files) {
    const from = join(root, source!)
    if (!(await stat(from)).isFile()) throw new Error(`VSIX input is not a regular file: ${source}`)
    const to = join(destination, output!)
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
  }
  await writeFile(join(destination, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  // Recheck the copied executables and their digests, not just the build directory.
  await resolveBundledAppServerRuntime({ extensionRoot: destination, platform: platform as NodeJS.Platform, arch })
  return `codem-${manifest.version}-${target}.vsix`
}
