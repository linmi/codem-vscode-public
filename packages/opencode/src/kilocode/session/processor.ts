import { SessionNetwork } from "@/session/network"
import type { SessionID } from "@/session/schema"
import type { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Effect, Exit } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { EffectBridge } from "@/effect/bridge"
import type { LLMEvent, ProviderMetadata, Usage } from "@opencode-ai/llm"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionRetry } from "@/session/retry"
import { computeMetrics as computeMetricsHelper, type TokenRates } from "@/kilocode/session/metrics"

export namespace KiloSessionProcessor {
  const log = Log.create({ service: "session.processor.kilo" })
  export const INCOMPLETE_RESPONSE_RETRIES = 2
  export const INCOMPLETE_RESPONSE_MESSAGE =
    "The provider repeatedly ended the response before returning usable output."
  export class IncompleteResponseError extends Error {
    constructor(readonly vercelID?: string) {
      super(INCOMPLETE_RESPONSE_MESSAGE)
      this.name = "IncompleteResponseError"
    }
  }
  export type Attempt = {
    text: boolean
    reasoning: boolean
    tool: boolean
    usage: boolean
    finished: boolean
    finish?: string
  }
  export const OUTPUT_LENGTH_WARNING = "The model hit its output limit, so this response may be incomplete."
  export const REASONING_LENGTH_WARNING =
    "The model hit its output limit while reasoning and produced no actionable output. Try disabling reasoning or increasing the output limit."
  export const PROVIDER_FINISH_ERROR_MESSAGE =
    "The provider ended the response with an error before returning details. Start a new message to retry; Kilo will compact the oversized conversation first if needed."

  /** Pure throughput helper re-exported for namespace symmetry. */
  export const computeMetrics: typeof computeMetricsHelper = computeMetricsHelper
  /** Returned shape for downstream consumers that prefer the namespace. */
  export type Metrics = TokenRates

  export function generationID(meta: ProviderMetadata | undefined) {
    const value = meta?.gateway?.generationId
    if (typeof value !== "string") return
    const id = value.trim()
    if (!/^gen_[A-Za-z0-9_-]{1,200}$/.test(id)) return
    return id
  }

  /**
   * Effect-based offline handler for the retry schedule.
   * Shows offline status, waits for network reconnection or user rejection.
   *
   * Returns:
   * - "retry"   → network restored, retry immediately
   * - "blocked" → user rejected reconnection
   * - "aborted" → abort signal fired
   */
  export function handleOffline(input: {
    error: unknown
    sessionID: SessionID
    abort: AbortSignal
    set: (sessionID: SessionID, status: SessionStatus.Info) => Effect.Effect<void>
  }): Effect.Effect<"retry" | "blocked" | "aborted"> {
    return Effect.gen(function* () {
      const msg = SessionNetwork.message(input.error)

      const { id, promise } = yield* EffectBridge.fromPromise(() =>
        SessionNetwork.ask({
          sessionID: input.sessionID,
          message: msg,
          abort: input.abort,
        }),
      )

      log.warn("session offline", {
        sessionID: input.sessionID,
        requestID: id,
        message: msg,
      })

      yield* input.set(input.sessionID, {
        type: "offline",
        requestID: id,
        message: msg,
      })

      return yield* Effect.promise(() =>
        promise
          .then(() => "retry" as const)
          .catch((err) => {
            if (err instanceof SessionNetwork.RejectedError) return "blocked" as const
            if (err instanceof DOMException && err.name === "AbortError") return "aborted" as const
            throw err
          }),
      )
    })
  }

  /**
   * Returns the Kilo-specific retry policy options (limit + offline handler).
   * Designed to be spread into SessionRetry.policy() opts.
   *
   * The `abort` signal is used by the offline handler to cancel the network
   * reconnection wait when the session is interrupted.
   */
  export function retryOpts(input: {
    sessionID: SessionID
    abort: AbortSignal
    set: (sessionID: SessionID, status: SessionStatus.Info) => Effect.Effect<void>
    used?: number
  }) {
    const limit = Flag.KILO_SESSION_RETRY_LIMIT
    return {
      limit: limit === undefined ? undefined : Math.max(0, limit - (input.used ?? 0)),
      offline: (info: { error: unknown; message: string }) =>
        handleOffline({
          error: info.error,
          sessionID: input.sessionID,
          abort: input.abort,
          set: input.set,
        }),
    }
  }

  export function hasUsage(usage: Usage | undefined) {
    if (!usage) return false
    return [
      usage.inputTokens,
      usage.outputTokens,
      usage.nonCachedInputTokens,
      usage.cacheReadInputTokens,
      usage.cacheWriteInputTokens,
      usage.reasoningTokens,
      usage.totalTokens,
    ].some((value) => value !== undefined && value !== 0)
  }

