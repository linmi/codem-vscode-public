import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon, ArrowRight02Icon, ArrowUpRight01Icon, BookOpen01Icon, Cancel01Icon, CommandLineIcon, Database02Icon, FileScriptIcon, GitBranchIcon, HelpCircleIcon, HierarchyIcon, Layers01Icon, Menu01Icon, Message01Icon, PackageIcon, PlayIcon, Search01Icon, SecurityCheckIcon, Settings04Icon, SourceCodeIcon, Tick02Icon, WorkflowSquare01Icon } from "@hugeicons/core-free-icons"
import { Button } from "../components/ui/button.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { Input } from "../components/ui/input.tsx"
import { searchDocs } from "./docSearch.ts"
import { hostReference, coverage } from "./apiReference.ts"
import { ApiReference, EventReference, CoverageReport, exampleLocation } from "./referenceViews.tsx"
import { CodeBlock } from "./codeBlock.tsx"
import { pages, capabilityIds, resolveLocation, type DocPage } from "./content.ts"

const icons: Record<DocPage["icon"], IconSvgElement> = { overview: PackageIcon, start: PlayIcon, architecture: WorkflowSquare01Icon, stream: Message01Icon, sessions: GitBranchIcon, approval: SecurityCheckIcon, modes: Settings04Icon, skills: SourceCodeIcon, catalogs: HierarchyIcon, history: Database02Icon, examples: FileScriptIcon, limits: HelpCircleIcon, auth: SecurityCheckIcon, resources: CommandLineIcon, runtime: PackageIcon, api: SourceCodeIcon, events: WorkflowSquare01Icon, coverage: Tick02Icon }
const groups = ["开始", "核心能力", "参考"] as const
const versions = __RUNTIME_VERSIONS__
const overviewCode = `const host = createHost(packageRoot)\n\n// 订阅流式事件，再开始对话\nconst session = await startConversation(\n  host, cwd, onEvent,\n)\n\n// 应用退出时释放资源\nsession.unsubscribe()\nawait host.close()`
function Navigation({ active, onNavigate }: { active: string; onNavigate: () => void }) {
  const [query, setQuery] = useState("")
  const results = searchDocs(query)
  return <><label className="searchField sidebarSearch"><HugeiconsIcon icon={Search01Icon} strokeWidth={1.5} aria-hidden="true" size={15} /><Input aria-label="搜索文档" placeholder="搜索能力、方法…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery("") } }} /></label>{query && <div className="searchResultCount" role="status">找到 {results.length} 篇文档</div>}<nav aria-label="文档导航">{groups.map(group => {
    const groupPages = results.filter(page => page.group === group)
    if (!groupPages.length) return null
    return <div className="navGroup" key={group}><h2>{group}</h2>{groupPages.map(page => {
      const icon = icons[page.icon]
      return <a key={page.id} href={`#/${page.id}`} aria-current={active === page.id ? "page" : undefined} onClick={() => { setQuery(""); onNavigate() }}><HugeiconsIcon icon={icon} strokeWidth={1.5} aria-hidden="true" size={16} /><span>{page.title}</span>{active === page.id && <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.5} aria-hidden="true" size={14} className="activeChevron" />}</a>
    })}</div>
  })}{results.length === 0 && <div className="navEmpty"><p>没有找到相关文档</p><Button variant="ghost" size="sm" onClick={() => setQuery("")}>清除搜索</Button></div>}</nav></>
}

