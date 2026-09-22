import { useState } from "react"
import { ArrowRight, ArrowUpRight, Check, Search } from "lucide-react"
import { Input } from "../components/ui/input.tsx"
import { Button } from "../components/ui/button.tsx"
import { apiEntries, coverage, eventReference } from "./apiReference.ts"
import { pages } from "./content.ts"

export function exampleLocation(example: string) {
  for (const page of pages) {
    const index = page.sections.findIndex(section => section.code === example)
    if (index !== -1) return `#/${page.id}?section=${index + 1}`
  }
  return undefined
}
export function ApiReference({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery)
  const filtered = apiEntries.filter(item => `${item.name} ${item.purpose} ${item.boundary}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="referenceBody"><div className="referenceToolbar"><label className="searchField"><Search size={16} /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="查找方法或用途…" aria-label="筛选 API" /></label><span aria-live="polite">{filtered.length} / {apiEntries.length} 个方法</span></div><p className="referenceHint">签名省略 readonly 等修饰。准确类型以 SDK 为准；下方同时列出使用条件与示例缺口。</p><div className="apiList">{filtered.map(item => <article className="apiCard" key={item.name}><div className="apiTitle"><h2>{item.name}</h2><span className={`evidenceBadge ${item.example ? "hasExample" : ""}`}>{item.example ? "附调用示例" : "接口说明"}</span></div><p>{item.purpose}</p><code className="signature">{item.signature}</code><p className="apiBoundary">{item.boundary}</p><div className="apiLinks"><a href={`#/${item.page}`}>阅读指南 <ArrowRight size={14} /></a>{item.example && <a href={exampleLocation(item.example)}>查看 {item.example}.ts <ArrowUpRight size={14} /></a>}</div></article>)}</div>{filtered.length === 0 && <div className="emptyState"><Search size={24} /><h2>没有匹配的方法</h2><p>试试 thread、模式或 cancel。</p><Button variant="outline" onClick={() => setQuery("")}>清除筛选</Button></div>}</div>
}
export function EventReference() {
  return <div className="referenceBody"><aside className="callout"><strong>先关联身份，再更新界面</strong><p>按连接、threadId、turnId 校验归属。切换上下文后丢弃旧事件；只有 turn-completed 和 side-question-completed 分别决定主轮次与旁问的终态。</p></aside><div className="eventList">{Object.entries(eventReference).map(([name, [fields, handling]]) => <article className="eventRow" key={name}><h2><code>{name}</code></h2><p>{handling}</p><div><span>字段</span><code>{fields}</code></div></article>)}</div></div>
}
export function CoverageReport() {
  const missing = apiEntries.filter(entry => !entry.example)
  const grouped = pages.map(page => ({ page, entries: apiEntries.filter(entry => entry.page === page.id) })).filter(group => group.entries.length)
  return <div className="referenceBody"><div className="coverageSummary"><span className="littleLabel">2026-09-22 · 当前 Host 类型基线</span><h2>接口可查，示例仍有缺口。</h2><p>当前可以用作能力地图和接入参考；还不能替代完整 API 手册或端到端验收。下面分别统计，避免用一个百分比掩盖差异。</p></div><div className="coverageStats"><div><strong>{coverage.hostMethods}<small> / {coverage.hostMethods}</small></strong><span>Host 方法有接口说明</span></div><div><strong>{coverage.methodsWithExamples}<small> / {coverage.hostMethods}</small></strong><span>Host 方法有调用示例</span></div><div><strong>{coverage.eventTypes}<small> / {coverage.eventTypes}</small></strong><span>Host 事件有字段与处理规则</span></div></div><section className="coverageSection"><h2>统计口径</h2><p>分母是 <code>keyof AppServerHost</code> 中可调用的全部公开实例方法与 <code>AppServerHostEvent["type"]</code> 的事件联合类型。TypeScript 校验清单完整性；每项示例必须链接到实际展示的源码，并在示例中调用该方法。</p><p>只读属性 hasActiveWork（是否存在活跃主轮次或旁问）、构造参数、顶层认证 / 空间 / 运行时函数、底层 RPC 与解析 helper、子路径导出，以及相邻的 history 包不在这两个分母内。已有部分专题说明，不宣称整个 npm 包 100% 覆盖。</p></section><section className="coverageSection"><h2>按能力查看</h2><div className="tableScroll"><table><thead><tr><th>能力</th><th>接口说明</th><th>调用示例</th></tr></thead><tbody>{grouped.map(({page,entries}) => <tr key={page.id}><td><a href={`#/${page.id}`}>{page.title} <ArrowUpRight size={13} /></a></td><td>{entries.length} / {entries.length}</td><td>{entries.filter(item=>item.example).length} / {entries.length}</td></tr>)}</tbody></table></div></section><section className="coverageSection"><h2>还缺哪些示例</h2><p>以下方法目前只有输入、输出和边界说明，未算入示例覆盖：</p><div className="gapList">{missing.map(item=><a key={item.name} href={`#/api?method=${item.name}`}><code>{item.name}</code><ArrowUpRight size={13} /></a>)}</div></section><section className="coverageSection"><h2>验证到哪一层</h2><div className="verificationRows"><div><Check size={17} /><strong>类型与文档一致性</strong><span>示例编译、方法清单、事件清单、链接校验</span></div><div><Check size={17} /><strong>网页交互</strong><span>浏览器验证；不调用 Core</span></div><div><span className="uncheckedMark">—</span><strong>真实 Core / IDE</strong><span>本轮未执行，不计入文档覆盖率</span></div></div></section><aside className="callout"><strong>仍需补齐的接入证据</strong><p>顶层函数与底层协议尚未逐项建档；问答 / 回退 / 清空的完整示例、故障注入、真实 Core 与 IDE 操作仍不完整。独立的 plugin 管理命令不属于 AppServerHost 方法，本次未评估其文档完整性与实际执行结果。</p></aside></div>
}
