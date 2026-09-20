import { createHash } from "node:crypto"

export interface ConversationScope { cwd: string; spaceKey: string; accountKey: string | null }
interface Store { get<T>(key: string): T | undefined; update(key: string, value: unknown): PromiseLike<void> }

/** A workspace-local bookmark only. Core remains the sole owner of conversation content. */
export class ActiveConversation {
  private readonly store: Store
  private pending: Promise<void> = Promise.resolve()
  constructor(store: Store) { this.store = store }

  async load(scope: ConversationScope): Promise<string | null> {
    await this.pending
    const value = this.store.get<unknown>(this.key(scope))
    if (value === undefined) return null
    return threadId(value)
  }

  async save(scope: ConversationScope, id: string | null): Promise<void> {
    const key = this.key(scope)
    const value = id === null ? undefined : threadId(id)
    // Serialize changes, including clears, so an older write cannot resurrect a chat.
    const saving = this.pending.then(() => this.store.update(key, value))
    this.pending = saving.catch(() => {}) // Each caller receives and reports its own failure.
    return saving
  }

  flush(): Promise<void> { return this.pending }

  private key(scope: ConversationScope): string {
    if (!scope.accountKey || !scope.cwd || !scope.spaceKey) throw new Error("Active conversation requires an authenticated account, workspace and space")
    return `codem.activeConversation.${createHash("sha256").update(JSON.stringify([scope.cwd, scope.accountKey, scope.spaceKey])).digest("hex")}`
  }
}

function threadId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\\/]/.test(value) || [...value].some(character => character.charCodeAt(0) < 32) || value === "." || value === "..") throw new Error("Invalid saved Core thread identity")
  return value
}
