import { useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CheckIcon, ChevronRightIcon, CopyIcon, FileCode2Icon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible.tsx"
import { codePromptParts, type CodePromptPart } from "../../src/shared/editorContext.ts"
import { highlightCode } from "./codeHighlight.ts"

function SourceCode({ text, language }: { text: string; language: string }) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (ref.current) { ref.current.textContent = text; highlightCode(ref.current, language) }
  }, [text, language])
  return <pre><code ref={ref} /></pre>
}

function CodeCard({ part }: { part: Extract<CodePromptPart, { kind: "code" }> }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const name = part.path.split(/[\\/]/).at(-1)!
  const range = part.startLine === part.endLine ? String(part.startLine) : `${part.startLine}–${part.endLine}`
  return <Collapsible className="userCodeCard">
    <div className="userCodeHeader">
      <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="userCodeToggle" title={part.path} aria-label={`选中代码 ${name} ${range}`}>
        <FileCode2Icon aria-hidden="true" /><span className="userCodeFilename">{name}</span><span className="userCodeRange">{range}</span><ChevronRightIcon className="userCodeChevron" aria-hidden="true" />
      </Button></CollapsibleTrigger>
      <Button type="button" variant="ghost" size="icon" className="userCodeCopy" aria-label={copied ? "已复制选中代码" : "复制选中代码"} onClick={async () => {
        try { await navigator.clipboard.writeText(part.text); setCopied(true); setError("") }
        catch { setCopied(false); setError("复制失败，请重试。") }
      }}>{copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}</Button>
    </div>
    {error && <span className="userCodeError" role="status">{error}</span>}
    <CollapsibleContent><SourceCode text={part.text} language={part.language} /></CollapsibleContent>
  </Collapsible>
}

export function createUserMessage(host: HTMLElement) {
  const root = createRoot(host)
  return {
    update(text: string): void {
      const parts = codePromptParts(text)
      host.classList.toggle("hasCodeContext", parts.some(part => part.kind === "code"))
      // Timeline scroll anchors are measured synchronously after each message update.
      flushSync(() => root.render(<>{parts.map((part, index) => part.kind === "text"
        ? <span className="userMessageText" key={index}>{part.text}</span>
        : <CodeCard key={`${index}:${part.path}:${part.startLine}:${part.endLine}:${part.text}`} part={part} />)}</>))
    },
    dispose(): void { root.unmount() },
  }
}
