/**
 * Provider/model context
 * Manages available providers, models, and the global default selection.
 * Selection is now per-session — see session.tsx.
 */

import { batch, createContext, useContext, createSignal, createMemo, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { CodemModelCatalog } from "@codem/protocol"
import { CODEM_BUILTIN_INTELLIGENCE_TIERS } from "@codem/protocol"
import type { Provider, ProviderModel, ModelSelection, ExtensionMessage, ProviderAuthState } from "../types/messages"
import type { ProviderAuthMethod } from "../types/messages/leftover"
import { flattenModels, findModel as _findModel, isModelValid as isValid } from "./provider-utils"
import { KILO_AUTO } from "../../../src/shared/provider-model"

export type { CodemModelCatalog }

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }

interface ProviderContextValue {
  catalog: Accessor<CodemModelCatalog | null>
  providers: Accessor<Record<string, Provider>>
  connected: Accessor<string[]>
  defaults: Accessor<Record<string, string>>
  organizationId: Accessor<string | null | undefined>
  ready: Accessor<boolean>
  defaultSelection: Accessor<ModelSelection>
  models: Accessor<EnrichedModel[]>
  findModel: (selection: ModelSelection | null) => EnrichedModel | undefined
  authMethods: Accessor<Record<string, ProviderAuthMethod[]>>
  authStates: Accessor<Record<string, ProviderAuthState>>
  isModelValid: (selection: ModelSelection | null) => boolean
}

export const ProviderContext = createContext<ProviderContextValue>()

export const ProviderProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [catalog, setCatalog] = createSignal<CodemModelCatalog | null>(null)
  const [providers, setProviders] = createSignal<Record<string, Provider>>({})
  const [connected, setConnected] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<Record<string, string>>({})
  const [organizationId, setOrganizationId] = createSignal<string | null>()
  const [ready, setReady] = createSignal(false)
  const [defaultSelection, setDefaultSelection] = createSignal<ModelSelection>(KILO_AUTO)
  const [authMethods, setAuthMethods] = createSignal<Record<string, ProviderAuthMethod[]>>({})
  const [authStates, setAuthStates] = createSignal<Record<string, ProviderAuthState>>({})

  const models = createMemo<EnrichedModel[]>(() => {
    const loaded = catalog()
    return loaded ? catalogToPickerModels(loaded) : flattenModels(providers())
  })

  function findModel(selection: ModelSelection | null): EnrichedModel | undefined {
    return _findModel(models(), selection)
  }

  function isModelValid(selection: ModelSelection | null): boolean {
    return isValid(providers(), connected(), selection)
  }

  // Register immediately so the first codemModelsLoaded is not missed before mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "providersLoading") {
      batch(() => {
        setReady(false)
        setOrganizationId(undefined)
        setProviders((prev) => {
          const next = { ...prev }
          delete next.kilo
          return next
        })
        setDefaults((prev) => {
          const next = { ...prev }
          delete next.kilo
          return next
        })
        setConnected((prev) => prev.filter((id) => id !== "kilo"))
      })
      return
    }
    // 模型选择器只吃 CodeM 原生目录；不再双读 Kilo providersLoaded。
    if (message.type !== "codemModelsLoaded") return

    batch(() => {
      setCatalog(message.catalog)
      setProviders(catalogToProviders(message.catalog))
      setReady(true)
      setOrganizationId(null)
      setDefaultSelection(splitCoreModel(message.catalog.activeModel))
      setConnected([...new Set(message.catalog.models.map((model) => splitCoreModel(model.id).providerID))])
      setDefaults({
        [splitCoreModel(message.catalog.activeModel).providerID]: splitCoreModel(message.catalog.activeModel).modelID,
      })
      setAuthMethods({})
      setAuthStates({})
    })
  })

  onCleanup(unsubscribe)

  // Request providers immediately; if the extension's httpClient is not yet ready,
  // extensionDataReady will fire once initialization completes and we retry once.
  vscode.postMessage({ type: "requestProviders" })

  const fallback = setTimeout(() => {
    if (catalog() === null && Object.keys(providers()).length === 0) {
      vscode.postMessage({ type: "requestProviders" })
    }
  }, 3000)

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    clearTimeout(fallback)
    if (catalog() === null && Object.keys(providers()).length === 0) {
      vscode.postMessage({ type: "requestProviders" })
    }
  })

  onCleanup(() => {
    unsubReady()
    clearTimeout(fallback)
  })

  const value: ProviderContextValue = {
    catalog,
    providers,
    connected,
    defaults,
    organizationId,
    ready,
    defaultSelection,
    models,
    findModel,
    authMethods,
    authStates,
    isModelValid,
  }

  return <ProviderContext.Provider value={value}>{props.children}</ProviderContext.Provider>
}

/** 选择器行在 Webview 内从 Core 模型表展开；Host 不再 post providersLoaded。 */
function catalogToPickerModels(catalog: CodemModelCatalog): EnrichedModel[] {
  return catalog.models.map((model) => {
    const selection = splitCoreModel(model.id)
    return {
      id: selection.modelID,
      providerID: selection.providerID,
      providerName: selection.providerID.startsWith("codem") ? "CodeM" : selection.providerID,
      name: model.id === catalog.activeModel ? model.id : selection.modelID,
      contextLength: model.contextWindowTokens,
      capabilities: {
        reasoning: true,
        input: { text: true, image: model.supportsVision, audio: false, video: false, pdf: false },
      },
      ...(model.source === "builtin"
        ? { variants: Object.fromEntries(CODEM_BUILTIN_INTELLIGENCE_TIERS.map((tier) => [tier, {}])) }
        : {}),
    }
  })
}

/** 把 Core 模型表展开成现有选择器/session resolver 需要的本地行，不回写成 Host 消息。 */
function catalogToProviders(catalog: CodemModelCatalog): Record<string, Provider> {
  const providers: Record<string, Provider> = {}
  for (const model of catalogToPickerModels(catalog)) {
    const { providerID, providerName, ...rest } = model
    const existing = providers[providerID]
    if (!existing) {
      providers[providerID] = { id: providerID, name: providerName, models: { [model.id]: rest } }
      continue
    }
    existing.models[model.id] = rest
  }
  return providers
}

function splitCoreModel(model: string): ModelSelection {
  const separator = model.indexOf("/")
  if (separator <= 0 || separator === model.length - 1) return { providerID: "codem", modelID: model }
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) }
}

export function useProvider(): ProviderContextValue {
  const context = useContext(ProviderContext)
  if (!context) {
    throw new Error("useProvider must be used within a ProviderProvider")
  }
  return context
}
