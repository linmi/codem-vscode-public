import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path"
import { realpath, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { AppServerFileDiff, AppServerPromptAttachment } from "@codem/app-server"
import { UserVisibleError } from "../shared/userVisibleError.ts"

export type FileDiffContent = Omit<AppServerFileDiff, "source">

export function displayPath(cwd: string, path: string): string {
  const local = relative(cwd, resolve(cwd, path))
  return local && !local.startsWith(`..${sep}`) && local !== ".." && !isAbsolute(local) ? local : basename(path)
}

/** 命令里的工作区绝对路径不进界面。`-C <cwd>` 直接去掉，其余路径收成相对路径。 */
export function displayCommand(cwd: string, command: string): string {
  const root = cwd.endsWith(sep) ? cwd.slice(0, -1) : cwd
  let next = command
  for (const path of [root, `${root}${sep}`]) {
    next = next.replaceAll(`-C "${path}" `, "").replaceAll(`-C '${path}' `, "").replaceAll(`-C ${path} `, "")
    next = next.replaceAll(path, ".")
  }
  return next.replace(/[ \t]{2,}/g, " ").trim()
}

/** Core paths are untrusted. Opening a changed file is confined to the connected workspace. */
export async function changedFilePath(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd)
  const target = await realpath(resolve(root, path))
  const local = relative(root, target)
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local) || !(await stat(target)).isFile()) throw new Error("Changed file is outside the workspace or not a file")
  return target
}

/**
 * 拖入的地址来自 Webview，不可信。只收连接工作区内（按真实路径，符号链接不能带出去）的文件或文件夹；
 * 工作区外的文件仍须经“添加附件”的系统选择框由用户确认。
 */
export async function droppedAttachment(cwd: string, uri: string): Promise<AppServerPromptAttachment> {
  const outside = new UserVisibleError("只能拖入当前工作区里的文件或文件夹；其他位置请用“添加附件”选择。")
  let path: string
  try { path = fileURLToPath(uri) } catch { throw outside }
  const root = await realpath(cwd)
  let target: string
  try { target = await realpath(path) } catch { throw new UserVisibleError("拖入的文件不存在或无法读取。") }
  const local = relative(root, target)
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) throw outside
  const info = await stat(target)
  if (info.isDirectory()) return { kind: "directory", path: target }
  if (!info.isFile()) throw new UserVisibleError("只能拖入普通文件或文件夹。")
  return { kind: [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extname(target).toLowerCase()) ? "image" : "file", path: target }
}

export async function validateAttachment(attachment: AppServerPromptAttachment): Promise<void> {
  if (!isAbsolute(attachment.path)) throw new Error("Attachment must have a native absolute path")
  const info = await stat(attachment.path)
  if (attachment.kind === "directory" ? !info.isDirectory() : !info.isFile()) throw new Error("Attachment no longer exists or changed kind")
  if (attachment.kind === "image" && info.size > 20 * 1024 * 1024) throw new Error("Image exceeds 20 MiB")
}

/** A patch is shown as a patch: partial hunks must never masquerade as full file contents. */
export function diffText(diff: FileDiffContent, label: string): string {
  const heading = `${label} · ${diff.changeType}\n+${diff.stats.linesAdded} -${diff.stats.linesRemoved}\n`
  const preview = diff.preview
  if (preview.kind === "binary") return `${heading}\n二进制文件，无法显示文本差异。`
  if (preview.kind === "omitted") return `${heading}\nCore 未提供差异内容。`
  if (preview.kind === "raw-partial") return `${heading}\n部分差异（内容可能已截断）\n${preview.text}`
  return `${heading}${preview.kind === "partial" ? "\n部分差异（内容已截断）\n" : "\n"}` + preview.hunks.map((hunk) =>
    `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n` + hunk.lines.map((line) => `${line.kind === "insert" ? "+" : line.kind === "delete" ? "-" : " "}${line.text}`).join("\n"),
  ).join("\n")
}
