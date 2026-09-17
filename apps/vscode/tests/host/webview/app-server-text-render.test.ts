import { describe, it } from "node:test"
import { fixture } from "../../fixtures/run.ts"

describe("app-server-text-render", () => {
  it(
    "renders App Server streaming, terminal, and history messages in the mature UI",
    { timeout: 30_000 },
    async () => {
      await fixture("app-server-text-render")
    },
  )
})
