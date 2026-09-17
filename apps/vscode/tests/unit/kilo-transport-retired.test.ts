import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ServerManager } from "../../src/services/cli-backend/server-manager"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { ensureBackendForAutocomplete } from "../../src/services/autocomplete/ensure-backend"
import { KILO_TRANSPORT_RETIRED_MESSAGE } from "../../src/shared/kilo-transport-retired"

describe("retired Kilo transport", () => {
  it("does not start kilo serve from initializeConnection", () => {
    const src = readFileSync(path.join(import.meta.dir, "../../src/CodeMProvider.ts"), "utf8")
    expect(src).not.toContain("this.connectionService.connect(")
    expect(src).toContain("unmigratedAppServerCommandMessage")
  })

  it("KiloConnectionService.connect never starts kilo serve", async () => {
    const service = new KiloConnectionService({} as never)
    await expect(service.connect("/repo")).rejects.toThrow(KILO_TRANSPORT_RETIRED_MESSAGE)
    await expect(service.getClientAsync("/repo")).rejects.toThrow(KILO_TRANSPORT_RETIRED_MESSAGE)
  })

  it("ServerManager.getServer fails closed", async () => {
    const manager = new ServerManager({} as never)
    await expect(manager.getServer()).rejects.toThrow(KILO_TRANSPORT_RETIRED_MESSAGE)
  })

  it("autocomplete prewarm does not start the retired backend", () => {
    let connected = false
    ensureBackendForAutocomplete({
      connect: async () => {
        connected = true
      },
    } as never)
    expect(connected).toBe(false)
  })
})