function SectionHeading({ index, title, english }: { index: string; title: string; english?: string }) {
  return <div className="sectionHeading"><span className="sectionNumber">{index}</span><h2>{title}</h2>{english && <span className="sectionEnglish">{english}</span>}</div>
}
function Overview() {
  return <>
    <header className="pageIntro"><div className="eyebrow"><span className="littleLabel">开发文档</span><span>Node.js · TypeScript · stdio</span></div><h1 tabIndex={-1}>CodeM App Server<span className="titlePeriod">.</span></h1><p>@codem/app-server 为应用提供统一的 CodeM 接入层。<br className="desktopBreak" />从会话、流式响应到工具与审批，找到你需要的能力和用法。</p><div className="introActions"><Button asChild><a href="#/quickstart">开始接入 <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={1.5} aria-hidden="true" size={15} /></a></Button><Button variant="outline" asChild><a href="#/examples"><HugeiconsIcon icon={SourceCodeIcon} strokeWidth={1.5} aria-hidden="true" size={15} />参考示例</a></Button></div></header>
    <a className="coverageRibbon" href="#/coverage"><span><HugeiconsIcon icon={Tick02Icon} strokeWidth={1.5} aria-hidden="true" size={15} />{coverage.hostMethods} 个 Host 方法 · {coverage.eventTypes} 类事件已建索引</span><span>查看覆盖评估 <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.5} aria-hidden="true" size={14} /></span></a>
    <div className="connectionStrip" aria-label="架构概览"><span><HugeiconsIcon icon={Layers01Icon} strokeWidth={1.5} aria-hidden="true" />你的应用</span><HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.5} aria-hidden="true" /><span className="stripHost"><HugeiconsIcon icon={CommandLineIcon} strokeWidth={1.5} aria-hidden="true" />App Server Host</span><span className="transportLabel">stdio <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.5} aria-hidden="true" /></span><span><HugeiconsIcon icon={PackageIcon} strokeWidth={1.5} aria-hidden="true" />CodeM Core</span></div>
    <section className="overviewSection"><SectionHeading index="01" title="可以做什么" english="Capabilities" /><div className="capabilityGrid">{capabilityIds.map((id, index) => {
      const page = pages.find(value => value.id === id)!
      const icon = icons[page.icon]
      const labels: Record<string, string> = { execution: "消息发送 · 流式响应 · 中断与补充", sessions: "创建与恢复 · 分叉 · 归档与回退", approvals: "权限审批 · 用户问答 · 计划确认", modes: "模型目录 · 计划模式 · 权限控制", extensions: "原生 Skills · MCP stdio · 后台任务", catalogs: "模型与扩展目录 · 工作空间绑定", history: "JSONL 持久历史 · 分页与恢复", resources: "终端进程 · 后台任务 · Shell 命令" }
      return <a className="capabilityCard" href={`#/${id}`} key={id}><div className="cardTop"><span className="cardIcon"><HugeiconsIcon icon={icon} strokeWidth={1.5} aria-hidden="true" size={19} /></span><span className="cardIndex">0{index + 1}</span></div><h3>{page.title}<HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.5} aria-hidden="true" size={16} /></h3><p>{labels[id]}</p><span className="cardMethod">{page.methods?.[0]}<span>查看用法 <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={1.5} aria-hidden="true" size={12} /></span></span></a>
    })}</div></section>
    <section className="overviewSection"><SectionHeading index="02" title="从一段对话开始" english="A first look" /><div className="examplePanel"><Tabs defaultValue="flow"><div className="exampleBar"><TabsList variant="line" aria-label="示例视图"><TabsTrigger value="flow">调用流程</TabsTrigger><TabsTrigger value="code">代码示例</TabsTrigger></TabsList><span className="sampleLabel">Node Host 示例</span></div><TabsContent value="flow"><div className="flowPreview">{[["1", "创建 Host", "运行时与认证"], ["2", "开始会话", "Core 分配身份"], ["3", "接收事件", "流式输出与审批"]].map(([num, title, note]) => <div className="flowStep" key={num}><span>{num}</span><strong>{title}</strong><small>{note}</small></div>)}</div><div className="flowNote"><HugeiconsIcon icon={Tick02Icon} strokeWidth={1.5} aria-hidden="true" size={15} /><span>监听 turn-completed，确认轮次的最终结果。</span></div></TabsContent><TabsContent value="code"><CodeBlock filename="usage.ts" code={overviewCode} /><p className="exampleNote">createHost 与 startConversation 的完整实现见「快速开始」。保持 Host 存活直至应用退出。</p></TabsContent></Tabs></div><a href="#/quickstart" className="textLink">查看完整接入步骤 <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={1.5} aria-hidden="true" size={14} /></a></section>
    <aside className="boundaryNote"><HugeiconsIcon icon={BookOpen01Icon} strokeWidth={1.5} aria-hidden="true" size={18} /><div><strong>先了解能力边界</strong><p>Node Host 负责连接，Core 负责执行，应用负责交互。<br />配置写入、MCP HTTP 等未支持能力，已在文档中明确标注。</p><a href="#/limitations">查看支持边界 <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.5} aria-hidden="true" size={13} /></a></div></aside>
  </>
}
function InlineText({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/g).map((part, index) => part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part)}</>
}
function Article({ page }: { page: DocPage }) {
  const examples = [...new Set(pages.flatMap(value => value.sections.flatMap(section => section.code ? [section.code] : [])))]
  return <><header className="articleIntro"><div className="eyebrow">{page.group}<span>/</span>{page.english}</div><h1 tabIndex={-1}>{page.title}</h1><p>{page.description}</p>{page.methods && <div className="methodTags">{page.methods.map(method => Object.hasOwn(hostReference, method) ? <a href={`#/api?method=${method}`} key={method}><code>{method}</code><HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.5} aria-hidden="true" size={12} /></a> : <code key={method}>{method}</code>)}</div>}</header>
    {page.sections.length > 1 && <nav className="pageContents" aria-label="本页目录"><span>本页内容</span><div>{page.sections.map((section,index) => <a key={section.title} href={`#/${page.id}?section=${index+1}`}><span>{String(index+1).padStart(2,"0")}</span>{section.title}<HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.5} aria-hidden="true" size={13} /></a>)}</div></nav>}
    {page.id === "examples" && <div className="recipeIndex"><h2>全部 {examples.length} 份示例</h2><p>点击跳到对应指南；所有文件都参加当前 SDK 的类型检查，浏览器不执行这些代码。</p><div>{examples.map(example=><a href={exampleLocation(example)} key={example}><HugeiconsIcon icon={FileScriptIcon} strokeWidth={1.5} aria-hidden="true" size={15} />{example}.ts<HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.5} aria-hidden="true" size={13} /></a>)}</div></div>}
    {page.sections.map((section, index) => <section id={`section-${index+1}`} className="articleSection" key={section.title} tabIndex={-1}><SectionHeading index={String(index + 1).padStart(2, "0")} title={section.title} /><p><InlineText text={section.body} /></p>{section.note && <aside className="callout"><strong>调用注意</strong><p>{section.note}</p></aside>}{section.table && <div className="tableScroll" role="region" aria-label={`${section.title}，可横向滚动查看表格`} tabIndex={0}><table><thead><tr>{section.table.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{section.table.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}><InlineText text={cell} /></td>)}</tr>)}</tbody></table></div>}{section.table && <p className="tableHint">窄屏可横向滚动查看完整表格。</p>}{section.code && <CodeBlock filename={`${section.code}.ts`} code={__CODE_EXAMPLES__[section.code]} />}{section.items && <ul>{section.items.map(item => <li key={item}><InlineText text={item} /></li>)}</ul>}</section>)}
    {page.sections.length > 0 && <div className="articleSource"><HugeiconsIcon icon={BookOpen01Icon} strokeWidth={1.5} aria-hidden="true" size={15} /><span>示例在 Node Host 中运行。<a href="https://github.com/linmi/codem-vscode/blob/main/packages/app-server/src/host.ts" target="_blank" rel="noreferrer">查看 Host 源码</a> · <a href="#/coverage">查看覆盖与验证范围</a></span></div>}</>
}
export function DocsApp() {
  const [hash, setHash] = useState(window.location.hash)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = resolveLocation(hash)
  const page = location?.page
  const main = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const previousHash = useRef<string | null>(null)
  useEffect(() => {
    const changed = () => { setHash(window.location.hash); setMenuOpen(false) }
    window.addEventListener("hashchange", changed)
    return () => window.removeEventListener("hashchange", changed)
  }, [])
  useEffect(() => {
    document.title = `${page?.title ?? "页面未找到"} · CodeM App Server`
    if (previousHash.current !== hash) {
      document.querySelector<HTMLElement>('[aria-label="文档导航"] [aria-current="page"]')?.scrollIntoView({ block: "nearest" })
      const section = location?.section ? document.getElementById(`section-${location.section}`) : null
      if (section) { section.scrollIntoView({ block: "start" }); section.focus({ preventScroll: true }) }
      else { window.scrollTo(0, 0); main.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }) }
      previousHash.current = hash
    }
  }, [hash, page, location?.section])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus() } }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [menuOpen])
  const index = pages.findIndex(value => value.id === page?.id)
  const next = pages[index + 1]
  const previous = pages[index - 1]
  return <><a href="#main-content" className="skipLink" onClick={event => { event.preventDefault(); main.current?.focus() }}>跳到内容</a><div className="siteFrame"><aside className="sidebar"><div className="sidebarTop"><a className="brand" href="#/overview" aria-label="CodeM 文档首页"><img className="brandMark" src="./assets/codemMark.svg" width="36" height="29" alt="" /><span>CodeM<span className="brandDot">.</span></span></a><Button ref={menuButton} className="mobileMenu" variant="ghost" size="icon" aria-label={menuOpen ? "收起导航" : "展开导航"} aria-expanded={menuOpen} aria-controls="sidebar-content" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} aria-hidden="true" /> : <HugeiconsIcon icon={Menu01Icon} strokeWidth={1.5} aria-hidden="true" />}</Button></div><div id="sidebar-content" className={`sidebarContent ${menuOpen ? "isOpen" : ""}`}><div className="sidebarTitle"><span>App Server</span><span className="versionBadge">v{versions.sdk}</span><p>能力与接入指南</p></div><Navigation active={page?.id ?? ""} onNavigate={() => { setMenuOpen(false); main.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }) }} /><div className="sidebarFooter"><span className="footerEyebrow">RUNTIME BASELINE</span><div><span>Core</span><code>{versions.core}</code></div><div><span>CLI</span><code>{versions.cli}</code></div><a href="https://github.com/linmi/codem-vscode" target="_blank" rel="noreferrer">查看源码 <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.5} aria-hidden="true" size={14} /></a></div></div></aside><main id="main-content" tabIndex={-1} ref={main}><div className="contentTopbar"><span>文档 <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.5} aria-hidden="true" size={12} /> {page?.title ?? "未找到"}</span><span className="packageLabel">@codem/app-server</span></div><div className="pageBody" key={page?.id ?? hash}>{page?.id === "overview" ? <Overview /> : page ? <><Article page={page} />{page.id === "api" && <ApiReference key={location?.method ?? ""} initialQuery={location?.method ?? ""} />}{page.id === "events" && <EventReference />}{page.id === "coverage" && <CoverageReport />}</> : <div className="notFound"><HugeiconsIcon icon={HelpCircleIcon} strokeWidth={1.5} aria-hidden="true" size={32} /><h1 tabIndex={-1}>页面未找到</h1><p>这个文档地址不存在，请从左侧导航选择内容。</p><Button asChild><a href="#/overview">返回能力总览</a></Button></div>}{page && <nav className="pageNavigation" aria-label="相邻文档">{previous ? <a href={`#/${previous.id}`}><HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.5} aria-hidden="true" size={16} /><span><small>上一篇</small>{previous.title}</span></a> : <span />}{next && <a className="nextPage" href={`#/${next.id}`}><span><small>继续阅读</small>{next.title}</span><HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={1.5} aria-hidden="true" size={16} /></a>}</nav>}<footer className="pageFooter"><span>CodeM · 为应用构建 Agent 能力</span><span>TypeScript / Node.js</span></footer></div></main></div></>
}
