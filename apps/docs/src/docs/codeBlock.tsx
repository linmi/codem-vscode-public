import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, FileScriptIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "../components/ui/button.tsx"

function highlight(line: string) {
  return line.split(/(\/\/.*$|"[^"\n]*"|\b(?:import|from|export|async|await|const|return|if|throw|new|type|function|try|catch|switch|case|break)\b)/g)
    .map((part, index) => <span key={index} className={part.startsWith("//") ? "syntaxComment" : part.startsWith('"') ? "syntaxString" : /^(import|from|export|async|await|const|return|if|throw|new|type|function|try|catch|switch|case|break)$/.test(part) ? "syntaxKeyword" : undefined}>{part}</span>)
}
export function CodeBlock({ code, filename }: { code: string; filename: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false; clearTimeout(timer.current) }, [])
  async function copy() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(code)
      if (!mounted.current) return
      setStatus("copied")
      timer.current = setTimeout(() => setStatus("idle"), 2200)
    } catch {
      if (mounted.current) setStatus("failed")
    }
  }
  return <div className="codeBlock">
    <div className="codeHeader"><span><HugeiconsIcon icon={FileScriptIcon} strokeWidth={1.5} aria-hidden="true" size={15} />{filename}</span><Button variant="ghost" size="sm" onClick={copy} aria-label={`复制 ${filename}`}><span aria-live="polite">{status === "copied" ? "已复制" : status === "failed" ? "重试复制" : "复制"}</span>{status === "copied" ? <HugeiconsIcon icon={Tick02Icon} strokeWidth={1.5} aria-hidden="true" /> : <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.5} aria-hidden="true" />}</Button></div>
    <pre tabIndex={0} aria-label={filename}><code>{code.trimEnd().split("\n").map((line, index) => <span className="codeLine" key={index}><span className="lineNumber" aria-hidden="true">{index + 1}</span><span>{highlight(line)}{"\n"}</span></span>)}</code></pre>
    {status === "failed" && <p role="status" className="copyError">浏览器未允许复制。可选中代码手动复制，或重试。</p>}
  </div>
}
