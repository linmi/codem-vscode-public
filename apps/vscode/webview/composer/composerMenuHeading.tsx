import type { ReactNode } from "react"
import { XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"

export function ComposerMenuHeading({ children, close }: { children: ReactNode; close: () => void }) {
  return <div className="composerMenuHeading">
    {children}
    <Button type="button" variant="ghost" className="composerMenuClose" aria-label="关闭菜单" onClick={close}><XIcon /></Button>
  </div>
}
