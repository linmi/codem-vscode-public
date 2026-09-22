import type { FileSearch } from "../contract.ts"

/**
 * `@` 提及菜单。结果只显示相对路径，选中后由宿主换成附件句柄。
 * 更改要点：150ms 防抖后发 searchFiles，方向键和 Enter 在菜单内消化。
 */
export function FileMentions({
  search,
  active,
  onActive,
  onChoose,
}: {
  search: FileSearch | null
  active: number
  onActive: (index: number) => void
  onChoose: (id: string) => void
}) {
  if (!search) return null
  return (
    <div className="fileMentions" role="listbox" aria-label="引用工作区文件" data-testid="fileMentions">
      {search.status === "loading" ? <div className="fileSearchStatus" role="status">正在搜索工作区文件…</div> : null}
      {search.error && search.files.length === 0 ? <div className="fileSearchStatus" role="status">{search.error}</div> : null}
      {search.files.map((file, index) => (
        <button
          key={file.id}
          type="button"
          role="option"
          aria-selected={index === active}
          className="fileMention"
          onMouseEnter={() => onActive(index)}
          onClick={() => onChoose(file.id)}
        >
          {file.label}
        </button>
      ))}
    </div>
  )
}
