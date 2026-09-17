import { MEMORY_USAGE } from "../types/messages/leftover.ts"
import type { MemoryOperation } from "../types/messages/leftover.ts"

export { MEMORY_USAGE }

type Help = {
  kind: "help"
}

type Show = {
  kind: "show"
  rest?: string
}

type Operation =
  | {
      kind: "operation"
      operation: "remember" | "correct"
      text: string
    }
  | {
      kind: "operation"
      operation: "forget"
      query: string
    }
  | {
      kind: "operation"
      operation: "auto"
      mode: "on" | "off"
    }
  | {
      kind: "operation"
      operation: "purge"
      confirm: true
    }
  | {
      kind: "operation"
      operation: Exclude<MemoryOperation, "remember" | "correct" | "forget" | "purge" | "auto">
      rest?: string
    }

type Usage = {
  kind: "usage"
  reason: string
}

export type ParsedMemoryCommand = Help | Show | Operation | Usage

function split(input: string) {
  const match = input.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/)
  return {
    head: match?.[1]?.toLowerCase(),
    tail: (match?.[2] ?? "").trim(),
  }
}

function target(input: string) {
  const parts = split(input)
  if (parts.head === "project") return { rest: parts.tail }
  if (parts.head === "personal") return { rest: parts.tail, error: "Personal memory is not supported." }
  return { rest: input.trim() }
}

function usage(reason: string): ParsedMemoryCommand {
  return { kind: "usage", reason }
}

function operation(verb: string, text: string): ParsedMemoryCommand | undefined {
  if (verb === "on" || verb === "enable") return { kind: "operation", operation: "enable", rest: text }
  if (verb === "off" || verb === "disable") return { kind: "operation", operation: "disable", rest: text }
  if (verb === "status" || verb === "inspect" || verb === "rebuild") {
    return { kind: "operation", operation: verb, rest: text }
  }
  if (verb === "purge") {
    if (text.toLowerCase() === "confirm") return { kind: "operation", operation: "purge", confirm: true }
    return usage("Purge requires confirmation. Run /memory purge confirm.")
  }
  if (verb === "auto" || verb === "auto-consolidate") {
    const mode = text.toLowerCase()
    if (mode === "on" || mode === "off") return { kind: "operation", operation: "auto", mode }
    return usage("Missing auto mode. Run /memory auto on or /memory auto off.")
  }
  if (verb === "remember") {
    if (text) return { kind: "operation", operation: "remember", text }
    return usage("Missing text.")
  }
  if (verb === "correct") {
    if (text) return { kind: "operation", operation: "correct", text }
    return usage("Missing correction.")
  }
  if (verb === "forget") {
    if (text) return { kind: "operation", operation: "forget", query: text }
    return usage("Missing query.")
  }
}

function blocked(verb: string): ParsedMemoryCommand | undefined {
  if (verb === "use-personal" || verb === "personal-context" || verb === "personal-in-project") {
    return usage("Personal memory is not supported.")
  }
}

function parse(input: string): ParsedMemoryCommand | undefined {
  const match = input.trim().match(/^\/(?:memory|mem)(?:\s+([\s\S]*))?$/i)
  if (!match) return
  const body = (match[1] ?? "").trim()
  if (!body) return { kind: "help" }

  const picked = target(body)
  if (picked.error) return usage(picked.error)
  const parts = split(picked.rest)
  const verb = parts.head
  if (!verb) return { kind: "help" }
  if (verb === "show") return { kind: "show", rest: parts.tail }

  const op = operation(verb, parts.tail)
  if (op) return op
  const denied = blocked(verb)
  if (denied) return denied
  return usage(`Unknown memory action: ${verb}.`)
}

export function parseMemoryCommand(input: string): ParsedMemoryCommand | undefined {
  const parsed = parse(input)
  if (parsed?.kind !== "usage") return parsed
  return { ...parsed, reason: `${parsed.reason}\n${MEMORY_USAGE}` }
}
