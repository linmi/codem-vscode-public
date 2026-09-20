import { randomBytes } from "node:crypto"
import { uiIcon } from "../shared/uiIcons.ts"

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
}

export function chatHtml(resources: { script: string; style: string; logo: string; cspSource: string; surface: "sidebar" | "editor" }): string {
  const nonce = randomBytes(24).toString("base64")
  const source = escapeHtml(resources.cspSource)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${source} data:; style-src ${source} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="${escapeHtml(resources.style)}"><title>CodeM</title></head>
<body>
<div class="app" data-phase="disconnected">
  <header class="sessionHeader"><span class="sessionTitle"><span class="sessionIcon">${uiIcon("chat")}</span><span id="sessionTitle">新会话</span><span class="statusDot" id="statusDot" title="连接状态"></span></span><div class="headerActions">
    <div id="resourceToolsHost"></div>
    ${resources.surface === "editor" ? `<div class="headerActions" id="standaloneActions"><button class="iconButton" id="newChat" title="新建会话" aria-label="新建会话">${uiIcon("plus")}</button>
    <button class="iconButton" id="showOutput" title="查看 CodeM 日志" aria-label="查看 CodeM 日志">${uiIcon("terminal")}</button></div>` : ""}
  </div></header>
  <div class="timelineArea">
  <main id="scrollArea">
    <section class="transcriptLoading" id="transcriptLoading" hidden role="status" aria-live="polite"><span class="loadingSpinner" aria-hidden="true"></span><span id="loadingLabel">正在恢复会话记录…</span><div class="loadingLines" aria-hidden="true"><i></i><i></i><i></i></div></section>
    <section class="welcome" id="welcome" aria-labelledby="welcomeTitle">
      <img class="brandMark" src="${escapeHtml(resources.logo)}" alt="CodeM" width="40" height="40">
      <h1 id="welcomeTitle">我们一起做点什么？</h1>
    </section>
    <section id="messages" class="messages" role="log" aria-label="对话记录" aria-live="off"></section>
    <div id="workingRow" class="workingRow" role="status" aria-live="polite" hidden><span id="workingLabel"></span></div>
  </main>
  <button class="jumpLatest" id="jumpLatest" hidden aria-label="回到最新消息">${uiIcon("arrowUp")}</button>
  </div>
  <footer>
    <div id="connection" class="connection" hidden><p>连接工作区，开始与 CodeM 协作。</p><div><button id="connect" class="primaryButton">连接工作区</button><button id="signIn" class="textButton">登录 CodeM</button></div></div>
    <p id="notice" class="notice" role="status" hidden></p>
    <form id="composer" class="composer">
      <div id="attachments" class="attachments" aria-label="待发送附件"></div>
      <label class="visuallyHidden" for="prompt">发送给 CodeM 的消息</label>
      <textarea id="prompt" rows="2" maxlength="32000" placeholder="提出问题，或描述你想实现的功能…" spellcheck="false"></textarea>
      <div class="composerToolbar">
        <div class="composerLeading"><span id="attachmentMenu"></span><span id="workModeMenu"></span></div>
        <div class="composerTrailing"><span id="permissionMenu"></span><span id="effortSelector"></span><span id="modelMenu" data-logo="${escapeHtml(resources.logo)}"></span>
          <button class="sendButton" id="send" type="submit" title="发送消息 · Enter" aria-label="发送消息" disabled>${uiIcon("arrowUp")}</button>
          <button class="stopButton" id="stop" type="button" title="停止生成" aria-label="停止生成" hidden>${uiIcon("stop")}</button>
        </div>
      </div>
    </form>
    <div class="footerMeta"><span class="environment">${uiIcon("monitor")}<span>本地</span></span><span id="spaceMenu"></span><span class="workspaceLabel">${uiIcon("folder")}<span id="workspace">未连接工作区</span></span><span id="runtimeDetailsHost"></span><span class="visuallyHidden" id="status" role="status" aria-live="polite"></span></div>
  </footer>
  <span id="composerMenusHost" hidden></span>
</div><script nonce="${nonce}" src="${escapeHtml(resources.script)}"></script></body></html>`
}
