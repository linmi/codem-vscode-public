export const DEFAULT_VECTOR_STORE = "lancedb" as const

export const FILE_EXTENSION_PATTERN = /^\.?[A-Za-z0-9][A-Za-z0-9_+-]*$/

export function isFileExtension(input: string): boolean {
  return FILE_EXTENSION_PATTERN.test(input.trim())
}

export function normalizeFileExtensions(input: readonly string[] | undefined): string[] | undefined {
  if (!input) return undefined
  const values = new Set<string>()
  for (const raw of input) {
    const item = raw.trim().toLowerCase()
    if (!item) continue
    values.add(item.startsWith(".") ? item : `.${item}`)
  }
  return values.size > 0 ? [...values].sort() : undefined
}

export function parseFileExtensions(input: string): string[] | undefined {
  const values = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length > 0 ? normalizeFileExtensions(values) : undefined
}

export type KiloEmbeddingModel = {
  id: string
  name: string
  dimension: number
  scoreThreshold: number
  note?: string
}

export type KiloEmbeddingModelCatalog = {
  defaultModel: string
  models: KiloEmbeddingModel[]
  aliases: Record<string, string>
}

export const EMPTY_KILO_EMBEDDING_MODEL_CATALOG: KiloEmbeddingModelCatalog = {
  defaultModel: "",
  models: [],
  aliases: {},
}

export function normalizeKiloEmbeddingModelId(model: string | undefined, catalog = EMPTY_KILO_EMBEDDING_MODEL_CATALOG) {
  if (!model) return undefined
  return catalog.aliases[model] ?? model
}

export function getKiloEmbeddingModel(model: string | undefined, catalog = EMPTY_KILO_EMBEDDING_MODEL_CATALOG) {
  const id = normalizeKiloEmbeddingModelId(model, catalog)
  return catalog.models.find((item) => item.id === id)
}

export function formatKiloEmbeddingModelLabel(model: KiloEmbeddingModel): string {
  const note = model.note ? `${model.note}, ` : ""
  return `${model.name} (${note}${model.dimension}d)`
}

const INDEXING_PLUGIN_NAMES = new Set(["kilo-indexing", "@kilocode/kilo-indexing"])

export function hasIndexingPlugin(values?: readonly (string | readonly [string, ...unknown[]])[]): boolean {
  return (
    values?.some((value) => {
      const name = typeof value === "string" ? value : value[0]
      return INDEXING_PLUGIN_NAMES.has(name)
    }) ?? false
  )
}
