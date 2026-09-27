import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

/** 离底部不超过这个距离仍算“在底部”，新内容到达时继续跟随。 */
export const FOLLOW_DISTANCE = 24
/** 离底部超过这个距离才露出“回到最新消息”。 */
export const JUMP_DISTANCE = 70

export interface TranscriptScrollState {
  following: boolean
  showJump: boolean
}

/** 纯规则：由滚动位置得出是否跟随、是否显示按钮。 */
export function scrollStateAt(metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }): TranscriptScrollState {
  const distance = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
  return { following: distance <= FOLLOW_DISTANCE, showJump: distance >= JUMP_DISTANCE }
}

/**
 * 会话滚动的唯一所有者。用户停在底部时，新消息、流式文本和图片撑高都继续贴底；
 * 用户往上翻后停止跟随，内容再长只露出按钮，不把人拉回去。
 * 切换工作区、空间或会话时恢复跟随；定位到搜索结果时停止跟随，让结果留在视野里；
 * 按钮点击后回到底部并恢复跟随。
 */
export function useTranscriptScroll(scroller: RefObject<HTMLElement | null>, view: { context: string; revision: unknown; target: string | null }) {
  const { context, revision, target } = view
  const following = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const settle = () => {
    const node = scroller.current
    if (!node) return
    if (following.current) node.scrollTop = node.scrollHeight
    setShowJump(scrollStateAt(node).showJump)
  }

  // 换会话后从最新消息开始看。
  useLayoutEffect(() => {
    following.current = true
  }, [context])

  // 搜索结果由消息自己滚到视野中央，这里不能再把它拉回底部。
  useLayoutEffect(() => {
    if (target) following.current = false
  }, [target])

  // 每次快照渲染后、绘制前贴底，避免先闪一帧旧位置。
  useLayoutEffect(settle, [context, revision])

  // 图片加载、代码高亮、输入框变高等不经过快照的尺寸变化。
  useEffect(() => {
    const node = scroller.current
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(settle)
    observer.observe(node)
    for (const child of Array.from(node.children)) observer.observe(child)
    const children = new MutationObserver(() => {
      for (const child of Array.from(node.children)) observer.observe(child)
    })
    children.observe(node, { childList: true })
    return () => {
      observer.disconnect()
      children.disconnect()
    }
  }, [scroller])

  const onScroll = () => {
    const node = scroller.current
    if (!node) return
    const state = scrollStateAt(node)
    following.current = state.following
    setShowJump(state.showJump)
  }

  const jumpToLatest = () => {
    const node = scroller.current
    if (!node) return
    following.current = true
    node.scrollTop = node.scrollHeight
    setShowJump(false)
  }

  return { showJump, onScroll, jumpToLatest }
}
