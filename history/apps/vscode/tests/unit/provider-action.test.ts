import { describe, expect, it } from "bun:test"
import { createProviderAction } from "../../webview-ui/src/utils/provider-action"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

function createTransport() {
  const sent: WebviewMessage[] = []
  let handler: ((message: ExtensionMessage) => void) | undefined

  return {
    sent,
    receive(message: ExtensionMessage) {
      handler?.(message)
    },
    postMessage(message: WebviewMessage) {
      sent.push(message)
    },
    onMessage(next: (message: ExtensionMessage) => void) {
      handler = next
      return () => {
        if (handler === next) {
          handler = undefined
        }
      }
    },
  }
}

describe("createProviderAction", () => {
  it("does not post product-cut provider mutation commands", () => {
    const transport = createTransport()
    const action = createProviderAction(transport)
    const seen: string[] = []

    const requestId = action.send(
      {
        type: "connectProvider",
        providerID: "openai",
        apiKey: "sk-test",
      },
      {
        onConnected: (message) => seen.push(`connected:${message.providerID}`),
      },
    )

    expect(transport.sent).toEqual([])
    transport.receive({
      type: "providerConnected",
      requestId,
      providerID: "openai",
    })
    transport.receive({
      type: "providerConnected",
      requestId,
      providerID: "openai",
    })

    expect(seen).toEqual(["connected:openai"])
    action.dispose()
  })

  it("keeps concurrent local request ids isolated", () => {
    const transport = createTransport()
    const action = createProviderAction(transport)
    const seen: string[] = []

    const oauthId = action.send(
      {
        type: "authorizeProviderOAuth",
        providerID: "anthropic",
        method: 0,
      },
      {
        onOAuthReady: (message) => seen.push(`oauth:${message.authorization.method}`),
      },
    )
    const disconnectId = action.send(
      {
        type: "disconnectProvider",
        providerID: "openai",
      },
      {
        onDisconnected: (message) => seen.push(`disconnect:${message.providerID}`),
      },
    )

    expect(transport.sent).toEqual([])
    transport.receive({
      type: "providerDisconnected",
      requestId: disconnectId,
      providerID: "openai",
    })
    transport.receive({
      type: "providerOAuthReady",
      requestId: oauthId,
      providerID: "anthropic",
      authorization: { url: "https://example.com", method: "code", instructions: "Code: 1234" },
    })

    expect(seen).toEqual(["disconnect:openai", "oauth:code"])
    action.dispose()
  })

  it("can drop stale requests", () => {
    const transport = createTransport()
    const action = createProviderAction(transport)
    const seen: string[] = []

    const requestId = action.send(
      {
        type: "saveCustomProvider",
        providerID: "myprovider",
        config: {
          name: "My Provider",
          options: { baseURL: "https://example.com/v1" },
          models: { "model-1": { name: "Model One" } },
        },
      },
      {
        onError: (message) => seen.push(message.message),
      },
    )

    action.clear(requestId)
    transport.receive({
      type: "providerActionError",
      requestId,
      providerID: "myprovider",
      action: "connect",
      message: "boom",
    })

    expect(seen).toEqual([])
    expect(transport.sent).toEqual([])
    action.dispose()
  })
})
