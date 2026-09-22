import { useEffect, useRef, useState } from "react"
import { ArrowRight, ArrowUpRight, BookOpen, Boxes, Braces, Check, ChevronLeft, ChevronRight, CircleHelp, Code2, Database, FileCode2, GitBranch, Layers3, ListTree, Menu, MessageSquare, Play, ShieldCheck, SlidersHorizontal, Terminal, Workflow, X, type LucideIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { CodeBlock } from "./codeBlock.tsx"
import { pages, capabilityIds, resolvePage, type DocPage } from "./content.ts"

const icons: Record<DocPage["icon"], LucideIcon> = { overview: Boxes, start: Play, architecture: Workflow, stream: MessageSquare, sessions: GitBranch, approval: ShieldCheck, modes: SlidersHorizontal, skills: Braces, catalogs: ListTree, history: Database, examples: FileCode2, limits: CircleHelp }
const groups = ["开始", "核心能力", "参考"] as const
const versions = __RUNTIME_VERSIONS__
const overviewCode = `const host = createHost(packageRoot)\n\n// 订阅流式事件，再开始对话\nconst session = await startConversation(\n  host, cwd, onEvent,\n)\n\n// 应用退出时释放资源\nsession.unsubscribe()\nawait host.close()`
function Navigation({ active, onNavigate }: { active: string; onNavigate: () => void }) {
  return <nav aria-label="文档导航">{groups.map(group => <div className="navGroup" key={group}><h2>{group}</h2>{pages.filter(page => page.group === group).map(page => {
    const Icon = icons[page.icon]
    return <a key={page.id} href={`#/${page.id}`} aria-current={active === page.id ? "page" : undefined} onClick={onNavigate}><Icon size={16} /><span>{page.title}</span>{active === page.id && <ChevronRight size={14} className="activeChevron" />}</a>
  })}</div>)}</nav>
}
function SectionHeading({ index, title, english }: { index: string; title: string; english?: string }) {
  return <div className="sectionHeading"><span className="sectionNumber">{index}</span><h2>{title}</h2>{english && <span className="sectionEnglish">{english}</span>}</div>
}
function Overview() {
  return <>
    <header className="pageIntro"><div className="eyebrow"><span className="littleLabel">开发文档</span><span>Node.js · TypeScript · stdio</span></div><h1 tabIndex={-1}>CodeM App Server<span className="titlePeriod">.</span></h1><p>@codem/app-server 为应用提供统一的 CodeM 接入层。<br className="desktopBreak" />从会话、流式响应到工具与审批，找到你需要的能力和用法。</p><div className="introActions"><Button asChild><a href="#/quickstart">开始接入 <ArrowRight size={15} /></a></Button><Button variant="outline" asChild><a href="#/examples"><Code2 size={15} />参考示例</a></Button></div></header>
    <div className="connectionStrip" aria-label="架构概览"><span><Layers3 />你的应用</span><ChevronRight /><span className="stripHost"><Terminal />App Server Host</span><span className="transportLabel">stdio <ChevronRight /></span><span><Boxes />CodeM Core</span></div>
    <section className="overviewSection"><SectionHeading index="01" title="可以做什么" english="Capabilities" /><div className="capabilityGrid">{capabilityIds.map((id, index) => {
      const page = pages.find(value => value.id === id)!
      const Icon = icons[page.icon]
      const labels: Record<string, string> = { execution: "消息发送 · 流式响应 · 中断与补充", sessions: "创建与恢复 · 分叉 · 归档与回退", approvals: "权限审批 · 用户问答 · 计划确认", modes: "模型目录 · 计划模式 · 权限控制", extensions: "原生 Skills · MCP stdio · 后台任务", catalogs: "模型与扩展目录 · 工作空间绑定", history: "JSONL 持久历史 · 分页与恢复" }
      return <a className="capabilityCard" href={`#/${id}`} key={id}><div className="cardTop"><span className="cardIcon"><Icon size={19} /></span><span className="cardIndex">0{index + 1}</span></div><h3>{page.title}<ArrowUpRight size={16} /></h3><p>{labels[id]}</p><span className="cardMethod">{page.methods?.[0]}<span>查看用法 <ArrowRight size={12} /></span></span></a>
    })}<a href="#/architecture" className="capabilityCard architectureCard"><div className="cardTop"><Workflow size={20} /><span className="cardIndex">↗</span></div><h3>了解整体架构<ArrowUpRight size={16} /></h3><p>从界面到 Core，厘清每一层的职责。</p><span className="cardMethod">Architecture<span>阅读指南 <ArrowRight size={12} /></span></span></a></div></section>
    <section className="overviewSection"><SectionHeading index="02" title="从一段对话开始" english="A first look" /><div className="examplePanel"><Tabs defaultValue="flow"><div className="exampleBar"><TabsList variant="line" aria-label="示例视图"><TabsTrigger value="flow">调用流程</TabsTrigger><TabsTrigger value="code">代码示例</TabsTrigger></TabsList><span className="sampleLabel">Node Host 示例</span></div><TabsContent value="flow"><div className="flowPreview">{[["1", "创建 Host", "运行时与认证"], ["2", "开始会话", "Core 分配身份"], ["3", "接收事件", "流式输出与审批"]].map(([num, title, note]) => <div className="flowStep" key={num}><span>{num}</span><strong>{title}</strong><small>{note}</small></div>)}</div><div className="flowNote"><Check size={15} /><span>监听 turn-completed，确认轮次的最终结果。</span></div></TabsContent><TabsContent value="code"><CodeBlock filename="usage.ts" code={overviewCode} /><p className="exampleNote">createHost 与 startConversation 的完整实现见「快速开始」。保持 Host 存活直至应用退出。</p></TabsContent></Tabs></div><a href="#/quickstart" className="textLink">查看完整接入步骤 <ArrowRight size={14} /></a></section>
    <aside className="boundaryNote"><BookOpen size={18} /><div><strong>先了解能力边界</strong><p>Node Host 负责连接，Core 负责执行，应用负责交互。<br />配置写入、MCP HTTP 等未支持能力，已在文档中明确标注。</p><a href="#/limitations">查看支持边界 <ArrowUpRight size={13} /></a></div></aside>
  </>
}
function Article({ page }: { page: DocPage }) {
  return <><header className="articleIntro"><div className="eyebrow">{page.group}<span>/</span>{page.english}</div><h1 tabIndex={-1}>{page.title}</h1><p>{page.description}</p>{page.methods && <div className="methodTags">{page.methods.map(method => <code key={method}>{method}</code>)}</div>}</header>{page.sections.map((section, index) => <section className="articleSection" key={section.title}><SectionHeading index={String(index + 1).padStart(2, "0")} title={section.title} /><p>{section.body}</p>{section.code && <CodeBlock filename={`${section.code}.ts`} code={__CODE_EXAMPLES__[section.code]} />}{section.items && <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>}</section>)}<div className="articleSource"><BookOpen size={15} /><span>依据当前 Host 公开接口及仓库能力文档整理。示例仅作展示，不在浏览器中执行。</span></div></>
}
export function DocsApp() {
  const [hash, setHash] = useState(window.location.hash)
  const [menuOpen, setMenuOpen] = useState(false)
  const page = resolvePage(hash)
  const main = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const previousHash = useRef(hash)
  useEffect(() => {
    const changed = () => { setHash(window.location.hash); setMenuOpen(false) }
    window.addEventListener("hashchange", changed)
    return () => window.removeEventListener("hashchange", changed)
  }, [])
  useEffect(() => {
    document.title = `${page?.title ?? "页面未找到"} · CodeM App Server`
    if (previousHash.current !== hash) {
      window.scrollTo(0, 0)
      main.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true })
      previousHash.current = hash
    }
  }, [hash, page])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus() } }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [menuOpen])
  const index = pages.findIndex(value => value.id === page?.id)
  const next = pages[index + 1]
  const previous = pages[index - 1]
  return <><a href="#main-content" className="skipLink" onClick={event => { event.preventDefault(); main.current?.focus() }}>跳到内容</a><div className="siteFrame"><aside className="sidebar"><div className="sidebarTop"><a className="brand" href="#/overview" aria-label="CodeM 文档首页"><span className="brandMark"><Code2 size={21} /></span><span>CodeM<span className="brandDot">.</span></span></a><Button ref={menuButton} className="mobileMenu" variant="ghost" size="icon" aria-label={menuOpen ? "收起导航" : "展开导航"} aria-expanded={menuOpen} aria-controls="sidebar-content" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X /> : <Menu />}</Button></div><div id="sidebar-content" className={`sidebarContent ${menuOpen ? "isOpen" : ""}`}><div className="sidebarTitle"><span>App Server</span><span className="versionBadge">v{versions.sdk}</span><p>能力与接入指南</p></div><Navigation active={page?.id ?? ""} onNavigate={() => { setMenuOpen(false); main.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }) }} /><div className="sidebarFooter"><span className="footerEyebrow">RUNTIME BASELINE</span><div><span>Core</span><code>{versions.core}</code></div><div><span>CLI</span><code>{versions.cli}</code></div><a href="https://github.com/linmi/codem-vscode" target="_blank" rel="noreferrer">查看源码 <ArrowUpRight size={14} /></a></div></div></aside><main id="main-content" tabIndex={-1} ref={main}><div className="contentTopbar"><span>文档 <ChevronRight size={12} /> {page?.title ?? "未找到"}</span><span className="packageLabel">@codem/app-server</span></div><div className="pageBody" key={page?.id ?? hash}>{page?.id === "overview" ? <Overview /> : page ? <Article page={page} /> : <div className="notFound"><CircleHelp size={32} /><h1 tabIndex={-1}>页面未找到</h1><p>这个文档地址不存在，请从左侧导航选择内容。</p><Button asChild><a href="#/overview">返回能力总览</a></Button></div>}{page && <nav className="pageNavigation" aria-label="相邻文档">{previous ? <a href={`#/${previous.id}`}><ChevronLeft size={16} /><span><small>上一篇</small>{previous.title}</span></a> : <span />}{next && <a className="nextPage" href={`#/${next.id}`}><span><small>继续阅读</small>{next.title}</span><ArrowRight size={16} /></a>}</nav>}<footer className="pageFooter"><span>CodeM · 为应用构建 Agent 能力</span><span>TypeScript / Node.js</span></footer></div></main></div></>
}
