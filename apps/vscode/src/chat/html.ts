import { accountAvatarSources } from "../shared/accountAvatar.ts"
import { randomBytes } from "node:crypto"

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
}

export function chatHtml(resources: { script: string; style: string; logo: string; cspSource: string; surface: "sidebar" | "editor" }): string {
  const nonce = randomBytes(24).toString("base64")
  const source = escapeHtml(resources.cspSource)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${source} data: ${accountAvatarSources}; style-src ${source} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="${escapeHtml(resources.style)}"><title>CodeM</title></head>
<body>
<div id="codem-root" data-surface="${resources.surface}" data-logo="${escapeHtml(resources.logo)}"></div>
<script nonce="${nonce}" src="${escapeHtml(resources.script)}"></script></body></html>`
}
