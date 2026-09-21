import type { ReactNode } from "react"
import { XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"

/** 对照 VS Code composerMenuHeading：标题 + 关闭，不是原生 select 标题。 */
export function ComposerMenuHeading({ children, close }: { children: ReactNode; close: () => void }) {
  return (
    <div className="composerMenuHeading">
      {children}
      <Button type="button" variant="ghost" className="composerMenuClose" aria-label="关闭菜单" onClick={close}>
        <XIcon />
      </Button>
    </div>
  )
}
