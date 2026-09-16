import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "renders App Server streaming, terminal, and history messages in the mature UI",
  () => fixture("app-server-text-render"),
  30_000,
)
