/** Keeps the filename visible while the directory yields space to row actions. */
export function FilePath({ label }: { label: string }) {
  const separator = Math.max(label.lastIndexOf("/"), label.lastIndexOf("\\"))
  return <span className="resourceFilePath" title={label}>
    {separator >= 0 && <span className="resourceFileDirectory">{label.slice(0, separator)}</span>}
    <span className="resourceFileBasename">{label.slice(separator >= 0 ? separator : 0)}</span>
  </span>
}
