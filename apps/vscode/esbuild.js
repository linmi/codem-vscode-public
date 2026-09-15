const esbuild = require("esbuild")
const fs = require("node:fs")
const path = require("node:path")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")
const distDir = path.join(__dirname, "dist")

const problemMatcher = {
  name: "codem-problem-matcher",
  setup(build) {
    build.onStart(() => console.log("[watch] build started"))
    build.onEnd((result) => {
      for (const error of result.errors) console.error(`[build] ${error.text}`)
      console.log("[watch] build finished")
    })
  },
}

function extensionConfig() {
  return {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    target: "node20",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "info",
    plugins: watch ? [problemMatcher] : [],
  }
}

function webviewConfig() {
  return {
    entryPoints: { "codem-webview": "webview-ui/codem/index.tsx" },
    bundle: true,
    format: "esm",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    target: "es2022",
    outdir: "dist",
    logLevel: "info",
    plugins: watch ? [problemMatcher] : [],
  }
}

async function main() {
  if (production) fs.rmSync(distDir, { recursive: true, force: true })
  if (watch) {
    const [extension, webview] = await Promise.all([
      esbuild.context(extensionConfig()),
      esbuild.context(webviewConfig()),
    ])
    await Promise.all([extension.watch(), webview.watch()])
    return
  }
  await Promise.all([esbuild.build(extensionConfig()), esbuild.build(webviewConfig())])
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
