// Adapted from the user-supplied Beautiful UI Loading State design.
// Source and scope: UPSTREAM.md, Beautiful UI loading state intake.
const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3), column = index % 3
  return (column + Math.abs(row - 1)) * 90
})

export function LoadingState({ label, animate = true }: { label: string; animate?: boolean }) {
  return <span className="beautifulLoading" data-animated={animate}>
    <span className="beautifulLoadingGrid" aria-hidden="true">
      {chevron.map((delay, index) => <span key={index} style={{ animationDelay: `${delay}ms` }} />)}
    </span>
    <span className="beautifulLoadingLabel">{label}</span>
  </span>
}
