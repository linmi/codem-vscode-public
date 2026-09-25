/**
 * Per-delta cost of publishing a streaming chat snapshot, by conversation size. No Core, no VS Code.
 * Stages: Host controller update and publish; VS Code postMessage serialization (simulated with JSON);
 * the Webview bridge; the shared UI's own `asSnapshot` in ChatApp.
 *
 *   node --experimental-strip-types apps/vscode/scripts/benchmarkSnapshots.ts [--messages 10,500] [--deltas 200]
 */
import { asSnapshot } from "@codem/ui/contract"
import { VscodeHostBridge } from "../webview/host/vscodeHostBridge.ts"
import type { ChatSnapshot } from "../src/shared/messages.ts"
import { streamingConversation } from "../tests/streamingScenario.ts"

const option = (name: string, fallback: string) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] ?? fallback }
const sizes = option("--messages", "10,100,500").split(",").map(Number)
const deltas = Number(option("--deltas", "200"))

const wire = JSON.stringify.bind(JSON)
const unwire = JSON.parse.bind(JSON)
const clone = globalThis.structuredClone
const counters = { clones: 0, clonedMessages: 0, stringifies: 0, stringifiedBytes: 0 }
globalThis.structuredClone = ((value: unknown, options?: Parameters<typeof structuredClone>[1]) => {
  counters.clones++
  const messages = (value as { messages?: unknown } | null)?.messages
  if (Array.isArray(messages)) counters.clonedMessages += messages.length
  return clone(value, options)
}) as typeof structuredClone
JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
  const text = wire(...args)
  counters.stringifies++; counters.stringifiedBytes += text?.length ?? 0
  return text
}) as typeof JSON.stringify

/** Messages that did not change but arrive as different objects: work spent on unchanged content. */
function recopied(previous: readonly { id: string }[] | undefined, next: readonly { id: string; text: string }[], changed: string): number {
  if (!previous) return 0
  const byId = new Map(previous.map(message => [message.id, message]))
  return next.filter(message => message.id !== changed && byId.has(message.id) && byId.get(message.id) !== message).length
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
const format = (value: number) => value.toFixed(3)

for (const size of sizes) {
  const stage = { host: [] as number[], transport: [] as number[], bridge: [] as number[], app: [] as number[] }
  const bridge = new VscodeHostBridge()
  let hostPrevious: ChatSnapshot | undefined, bridgePrevious: ReturnType<typeof asSnapshot> | undefined
  let hostRecopied = 0, bridgeRecopied = 0, bytes = 0
  let consumer = 0
  let bridgeCounters = { clones: 0, stringifies: 0, stringifiedBytes: 0 }
  const conversation = await streamingConversation(size, state => {
    const started = performance.now()
    hostRecopied += recopied(hostPrevious?.messages, state.messages, "turn-1:streaming")
    hostPrevious = state
    const encoded = wire(state)
    bytes += encoded.length
    const received = unwire(encoded) as unknown
    const transported = performance.now()
    const before = { ...counters }
    const update = bridge.receive(received)!
    const bridged = performance.now()
    bridgeCounters = { clones: bridgeCounters.clones + counters.clones - before.clones, stringifies: bridgeCounters.stringifies + counters.stringifies - before.stringifies, stringifiedBytes: bridgeCounters.stringifiedBytes + counters.stringifiedBytes - before.stringifiedBytes }
    bridgeRecopied += recopied(bridgePrevious?.messages, update.snapshot.messages, "turn-1:streaming")
    bridgePrevious = update.snapshot
    asSnapshot(update.snapshot)
    const applied = performance.now()
    stage.transport.push(transported - started); stage.bridge.push(bridged - transported); stage.app.push(applied - bridged)
    consumer += applied - started
  })
  // Prime the bridge with the full conversation, as a Webview holds it before streaming.
  bridge.receive(unwire(wire(conversation.controller.snapshot())))
  bridgePrevious = undefined
  const hostBefore = { ...counters }
  for (let index = 0; index < deltas; index++) {
    consumer = 0
    const started = performance.now()
    conversation.stream("流式增量 token ")
    stage.host.push(performance.now() - started - consumer)
  }
  const host = { clones: counters.clones - hostBefore.clones - bridgeCounters.clones, clonedMessages: counters.clonedMessages - hostBefore.clonedMessages, stringifies: counters.stringifies - hostBefore.stringifies - bridgeCounters.stringifies }
  const messages = conversation.controller.snapshot().messages.length
  console.log(`\n${messages} messages, ${deltas} deltas, ${Math.round(bytes / deltas / 1024)} KiB per posted state`)
  console.log(`  median ms/delta  host ${format(median(stage.host))}  postMessage(JSON) ${format(median(stage.transport))}  bridge ${format(median(stage.bridge))}  ChatApp asSnapshot ${format(median(stage.app))}`)
  console.log(`  per delta        host clones ${host.clones / deltas}  host cloned messages ${host.clonedMessages / deltas}  host stringifies ${host.stringifies / deltas}  unchanged messages re-created by host ${hostRecopied / deltas}`)
  console.log(`                   bridge clones ${bridgeCounters.clones / deltas}  bridge stringifies ${bridgeCounters.stringifies / deltas} (${Math.round(bridgeCounters.stringifiedBytes / deltas / 1024)} KiB)  unchanged messages re-normalized by bridge ${bridgeRecopied / deltas}`)
  await conversation.controller.dispose()
}
