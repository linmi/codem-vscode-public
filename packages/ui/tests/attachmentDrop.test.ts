import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { carriesAttachments, parseUriList, readDroppedAttachments } from "../src/chat/attachmentDrop.ts"
import { parseUiAction } from "../src/contract.ts"

/** 只提供读取需要的两个字段，与浏览器 drop 事件一致：URI 列表按类型取，系统文件在 files。 */
function transfer(data: Record<string, string>, files: File[] = []) {
  return { getData: (type: string) => data[type] ?? "", files: files as unknown as FileList }
}

const image = (name: string, type: string, size = 4) => new File([new Uint8Array(size)], name, { type })

describe("attachment drop", () => {
  it("takes over drags that carry files or VS Code URI lists and leaves text drags alone", () => {
    assert.equal(carriesAttachments(["Files"]), true)
    assert.equal(carriesAttachments(["text/uri-list"]), true)
    assert.equal(carriesAttachments(["application/vnd.code.uri-list", "text/plain"]), true)
    assert.equal(carriesAttachments(["text/plain"]), false)
    assert.equal(carriesAttachments([]), false)
  })

  it("keeps only file: URIs from the list and drops comments and other schemes", () => {
    assert.deepEqual(parseUriList("# comment\r\nfile:///work/a.ts\r\nhttps://example.com\r\n\r\nFILE:///work/b.ts\n"), ["file:///work/a.ts", "FILE:///work/b.ts"])
  })

  it("prefers VS Code's URI list, deduplicates it and caps one drop at 20 entries", () => {
    const code = "file:///work/a.ts\nfile:///work/a.ts"
    assert.deepEqual(readDroppedAttachments(transfer({ "application/vnd.code.uri-list": code, "text/uri-list": "file:///other" }, [image("a.png", "image/png")])), { kind: "uris", uris: ["file:///work/a.ts"] })
    assert.deepEqual(readDroppedAttachments(transfer({ "text/uri-list": "file:///work/b.ts" })), { kind: "uris", uris: ["file:///work/b.ts"] })
    const many = Array.from({ length: 21 }, (_, index) => `file:///work/${index}.ts`).join("\n")
    assert.equal(readDroppedAttachments(transfer({ "text/uri-list": many })).kind, "rejected")
  })

  it("reads system images through the paste path and explains every other drop", () => {
    const png = image("a.png", "image/png")
    assert.deepEqual(readDroppedAttachments(transfer({}, [png])), { kind: "images", files: [png] })
    assert.equal(readDroppedAttachments(transfer({})).kind, "none")
    for (const files of [[image("a.pdf", "application/pdf")], [png, image("a.svg", "image/svg+xml")], [image("empty.png", "image/png", 0)], [image("big.png", "image/png", 20 * 1024 * 1024 + 1)]]) {
      const result = readDroppedAttachments(transfer({}, files))
      assert.equal(result.kind, "rejected")
      assert.ok(result.kind === "rejected" && result.reason.length > 0)
    }
  })

  it("lets the contract carry only bounded file URIs", () => {
    assert.deepEqual(parseUiAction({ type: "dropAttachments", uris: ["file:///work/a.ts"] }), { type: "dropAttachments", uris: ["file:///work/a.ts"] })
    for (const uris of [[], ["/work/a.ts"], ["https://example.com"], ["file:///a\nb"], Array.from({ length: 21 }, () => "file:///a"), "file:///a"]) {
      assert.throws(() => parseUiAction({ type: "dropAttachments", uris }), /Invalid CodeM action/)
    }
    assert.throws(() => parseUiAction({ type: "dropAttachments", uris: ["file:///a"], path: "/" }))
  })
})
