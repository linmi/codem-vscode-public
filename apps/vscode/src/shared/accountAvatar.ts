/** The same allowlist governs profile projection and Webview image CSP. */
const avatarDomains = ["feishucdn.com", "larksuitecdn.com"] as const
export const accountAvatarSources = avatarDomains.flatMap(domain => [`https://${domain}`, `https://*.${domain}`]).join(" ")

export function parseAccountAvatarUrl(value: unknown): string {
  // oxlint-disable-next-line no-control-regex -- Reject control characters before URL normalization.
  if (typeof value !== "string" || !value || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) throw new Error("Invalid account avatar URL")
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.port || !avatarDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw new Error("Unsupported account avatar URL")
  return url.href
}
