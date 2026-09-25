import { readFile, readdir, realpath } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

/** Collect notices from packages actually included by esbuild, not the development dependency tree. */
export async function bundleNotices(root: string, inputs: readonly string[]): Promise<string> {
  const packages = new Set<string>()
  for (const input of inputs) {
    if (!input.replaceAll("\\", "/").includes("node_modules/")) continue
    let directory = dirname(await realpath(resolve(root, input)))
    while (true) {
      const manifest = await readFile(join(directory, "package.json"), "utf8").then(text => JSON.parse(text) as { name?: string; version?: string }, error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
        throw error
      })
      // Packages may have nested { "type": "module" } manifests; their license lives at the package root.
      if (manifest?.name && manifest.version) break
      const parent = dirname(directory)
      if (parent === directory) throw new Error(`Cannot locate package notice for ${input}`)
      directory = parent
    }
    packages.add(directory)
  }
  const notices: { name: string; text: string }[] = []
  for (const directory of packages) {
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name: string; version: string }
    const files = (await readdir(directory)).filter(name => /^(?:licen[cs]e|copying)(?:$|[. -])/i.test(name)).sort()
    // This npm release omits LICENSE; the upstream notice source is recorded in packaging.md.
    const texts = manifest.name === "react-remove-scroll-bar" && manifest.version === "2.3.8"
      ? [await readFile(join(root, "packaging/reactRemoveScrollBarLicense.txt"), "utf8")]
      : await Promise.all(files.map(file => readFile(join(directory, file), "utf8")))
    if (!texts.length) throw new Error(`Missing license text for bundled dependency ${manifest.name}@${manifest.version}`)
    notices.push({ name: manifest.name, text: `## ${manifest.name}@${manifest.version}\n\n${texts.join("\n\n")}` })
  }
  const ui = await readFile(join(root, "packaging/uiNotices.txt"), "utf8")
  // The bundled shadcn components are @codem/ui sources; their MIT notice ships beside them.
  const shadcn = await readFile(join(root, "node_modules/@codem/ui/src/components/shadcnLicense.md"), "utf8")
  return `# Third-party notices\n\n${ui}\n## shadcn/ui\n\n${shadcn}\n${notices.sort((a, b) => a.name.localeCompare(b.name)).map(notice => notice.text).join("\n\n")}\n`
}
