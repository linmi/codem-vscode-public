import { it } from "node:test"
import assert from "node:assert/strict"
import { createPreviewState, parsePreviewSearch } from "./previewState.ts"

it("validates preview URL state and preserves existing direct fixture links", () => {
  assert.deepEqual(parsePreviewSearch({}), {scenario:"conversation",theme:"light"})
  assert.equal(createPreviewState(parsePreviewSearch({panel:"model",empty:"1"})).activePanel?.kind,"model")
  assert.throws(() => parsePreviewSearch({scenario:"missing"}), /未知预览场景/)
  assert.throws(() => parsePreviewSearch({theme:"missing"}), /未知预览主题/)
  assert.throws(() => parsePreviewSearch({panel:"toString"}), /未知预览面板/)
})
it("creates independent fixture state so prior choices never mutate the next scene", () => {
  const first=createPreviewState(parsePreviewSearch({scenario:"permissionYolo"}))
  first.panels.permissionMode!.choices[0]!.selected=true
  first.demo.messages=[]
  const next=createPreviewState(parsePreviewSearch({scenario:"permissionDefault"}))
  assert.equal(next.demo.permission,"default")
  assert.deepEqual(next.activePanel?.choices.filter(choice=>choice.selected).map(choice=>choice.id),["default"])
  assert.equal(createPreviewState(parsePreviewSearch({})).demo.messages.length,4)
})
