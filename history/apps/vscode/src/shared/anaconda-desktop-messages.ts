export type AnacondaDesktopStatus =
  | {
      type: "unsupported-platform"
      platform: string
    }
  | {
      type: "not-installed"
      downloadURL: string
    }
  | {
      type: "not-running"
    }
  | {
      type: "invalid-config"
      reason: "missing" | "malformed" | "missing-key" | "invalid-port"
    }
  | {
      type: "signed-out"
    }
  | {
      type: "management-unauthorized"
    }
  | {
      type: "management-unavailable"
      reason: "timeout" | "unexpected-response"
    }
  | {
      type: "no-downloaded-model"
    }
  | {
      type: "no-running-server"
      downloadedModels: number
    }
  | {
      type: "inference-unhealthy"
      serverID: string
    }
  | {
      type: "ready"
      serverID: string
      serverName?: string
      models: Array<{
        id: string
        name: string
      }>
      context: number
      toolcall: "supported" | "unsupported" | "unknown"
    }

export type AnacondaDesktopAction = "status" | "open" | "sync"

export type AnacondaDesktopWebviewMessage =
  | { type: "anacondaDesktopStatus"; requestId: string }
  | { type: "anacondaDesktopOpen"; requestId: string }
  | {
      type: "anacondaDesktopSync"
      requestId: string
      acknowledgeToolLimitations: boolean
    }
  | { type: "cancelAnacondaDesktopRequest"; requestId: string }

export type AnacondaDesktopExtensionMessage =
  | {
      type: "anacondaDesktopStatusResult"
      requestId: string
      status: AnacondaDesktopStatus
    }
  | { type: "anacondaDesktopOpened"; requestId: string }
  | {
      type: "anacondaDesktopSynced"
      requestId: string
      status: Extract<AnacondaDesktopStatus, { type: "ready" }>
    }
  | {
      type: "anacondaDesktopActionError"
      requestId: string
      action: AnacondaDesktopAction
      message: string
    }

export type AnacondaDesktopRequest = Exclude<AnacondaDesktopWebviewMessage, { type: "cancelAnacondaDesktopRequest" }>
export type AnacondaDesktopResult = Exclude<AnacondaDesktopExtensionMessage, { type: "anacondaDesktopActionError" }>
export type AnacondaDesktopError = Extract<AnacondaDesktopExtensionMessage, { type: "anacondaDesktopActionError" }>
