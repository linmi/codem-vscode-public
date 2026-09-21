import { useLayoutEffect, useRef } from "react"
import { renderSafeMarkdown } from "./markdownSafety.ts"

/**
 * 共享消息列表正文：用户消息、助手消息和未完成轮次的 assistantText 走同一渲染器。
 * 状态由 Host 快照拥有；这里只按 text 重绘。卸载随父级 React root 一起拆掉。
 */
export function SafeMarkdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (node) renderSafeMarkdown(node, text)
  }, [text])
  return <div ref={ref} className="chatMarkdown" />
}
