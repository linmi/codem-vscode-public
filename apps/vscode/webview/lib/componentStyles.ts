import { setNonce } from "get-nonce"

// Radix viewport and scroll-lock styles use the same per-document CSP nonce.
const script = document.querySelector<HTMLScriptElement>("script[nonce]")
if (!script?.nonce) throw new Error("Missing Webview component style nonce")
export const componentStyleNonce = script.nonce
setNonce(componentStyleNonce)
