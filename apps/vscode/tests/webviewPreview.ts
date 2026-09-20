/** Isolated visual fixture. No extension, credentials, Core process, or real model requests. */
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parsePreviewSearch } from "./previewState.ts"
import { chatHtml } from "../src/chat/html.ts"


const port = 4318
const routes: Record<string, { path: string; type: string }> = {
  "/previewDashboard.png": { path: "./fixtures/previewDashboard.png", type: "image/png" },
  "/previewNavigation.js": { path: "../dist/previewNavigation.js", type: "text/javascript" },
  "/preview.css": { path: "./preview.css", type: "text/css" },
  "/webview.js": { path: "../dist/webview.js", type: "text/javascript" },
  "/webview.css": { path: "../dist/webview.css", type: "text/css" },
  "/logo.svg": { path: "../assets/codemMark.svg", type: "image/svg+xml" },
}
createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`)
  if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return }
  if (url.pathname === "/") {
    let search
    try { search = parsePreviewSearch(Object.fromEntries(url.searchParams)) }
    catch (error) { response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); response.end(String(error)); return }
    const theme = search.theme === "dark" ? "vscode-dark" : "vscode-light"
    let html = chatHtml({ surface: "editor", script: "/webview.js", style: "/webview.css", logo: "/logo.svg", cspSource: `http://127.0.0.1:${port}` })
    const nonce = html.match(/nonce="([^"]+)"/)![1]
    html = html.replace("</head>", '<link rel="stylesheet" href="/preview.css"></head>').replace("<body>", `<body class="${theme}"><aside id="previewNavigation" class="previewNavigation" aria-label="模拟预览导航"></aside><script nonce="${nonce}" src="/previewNavigation.js"></script>`)
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return
  }
  const route = routes[url.pathname]
  if (!route) { response.writeHead(404); response.end(); return }
  try {
    response.setHeader("Content-Type", route.type)
    response.end(readFileSync(fileURLToPath(new URL(route.path, import.meta.url))))
  } catch { response.writeHead(404); response.end() }
}).listen(port, "127.0.0.1", () => console.log(`CodeM visual fixture: http://127.0.0.1:${port} (mock transport only)`))
