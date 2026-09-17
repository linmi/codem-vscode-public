// Console persistence uses the CodeM prefix. Older kilo.* keys are still
// read so existing local sessions keep their last directory and server URL.

export const CONSOLE_STORE = "codem.console"
const LEGACY_CONSOLE_STORE = "kilo.console"
export const SERVER_STORE = "codem.config.server"
const LEGACY_SERVER_STORE = "kilo.config.server"

function readStore(current: string, legacy: string): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(current) ?? window.localStorage.getItem(legacy)
}

function writeStore(current: string, value: string) {
  window.localStorage.setItem(current, value)
}

function clearStore(current: string, legacy: string) {
  window.localStorage.removeItem(current)
  window.localStorage.removeItem(legacy)
}

export function consoleKey(suffix: string) {
  return `${CONSOLE_STORE}.${suffix}`
}

export function readConsole(suffix: string) {
  return readStore(consoleKey(suffix), `${LEGACY_CONSOLE_STORE}.${suffix}`)
}

export function writeConsole(suffix: string, value: string) {
  writeStore(consoleKey(suffix), value)
}

export function clearConsole(suffix: string) {
  clearStore(consoleKey(suffix), `${LEGACY_CONSOLE_STORE}.${suffix}`)
}

export function readServer() {
  return readStore(SERVER_STORE, LEGACY_SERVER_STORE) ?? ""
}

export function writeServer(url: string) {
  writeStore(SERVER_STORE, url)
}

export function clearServer() {
  clearStore(SERVER_STORE, LEGACY_SERVER_STORE)
}
