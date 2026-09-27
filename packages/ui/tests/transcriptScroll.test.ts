import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { scrollStateAt } from "../src/chat/transcriptScroll.ts"

describe("transcript scroll", () => {
  it("follows new content near the bottom and shows the jump button only once the user is well above it", () => {
    assert.deepEqual(scrollStateAt({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), { following: true, showJump: false })
    assert.deepEqual(scrollStateAt({ scrollHeight: 1000, scrollTop: 580, clientHeight: 400 }), { following: true, showJump: false })
    assert.deepEqual(scrollStateAt({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 }), { following: false, showJump: false })
    assert.deepEqual(scrollStateAt({ scrollHeight: 1000, scrollTop: 100, clientHeight: 400 }), { following: false, showJump: true })
    // 内容比视口短时没有可滚动距离，既跟随也不显示按钮。
    assert.deepEqual(scrollStateAt({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 }), { following: true, showJump: false })
  })
})
