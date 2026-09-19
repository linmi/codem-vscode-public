import type { ProviderUsage } from "./leftover"

export type ProviderUsageData = ProviderUsage

export interface ProviderUsageLoadedMessage {
  type: "providerUsageLoaded"
  data?: ProviderUsageData
  error?: string
  reset?: boolean
}

export interface RequestProviderUsageMessage {
  type: "requestProviderUsage"
}

export interface RefreshProviderUsageMessage {
  type: "refreshProviderUsage"
}
