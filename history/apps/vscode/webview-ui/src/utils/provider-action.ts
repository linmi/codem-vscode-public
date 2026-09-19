import type {
  ExtensionMessage,
  ProviderActionErrorMessage,
  ProviderConnectedMessage,
  ProviderDisconnectedMessage,
  ProviderOAuthReadyMessage,
  WebviewMessage,
} from "../types/messages"

type Transport = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

type Handlers = {
  onOAuthReady?: (message: ProviderOAuthReadyMessage) => void
  onConnected?: (message: ProviderConnectedMessage) => void
  onDisconnected?: (message: ProviderDisconnectedMessage) => void
  onError?: (message: ProviderActionErrorMessage) => void
}

/**
 * Provider OAuth / custom-provider commands were product-cut: Core v1 has no
 * mutation RPC. Keep the correlation helper so hidden Settings dialogs compile,
 * but do not post those commands.
 */
export function createProviderAction(vscode: Transport) {
  const pending = new Map<string, Handlers>()
  const unsubscribe = vscode.onMessage((message) => {
    if (!("requestId" in message)) return

    const item = pending.get(message.requestId)
    if (!item) return
    pending.delete(message.requestId)

    if (message.type === "providerOAuthReady") {
      item.onOAuthReady?.(message)
      return
    }

    if (message.type === "providerConnected") {
      item.onConnected?.(message)
      return
    }

    if (message.type === "providerDisconnected") {
      item.onDisconnected?.(message)
      return
    }

    if (message.type === "providerActionError") {
      item.onError?.(message)
    }
  })

  function send(_message: Record<string, unknown>, handlers: Handlers = {}) {
    const requestId = crypto.randomUUID()
    pending.set(requestId, handlers)
    void vscode
    return requestId
  }

  function clear(requestId?: string) {
    if (requestId) {
      pending.delete(requestId)
      return
    }
    pending.clear()
  }

  function dispose() {
    clear()
    unsubscribe()
  }

  return { clear, send, dispose }
}
