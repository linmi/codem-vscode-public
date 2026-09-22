const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3)
  const column = index % 3
  return (column + Math.abs(row - 1)) * 90
})

/**
 * VS Code 现网加载：3×3 像素依次点亮，标签做流光。
 * 像素节点保持挂载，流式更新只改文案，避免动画被重头播放。
 */
export function LoadingState({ label, animate = true, labelId }: { label: string; animate?: boolean; labelId?: string }) {
  return (
    <span className="beautifulLoading" data-animated={animate}>
      <span className="beautifulLoadingGrid" aria-hidden="true">
        {chevron.map((delay, index) => (
          <span key={index} style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      {label ? (
        <span className="beautifulLoadingLabel" id={labelId}>
          {label}
        </span>
      ) : null}
    </span>
  )
}
