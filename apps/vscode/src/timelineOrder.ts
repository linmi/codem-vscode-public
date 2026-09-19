/** A terminal reply stays after its work, without reordering the work itself. */
export function terminalReplyLast<T extends { id: string }>(items: readonly T[], finalId: string | null): readonly T[] {
  if (!finalId) return items
  const index = items.findIndex(item => item.id === finalId)
  if (index < 0 || index === items.length - 1) return items
  return [...items.slice(0, index), ...items.slice(index + 1), items[index]!]
}
