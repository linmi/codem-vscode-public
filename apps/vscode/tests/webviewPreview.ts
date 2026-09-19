/** Isolated visual fixture. No extension, credentials, Core process, or real model requests. */
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chatHtml } from "../src/html.ts"
import { initialSnapshot, type ChatSnapshot } from "../src/messages.ts"

import { panelFixtures } from "./panelFixtures.ts"

const fixture: ChatSnapshot = {
  ...initialSnapshot(), phase: "ready", workspace: "codem-plugin", model: "Auto", threadId: "preview",
  messages: [
    { id: "u", role: "user", label: "你", text: "帮我整理登录页面，让状态反馈更清晰。" },
    { id: "r", role: "reasoning", label: "分析登录流程", status: "completed", summary: "检查了登录状态与页面布局", text: "先确认登录、等待授权和已连接三种状态，避免按钮含义重叠。" },
    { id: "t", role: "tool", label: "读取文件 · auth.ts", status: "completed", summary: "已读取 2 个相关文件", text: "src/auth.ts\nsrc/login.ts" },
    { id: "a", role: "assistant", label: "CodeM", text: "## 登录页面\n\n已经整理好状态反馈：\n\n- 明确区分 **未登录**、**等待授权** 和 **已连接**。\n- 取消授权会保留输入内容，可以随时重试。\n\n```ts\nconst status = await readAuthStatus()\nrenderAccount(status)\n```\n\n浏览器授权后会回到当前会话。" },
  ],
}
const port = 4318
const routes: Record<string, { path: string; type: string }> = {
  "/webview.js": { path: "../dist/webview.js", type: "text/javascript" },
  "/webview.css": { path: "../dist/webview.css", type: "text/css" },
  "/logo.svg": { path: "../assets/codemMark.svg", type: "image/svg+xml" },
}
createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`)
  if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return }
  if (url.pathname === "/") {
    const state = structuredClone(fixture)
    if (url.searchParams.has("empty")) { state.messages = []; state.threadId = null }
    const theme = url.searchParams.get("theme") === "dark" ? "vscode-dark" : "vscode-light"
    let html = chatHtml({ script: "/webview.js", style: "/webview.css", logo: "/logo.svg", cspSource: `http://127.0.0.1:${port}` })
    const nonce = html.match(/nonce="([^"]+)"/)![1]
    html = html.replace("<body>", `<body class="${theme}">`).replace('<script nonce=', `<script nonce="${nonce}">
      const demo = ${JSON.stringify(state).replaceAll("<", "\\u003c")};
      const panels = ${JSON.stringify(panelFixtures).replaceAll("<", "\\u003c")};
      let activePanel = panels[${JSON.stringify(url.searchParams.get("panel"))}] ?? null;
      window.panelReplies = [];
      window.acquireVsCodeApi = () => ({getState: () => null, setState: () => {}, postMessage: action => {
        if (action.type === 'selectModel') activePanel = panels.model;
        if (action.type === 'panelReply') { window.panelReplies.push(action); activePanel = null; }
        if (action.type === 'showHistory') demo.history = {...demo.history, open: true, entries: [{id: 'preview', title: '整理登录页面', startedAt: '2026-09-19T12:00:00Z', turnCount: 1, archived: false}]};
        if (action.type === 'closeHistory') demo.history.open = false;
        demo.phase = activePanel ? (activePanel.kind === 'model' ? 'configuring' : 'running') : 'ready';
        window.postMessage(demo, '*');
        window.postMessage({type:'panel',panel:activePanel}, '*');
      }});
      </script><script nonce=`)
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return
  }
  const route = routes[url.pathname]
  if (!route) { response.writeHead(404); response.end(); return }
  try {
    response.setHeader("Content-Type", route.type)
    response.end(readFileSync(fileURLToPath(new URL(route.path, import.meta.url))))
  } catch { response.writeHead(404); response.end() }
}).listen(port, "127.0.0.1", () => console.log(`CodeM visual fixture: http://127.0.0.1:${port} (mock transport only)`))
