import { createServer } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(root, "dist")
const port = Number(process.env.CODEM_UI_PREVIEW_PORT ?? 4320)

if (!existsSync(join(dist, "preview.html"))) {
  console.error("Build @codem/ui first: pnpm --filter @codem/ui build")
  process.exit(1)
}

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`)
  const file = url.pathname === "/" || url.pathname === "/preview.html"
    ? "preview.html"
    : url.pathname === "/index.html"
      ? "index.html"
      : url.pathname.replace(/^\//, "")
  const allowed = new Set(["preview.html", "index.html", "preview.js", "browser.js", "styles.css"])
  if (!allowed.has(file)) {
    response.writeHead(404)
    response.end()
    return
  }
  const ext = file.slice(file.lastIndexOf("."))
  response.setHeader("Content-Type", types[ext] ?? "text/plain")
  response.end(readFileSync(join(dist, file)))
}).listen(port, "127.0.0.1", () => {
  console.log(`CodeM dual-host UI preview: http://127.0.0.1:${port}/?host=jetbrains`)
})
