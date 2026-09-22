/** Directory intents shared by both the Webview and Host validators. */
export const catalogKinds = ["skills", "environment", "config", "hooks", "plugins", "permissions", "spaces", "provider", "live", "tools"] as const
export type CatalogKind = typeof catalogKinds[number]
