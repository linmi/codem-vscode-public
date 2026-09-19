import { randomBytes } from "node:crypto"

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
<div class="app">
  <header class="sessionHeader"><span class="sessionTitle"><span class="statusDot" id="statusDot"></span><span id="sessionTitle">新会话</span></span><div class="headerActions">
    <button class="iconButton" id="newChat" title="新建会话" aria-label="新建会话"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg></button>
    <button class="iconButton" id="showOutput" title="查看 CodeM 日志" aria-label="查看 CodeM 日志"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 5 5 5-5 5m7 0h5"/></svg></button>
  </div></header>
  <main id="scrollArea">
    <section class="welcome" id="welcome" aria-labelledby="welcomeTitle">
      <img class="brandMark" src="${escapeHtml(resources.logo)}" alt="CodeM" width="44" height="35">
      <h1 id="welcomeTitle">想一起做点什么？</h1><p class="subtitle">理解项目，梳理思路，开始构建。</p>
      <div class="suggestions" aria-label="开始一个话题">
        <button data-prompt="先帮我了解这个项目的结构和主要模块，暂时不要修改代码。"><span class="suggestionIcon">⌘</span><span>了解这个项目<small>从目录结构和核心模块开始</small></span><span class="arrow">↗</span></button>
        <button data-prompt="帮我审查当前代码，找出最值得优先解决的问题，先给出分析。"><span class="suggestionIcon">⌕</span><span>一起检查代码<small>发现问题，找到改进方向</small></span><span class="arrow">↗</span></button>
        <button data-prompt="我想实现一个新功能，请先和我一起明确需求和实现方案。"><span class="suggestionIcon">＋</span><span>构建一个新功能<small>把想法变成清晰的下一步</small></span><span class="arrow">↗</span></button>
      </div>
    </section>
    <section id="messages" class="messages" role="log" aria-label="对话记录" aria-live="off"></section>
  </main>
  <footer>
    <div id="connection" class="connection"><p>连接工作区，开始与 CodeM 协作。</p><div><button id="connect" class="primaryButton">连接工作区</button><button id="signIn" class="textButton">登录 CodeM</button></div></div>
    <details class="activityPanel" id="activityPanel"><summary>文件差异 · 后台任务 · MCP</summary>
      <section aria-label="文件差异"><h2>文件差异</h2><div id="diffs">尚无文件差异</div></section>
      <section aria-label="后台任务"><h2>后台任务</h2><div class="panelActions"><button type="button" id="refreshBackground">刷新</button><button type="button" id="cleanBackground" title="清理后台终端资源">清理终端</button></div><div id="background">尚无后台进程</div><div id="backgroundTasks"></div></section>
      <section aria-label="MCP 工具"><h2>MCP 与工具</h2><div id="mcpNames">未启用额外 MCP 服务器</div><div class="panelActions"><button type="button" id="manageMcp">管理 MCP</button><button type="button" id="refreshTools">加载可用工具</button></div><p class="toolHint">Core 按需发现 MCP 工具；可在对话中请求使用服务器，工具列表不代表连接状态。</p><div id="tools"></div></section>
    </details>
    <p id="notice" class="notice" role="status" hidden></p>
    <form id="composer" class="composer">
      <div id="attachments" class="attachments" aria-label="待发送附件"></div>
      <label class="visuallyHidden" for="prompt">发送给 CodeM 的消息</label>
      <textarea id="prompt" rows="3" maxlength="32000" placeholder="描述你想构建的内容…" spellcheck="false"></textarea>
      <div class="composerToolbar"><div class="options"><button type="button" id="addAttachment" class="optionButton" title="添加文件、图片或文件夹" aria-label="添加附件">＋</button><button type="button" id="selectWorkMode" class="optionButton" title="切换工作模式">Agent</button><button type="button" id="selectModel" class="optionButton" title="选择模型"><span id="model">Auto</span></button><button type="button" id="selectEffort" class="optionButton" title="思考强度">medium</button></div>
        <button class="sendButton" id="send" type="submit" title="发送消息 · Enter" aria-label="发送消息" disabled><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m-5 5 5-5 5 5"/></svg></button>
        <button class="stopButton" id="stop" type="button" title="停止生成" aria-label="停止生成" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1"/></svg></button>
      </div>
    </form>
    <div class="footerMeta"><span id="workspace">未连接工作区</span><button type="button" id="selectPermission" class="optionButton permission" title="切换权限模式">◈ 默认权限</button></div>
    <div class="keyboardHint" id="status" role="status" aria-live="polite">Enter 发送 · Shift + Enter 换行</div>
  </footer>
</div><script nonce="${nonce}" src="${escapeHtml(resources.script)}"></script></body></html>`
}
