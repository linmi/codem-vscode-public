export const CODEM_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function assertValidCodeMSessionId(sessionId: string): void {
  if (!CODEM_SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid CodeM CLI session id: ${sessionId}`)
  }
}
