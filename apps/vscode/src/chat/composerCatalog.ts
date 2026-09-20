import { randomUUID } from "node:crypto"
import type { AppServerModelSummary, AppServerSpace } from "@codem/app-server"
import type { ComposerCatalog } from "../shared/composerSettings.ts"

/** Display handles live only as long as this connection/catalog generation. */
export class ComposerCatalogView {
  private models = new Map<string, AppServerModelSummary>()
  private spaces = new Map<string, AppServerSpace>()
  bind(models: readonly AppServerModelSummary[], spaces: readonly AppServerSpace[]): void {
    this.models = new Map(models.map(model => [randomUUID(), model]))
    this.updateSpaces(spaces)
  }
  updateSpaces(spaces: readonly AppServerSpace[]): void { this.spaces = new Map(spaces.map(space => [randomUUID(), space])) }
  model(id: string): string | undefined { return this.models.get(id)?.id }
  space(id: string): string | undefined { return this.spaces.get(id)?.projectKey }
  snapshot(model: string, space: string): ComposerCatalog {
    return {
      models: [...this.models].map(([id, item]) => ({ id, label: item.id.endsWith("/auto") ? "Auto" : item.id, description: item.supportsVision ? "支持图片" : "", selected: item.id === model })),
      spaces: [...this.spaces].map(([id, item]) => ({ id, label: item.displayName, description: "", selected: item.projectKey === space })),
    }
  }
}
