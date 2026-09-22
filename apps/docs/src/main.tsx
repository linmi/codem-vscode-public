import { createRoot } from "react-dom/client"
import { DocsApp } from "./docs/docsApp.tsx"
import "./styles/docs.css"

createRoot(document.getElementById("root")!).render(<DocsApp />)
