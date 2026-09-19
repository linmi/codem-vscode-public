import { onCleanup, onMount, type Component, type ParentComponent } from "solid-js"
import { ThemeProvider } from "@codem/ui/theme"
import { DialogProvider } from "@codem/ui/context/dialog"
import { MarkedProvider } from "@codem/ui/context/marked"
import { CodeComponentProvider } from "@codem/ui/context/code"
import { DiffComponentProvider } from "@codem/ui/context/diff"
import { FileComponentProvider } from "@codem/ui/context/file"
import { Code } from "@codem/ui/components/code"
import { Diff } from "@codem/ui/components/diff"
import { File } from "@codem/ui/components/file"
import { Toast } from "@codem/ui/components/toast"
import { VSCodeProvider, useVSCode } from "./vscode"
import { ServerProvider } from "./server"
import { ProviderProvider } from "./provider"
import { ConfigProvider } from "./config"
import { DisplayProvider } from "./display"
import { IndexingProvider } from "./indexing"
import { MemoryProvider } from "./memory"
import { SessionProvider } from "./session"
import { LanguageBridge } from "./language-bridge"
import { NotificationsProvider } from "./notifications"
import { KiloEmbeddingModelsProvider } from "./kilo-embedding-models"
import { ImageModelsProvider } from "./image-models"

type MermaidImageEvent = CustomEvent<{ dataUrl: string; filename: string }>

const MermaidDownloadBridge: Component = () => {
  const vscode = useVSCode()

  onMount(() => {
    const save = (event: Event) => {
      const detail = (event as MermaidImageEvent).detail
      if (!detail?.dataUrl || !detail.filename) return
      event.preventDefault()
      vscode.postMessage({ type: "saveImage", dataUrl: detail.dataUrl, filename: detail.filename })
    }
    window.addEventListener("codem:save-image", save)
    onCleanup(() => window.removeEventListener("codem:save-image", save))
  })

  return null
}

const Root: ParentComponent = (props) => (
  <ThemeProvider defaultTheme="codem-vscode">
    <DialogProvider>
      <VSCodeProvider>
        <MermaidDownloadBridge />
        <ServerProvider>
          <LanguageBridge>
            {/* MarkedProvider is required here for all markdown consumers in the tree,
                including PRPanel's PRDescription and PRComments components. Do not remove. */}
            <MarkedProvider>
              <DiffComponentProvider component={Diff}>
                <CodeComponentProvider component={Code}>
                  <FileComponentProvider component={File}>
                    <ProviderProvider>
                      <ConfigProvider>
                        <DisplayProvider>{props.children}</DisplayProvider>
                      </ConfigProvider>
                    </ProviderProvider>
                  </FileComponentProvider>
                </CodeComponentProvider>
              </DiffComponentProvider>
            </MarkedProvider>
          </LanguageBridge>
        </ServerProvider>
      </VSCodeProvider>
      <Toast.Region />
    </DialogProvider>
  </ThemeProvider>
)

const Session: ParentComponent = (props) => (
  <IndexingProvider>
    <KiloEmbeddingModelsProvider>
      <ImageModelsProvider>
        <NotificationsProvider>
          <SessionProvider>{props.children}</SessionProvider>
        </NotificationsProvider>
      </ImageModelsProvider>
    </KiloEmbeddingModelsProvider>
  </IndexingProvider>
)

const Chat: ParentComponent = (props) => <MemoryProvider>{props.children}</MemoryProvider>

export const ProviderShell = { Root, Session, Chat }
