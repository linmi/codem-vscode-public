export interface TerminalFont {
  fontFamily: string
  fontSize: number
}

const FALLBACK = "Menlo, Monaco, 'Courier New', monospace"
const SIZE = typeof process !== "undefined" && process.platform === "darwin" ? 12 : 14

export function resolveTerminalFont(
  family: string | undefined,
  size: number | undefined,
  editor: string | undefined,
): TerminalFont {
  return {
    fontFamily: family?.trim() || editor?.trim() || FALLBACK,
    fontSize: size ?? SIZE,
  }
}
