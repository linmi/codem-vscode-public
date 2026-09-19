import { randomBytes } from "node:crypto"
import { uiIcon } from "./uiIcons.ts"

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
}

export function chatHtml(resources: { script: string; style: string; logo: string; cspSource: string }): string {
  const nonce = randomBytes(24).toString("base64")
  const source = escapeHtml(resources.cspSource)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${source}; style-src ${source}; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="${escapeHtml(resources.style)}"><title>CodeM</title></head>
<body>
<div class="app" data-phase="initializing">
  <header class="sessionHeader"><span class="sessionTitle"><span class="projectIcon">${uiIcon("folder")}</span><span id="sessionTitle">新会话</span><span class="statusDot" id="statusDot" title="连接状态"></span></span><div class="headerActions">
    <button class="iconButton" id="toggleResources" title="文件与工具" aria-label="文件与工具" aria-controls="activityPanel" aria-expanded="false">${uiIcon("panel")}</button>
    <button class="iconButton" id="newChat" title="新建会话" aria-label="新建会话">${uiIcon("plus")}</button>
    <button class="iconButton" id="showOutput" title="查看 CodeM 日志" aria-label="查看 CodeM 日志">${uiIcon("terminal")}</button>
  </div></header>
  <div class="timelineArea">
  <main id="scrollArea">
    <section class="transcriptLoading" id="transcriptLoading" role="status" aria-live="polite"><span class="loadingSpinner" aria-hidden="true"></span><span id="loadingLabel">正在初始化 CodeM…</span><div class="loadingLines" aria-hidden="true"><i></i><i></i><i></i></div></section>
    <section class="welcome" id="welcome" aria-labelledby="welcomeTitle">
      <img class="brandMark" src="${escapeHtml(resources.logo)}" alt="CodeM" width="40" height="40">
      <h1 id="welcomeTitle">我们一起做点什么？</h1>
    </section>
    <section id="messages" class="messages" role="log" aria-label="对话记录" aria-live="off"></section>
    <div id="workingRow" class="workingRow" role="status" aria-live="polite" hidden><span class="loadingSpinner" aria-hidden="true"></span><span id="workingLabel"></span></div>
  </main>
  <button class="jumpLatest" id="jumpLatest" hidden aria-label="回到最新消息">${uiIcon("arrowUp")}</button>
  </div>
  <footer>
    <div id="connection" class="connection"><p>连接工作区，开始与 CodeM 协作。</p><div><button id="connect" class="primaryButton">连接工作区</button><button id="signIn" class="textButton">登录 CodeM</button></div></div>
    <section class="activityPanel" id="activityPanel" hidden aria-label="文件与工具"><div class="resourceHeader"><strong>文件与工具</strong><button type="button" id="closeResources" class="iconButton" aria-label="关闭文件与工具">${uiIcon("close")}</button></div>
      <section aria-label="文件差异"><h2>文件差异</h2><div id="diffs">尚无文件差异</div></section>
      <section aria-label="后台任务"><h2>后台任务</h2><div class="panelActions"><button type="button" id="refreshBackground">刷新</button><button type="button" id="cleanBackground" title="清理后台终端资源">清理终端</button></div><div id="background">尚无后台进程</div><div id="backgroundTasks"></div></section>
      <section aria-label="MCP 工具"><h2>MCP 与工具</h2><div id="mcpNames">未启用额外 MCP 服务器</div><div class="panelActions"><button type="button" id="manageMcp">管理 MCP</button><button type="button" id="refreshTools">加载可用工具</button></div><p class="toolHint">Core 按需发现 MCP 工具；可在对话中请求使用服务器，工具列表不代表连接状态。</p><div id="tools"></div></section>
    </section>
    <p id="notice" class="notice" role="status" hidden></p>
    <form id="composer" class="composer">
      <div id="attachments" class="attachments" aria-label="待发送附件"></div>
      <label class="visuallyHidden" for="prompt">发送给 CodeM 的消息</label>
      <textarea id="prompt" rows="2" maxlength="32000" placeholder="提出问题，或描述你想实现的功能…" spellcheck="false"></textarea>
      <div class="composerToolbar">
        <div class="composerLeading"><button type="button" id="addAttachment" class="iconButton" title="添加文件、图片或文件夹" aria-label="添加附件">${uiIcon("plus")}</button><button type="button" id="selectPermission" class="iconButton permission" title="默认权限" aria-label="权限模式：默认权限">${uiIcon("shield")}</button></div>
        <div class="composerTrailing"><button type="button" id="selectWorkMode" class="optionButton" title="切换工作模式">Agent</button><button type="button" id="selectModel" class="optionButton" title="模型与思考强度" aria-label="模型与思考强度"><img src="${escapeHtml(resources.logo)}" alt="" width="14" height="14"><span id="model">Auto</span><span id="effortLabel">medium</span>${uiIcon("chevronDown")}<span class="modelLoading" aria-hidden="true"><span class="loadingSpinner"></span>加载模型…</span></button>
          <button class="sendButton" id="send" type="submit" title="发送消息 · Enter" aria-label="发送消息" disabled>${uiIcon("arrowUp")}</button>
          <button class="stopButton" id="stop" type="button" title="停止生成" aria-label="停止生成" hidden>${uiIcon("stop")}</button>
        </div>
      </div>
    </form>
    <div class="footerMeta"><span class="environment">${uiIcon("monitor")}<span>本地</span></span><span class="workspaceLabel">${uiIcon("folder")}<span id="workspace">未连接工作区</span></span><span class="keyboardHint" id="status" role="status" aria-live="polite" title="Enter 发送 · Shift + Enter 换行">Enter 发送 · Shift + Enter 换行</span></div>
  </footer>
</div><script nonce="${nonce}" src="${escapeHtml(resources.script)}"></script></body></html>`
}
