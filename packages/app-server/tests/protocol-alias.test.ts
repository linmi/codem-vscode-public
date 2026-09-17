import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  APP_SERVER_BUILTIN_INTELLIGENCE_TIERS,
  type AppServerBuiltinIntelligence,
  type AppServerModeState,
  type AppServerModelSummary,
  type AppServerPermissionMode,
  type AppServerSkillSummary,
} from "../src/index.ts"
import {
  CODEM_BUILTIN_INTELLIGENCE_TIERS,
  type CodemBuiltinIntelligence,
  type CodemModeState,
  type CodemModelSummary,
  type CodemPermissionMode,
  type CodemSkillSummary,
} from "@codem/protocol"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const model: Equal<AppServerModelSummary, CodemModelSummary> = true
const skill: Equal<AppServerSkillSummary, CodemSkillSummary> = true
const mode: Equal<AppServerModeState, CodemModeState> = true
const permission: Equal<AppServerPermissionMode, CodemPermissionMode> = true
const intelligence: Equal<AppServerBuiltinIntelligence, CodemBuiltinIntelligence> = true

void model
void skill
void mode
void permission
void intelligence

describe("App Server protocol aliases", () => {
  it("re-exports the shared intelligence whitelist without a second copy", () => {
    assert.equal(APP_SERVER_BUILTIN_INTELLIGENCE_TIERS, CODEM_BUILTIN_INTELLIGENCE_TIERS)
  })
})

