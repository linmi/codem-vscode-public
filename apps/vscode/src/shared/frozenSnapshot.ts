/**
 * Deep-freezes the parts of a published value that are not frozen yet.
 *
 * Snapshots share every unchanged object with the previous snapshot. Those objects were frozen when they
 * were first published, so a later publish stops at them: one streaming delta freezes only the objects it
 * created and never copies message text. Owners must replace changed values instead of editing them;
 * an in-place edit of published data throws.
 */
export function freezeSnapshot<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const item of Object.values(value)) freezeSnapshot(item)
  return value
}
