import { useState } from "react"
import { CheckIcon, ChevronRightIcon, CopyIcon, FileCode2Icon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible.tsx"
import { codePromptParts, type CodePromptPart } from "./codePromptParts.ts"

function CodeCard({ part }: { part: Extract<CodePromptPart, { kind: "code" }> }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const name = part.path.split(/[\\/]/).at(-1)!
  const range = part.startLine === part.endLine ? String(part.startLine) : `${part.startLine}–${part.endLine}`
  return (
    <Collapsible className="userCodeCard">
      <div className="userCodeHeader">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="userCodeToggle" title={name} aria-label={`选中代码 ${name} ${range}`}>
            <FileCode2Icon aria-hidden="true" />
            <span className="userCodeFilename">{name}</span>
            <span className="userCodeRange">{range}</span>
            <ChevronRightIcon className="userCodeChevron" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="userCodeCopy"
          aria-label={copied ? "已复制选中代码" : "复制选中代码"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(part.text)
              setCopied(true)
              setError("")
            } catch {
              setCopied(false)
              setError("复制失败，请重试。")
            }
          }}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      </div>
      {error ? <span className="userCodeError" role="status">{error}</span> : null}
      <CollapsibleContent>
        <pre><code>{part.text}</code></pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function UserMessageBody({ text }: { text: string }) {
  const parts = codePromptParts(text)
  return (
    <div className={parts.some((part) => part.kind === "code") ? "messageBody hasCodeContext" : "messageBody"}>
      {parts.map((part, index) => part.kind === "text"
        ? <span className="userMessageText" key={index}>{part.text}</span>
        : <CodeCard key={`${index}:${part.startLine}:${part.endLine}`} part={part} />)}
    </div>
  )
}
