import type { FileDiffContent } from "./filePresentation.ts"
export type DiffComparison = { kind: "comparison"; before: string; after: string } | { kind: "patch"; reason: string }
/** Compare line content only: the Core hunk contract does not preserve EOF/EOL metadata. */
export function compareDiff(diff: FileDiffContent, current: string | null): DiffComparison {
  const patch = (reason: string): DiffComparison => ({ kind: "patch", reason })
  if (diff.preview.kind !== "complete") return patch("Core 未提供完整文本补丁，显示原始差异。")
  const hunks = diff.preview.hunks
  if (!hunks.length) return patch("补丁不包含可比较的文本。")
  if (diff.changeType === "deleted") {
    if (hunks.length !== 1 || hunks[0]!.oldStart !== 1 || hunks[0]!.newCount !== 0 || hunks[0]!.lines.some(line => line.kind !== "delete") || hunks[0]!.oldCount !== hunks[0]!.lines.length) return patch("删除补丁不足以重建完整文件。")
    return { kind: "comparison", before: hunks[0]!.lines.map(line => line.text).join("\n"), after: "" }
  }
  if (current === null) return patch("当前文件不可读取，无法可靠重建双栏内容。")
  const afterLines = current.replaceAll("\r\n", "\n").split("\n")
  if (afterLines.at(-1) === "") afterLines.pop()
  const beforeLines = [...afterLines]
  let end = 0, oldEnd = 0
  for (const hunk of hunks) {
    const newLines = hunk.lines.filter(line => line.kind !== "delete").map(line => line.text)
    const oldLines = hunk.lines.filter(line => line.kind !== "insert").map(line => line.text)
    const start = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1
    const oldStart = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1
    if (newLines.length !== hunk.newCount || oldLines.length !== hunk.oldCount || start < end || oldStart < oldEnd || start - end !== oldStart - oldEnd || start + newLines.length > afterLines.length || newLines.some((line, i) => afterLines[start + i] !== line)) return patch("当前文件与 Core 补丁不匹配，显示补丁以免误导。")
    end = start + newLines.length; oldEnd = oldStart + oldLines.length
  }
  for (const hunk of [...hunks].reverse()) beforeLines.splice(hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1, hunk.newCount, ...hunk.lines.filter(line => line.kind !== "insert").map(line => line.text))
  if (diff.changeType === "new" && beforeLines.length) return patch("新文件补丁不完整，显示原始差异。")
  return { kind: "comparison", before: beforeLines.join("\n"), after: afterLines.join("\n") }
}
