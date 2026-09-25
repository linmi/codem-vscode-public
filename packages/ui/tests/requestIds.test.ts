import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseUiAction } from "../src/contract.ts"
import { nextRequestId } from "../src/chat/requestIds.ts"

describe("webview request IDs", () => {
  it("never repeats within one page, even for requests issued in the same millisecond", () => {
    // 钉住时钟，所有请求都落在同一毫秒；旧的 Date.now 编号在这里全部撞号。
    const clock = Date.now
    Date.now = () => 1_758_758_400_000
    try {
      const ids = Array.from({ length: 2000 }, (_, index) => nextRequestId(index % 2 ? "req" : "mention"))
      assert.equal(new Set(ids).size, ids.length)
    } finally {
      Date.now = clock
    }
  })

  it("does not reuse the previous page's IDs after a reload", async () => {
    // 用查询串再加载一份模块，相当于重载后的新页面：序号从头开始，页面标识不同。
    const reloaded = (await import(`${new URL("../src/chat/requestIds.ts", import.meta.url).href}?reload`)) as typeof import("../src/chat/requestIds.ts")
    const fresh = reloaded.nextRequestId("req")
    assert.equal(fresh.split("-").at(-1), "1")
    assert.notEqual(fresh.split("-")[1], nextRequestId("req").split("-")[1])
  })

  it("keeps the prefix and passes the Host's requestId validation", () => {
    for (const prefix of ["req", "mention", "pick"] as const) {
      const id = nextRequestId(prefix)
      assert.match(id, new RegExp(`^${prefix}-[a-z0-9]+-[a-z0-9]+$`, "u"))
      assert.match(id, /^[a-zA-Z0-9-]{1,100}$/u)
    }
    parseUiAction({ type: "send", text: "hello", requestId: nextRequestId("req") })
    parseUiAction({ type: "searchFiles", query: "App", requestId: nextRequestId("mention") })
    parseUiAction({ type: "selectFile", id: "file-1", requestId: nextRequestId("pick") })
  })
})