  export function attempt(): Attempt {
    return { text: false, reasoning: false, tool: false, usage: false, finished: false }
  }

  export function observe(attempt: Attempt, event: LLMEvent) {
    if (event.type === "text-delta" && event.text.trim()) attempt.text = true
    if (event.type === "reasoning-delta" && event.text.trim()) attempt.reasoning = true
    if (event.type === "tool-call" || event.type === "tool-result" || event.type === "tool-error") attempt.tool = true
    if (event.type === "step-finish") {
      attempt.finished = true
      attempt.finish = event.reason
      attempt.usage ||= hasUsage(event.usage)
    }
    if (event.type === "finish" && !attempt.finished) {
      attempt.finish = event.reason
      attempt.usage ||= hasUsage(event.usage)
    }
  }

  export function replayable(input: {
    finish?: string
    text: boolean
    reasoning: boolean
    tool: boolean
    usage: boolean
  }) {
    if (input.finish !== undefined && input.finish !== "unknown") return false
    if (input.text || input.tool) return false
    // Reasoning without text or tools has no actionable output. Retry it through
    // the existing bounded recovery budget instead of silently settling unknown.
    // Keeping this decision here avoids the unbounded loop caused by continuing
    // every unknown finish at the prompt-loop boundary.
    if (input.reasoning) return true
    return !input.usage
  }

  export function blockRetry(error: ReturnType<typeof MessageV2.fromError>) {
    const message = MessageV2.APIError.isInstance(error) ? error.data.message : "Response interrupted after output"
    return new MessageV2.APIError({ message, isRetryable: false }).toObject()
  }

  export function recover(input: {
    run: () => Effect.Effect<void, unknown>
    replayable: () => boolean
    discard: () => Effect.Effect<void>
    set: (info: { attempt: number; message: string; next: number }) => Effect.Effect<void>
  }) {
    return Effect.gen(function* () {
      for (const index of Array.from({ length: INCOMPLETE_RESPONSE_RETRIES + 1 }, (_, index) => index)) {
        const result = yield* input.run().pipe(Effect.exit)
        const error = Exit.isFailure(result) ? Cause.squash(result.cause) : undefined
        if (error && !(error instanceof IncompleteResponseError)) return yield* Effect.fail(error)
        if (!error && !input.replayable()) return

        yield* input.discard()
        if (index === INCOMPLETE_RESPONSE_RETRIES) return yield* Effect.fail(error ?? new IncompleteResponseError())
        const wait = SessionRetry.delay(index + 1)
        yield* input.set({ attempt: index + 1, message: INCOMPLETE_RESPONSE_MESSAGE, next: Date.now() + wait })
        yield* Effect.sleep(`${wait} millis`)
      }
    })
  }

  export function parseError(error: unknown, input: { providerID: ProviderV2.ID; aborted: boolean }) {
    if (!(error instanceof IncompleteResponseError)) return MessageV2.fromError(error, input)
    return new MessageV2.APIError({
      message: error.message,
      isRetryable: true,
      responseHeaders: error.vercelID ? { "x-vercel-id": error.vercelID } : undefined,
    }).toObject()
  }

  /**
   * Guard: if finish reason is "tool-calls" but no tool parts exist,
   * downgrade to "stop" to prevent an infinite loop (#7756).
   */
  export function guardEmptyToolCalls(msg: MessageV2.Assistant, parts: MessageV2.Part[]) {
    if (msg.finish === "tool-calls" && !parts.some((p) => p.type === "tool")) {
      log.warn("empty tool-calls", { messageID: msg.id })
      msg.finish = "stop"
    }
  }

  export function lengthWarning(input: {
    msg: MessageV2.Assistant
    step: { reasoning: boolean; text: boolean; tool: boolean }
  }) {
    if (input.msg.summary) return
    if (input.msg.finish !== "length") return
    if (input.step.reasoning && !input.step.text && !input.step.tool) {
      log.warn("reasoning-only length stop", { messageID: input.msg.id })
      return REASONING_LENGTH_WARNING
    }
    log.warn("length stop", { messageID: input.msg.id })
    return OUTPUT_LENGTH_WARNING
  }

  export function providerFinishError(msg: MessageV2.Assistant) {
    if (msg.finish !== "error") return false
    if (msg.error) return false
    const err = new MessageV2.APIError({
      message: PROVIDER_FINISH_ERROR_MESSAGE,
      isRetryable: true,
    }).toObject()
    msg.error = err
    log.warn("provider finish error", { messageID: msg.id })
    return err
  }
}
