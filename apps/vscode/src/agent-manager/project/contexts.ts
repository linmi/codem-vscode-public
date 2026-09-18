/** Serializable project description for the webview. */
export interface ProjectSnapshot {
  id: string
  root: string
  label: string
  pinned: boolean
  active: boolean
  expanded: boolean
  initialized: boolean
  missing: boolean
}
