/**
 * Normalize http/https URLs so IDN/Unicode hostnames become punycode ASCII.
 * Copied out of packages/opencode so the webview no longer deep-imports the CLI.
 */
export function normalizeUrls(text: string) {
  return text.replace(/https?:\/\/\S+/g, (match) => {
    const stripped = match.replace(/[.,!?;:)"'\]>]+$/, "")
    const tail = match.slice(stripped.length)
    try {
      const parsed = new URL(stripped)
      const afterScheme = stripped.indexOf("//") + 2
      const slashPos = stripped.indexOf("/", afterScheme)
      const rawHost = slashPos === -1 ? stripped.slice(afterScheme) : stripped.slice(afterScheme, slashPos)
      const colon = rawHost.indexOf(":")
      const rawHostname = colon === -1 ? rawHost : rawHost.slice(0, colon)
      if (rawHostname === parsed.hostname) return match
      return stripped.replace(rawHostname, parsed.hostname) + tail
    } catch {
      return match
    }
  })
}
