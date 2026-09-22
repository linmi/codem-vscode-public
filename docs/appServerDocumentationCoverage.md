# App Server 网页阅读与覆盖评估

日期：2026-09-22。改动基线 `0c17e7e6`。评估公开 Node Host 及文档使用流程，不改变 App Server 行为，不运行用户会话或账号写入。

## 结论与证据

原版可用作概览，但不足以作为完整接入参考：正文与代码对比度偏低；长页无定位；方法标签不能查契约；9 个示例实际调用 12 个不同 Host 方法；认证、运行时、资源管理、事件字段缺少独立参考。模型文案还误将推理强度归于模型目录，源码 `CodemModelCatalog` 实际只提供 activeModel / models，强度来自共享枚举，已修正。

本轮改善阅读、检索与可核对的接入说明：保留居中双栏，增强正文与代码对比度，常驻搜索与导航分区滚动；增加章节目录和可刷新深链接，方法可直达筛选后的 API，再跳转到真实示例；手机参数表在局部横向滚动，保持标识符完整。

| 指标 | 本轮结果 | 口径与限制 |
| --- | --- | --- |
| Host 方法索引 | 38 / 38 | 可调用公开实例方法；每项有签名摘要、用途、条件和所属指南 |
| Host 调用示例 | 23 / 38，约 61% | 基线 12 / 38，约 32%；示例文件从 9 增至 16。仅计实际调用，不计注释提及 |
| Host 事件参考 | 31 / 31 | 事件联合类型逐项对应字段与消费规则；不是所有通知的端到端实测 |
| 本轮真实 Core / IDE 验收 | 未执行 | 不用类型检查、接口数量或页面截图代替运行验收 |

分母由 AppServerHost 的可调用公开成员与 AppServerHostEvent 的 type 联合类型约束。`apiReference.ts` 使用穷尽 Record；增加或移除公开方法 / 事件将影响文档类型检查。示例映射、可达页面和真实调用引用由测试检查；这项机械检查只证明引用关系，执行语义仍依赖代码审阅、SDK 测试与真实运行。

不在上述分母：hasActiveWork 只读 getter、构造参数、顶层认证 / 空间 / 运行时函数、独立 plugin 管理命令、底层 RPC 与解析 helper、子路径导出，以及 @codem/history。已有部分专题说明，但未对这些边界逐项建档，不能宣称整个包 100% 文档覆盖。

## 剩余缺口

目前无完整调用示例的 15 个 Host 方法：compactThread、rewindThread、readEnvironmentInfo、readConfigSnapshot、listHooks、listPlugins、listPermissionProfiles、readCoreSpaceSnapshot、readModelProviderCapabilities、terminateBackgroundTerminal、cleanBackgroundTerminals、runShellCommand、clearThread、control、unsubscribeThread。

审批示例仅展示 permission；多题问答、计划、回退选择等变体仍没有完整接入示例。clear / rewind 等影响上下文的流程、顶层函数、故障注入和跨平台真实操作仍需补充。Core 0.8.47 压缩终态缺陷沿用仓库已有验收证据，本轮未重新验证。独立插件管理在同工作区另一任务中完成，不纳入本轮 Host 清单或验收结论。

## 状态与范围

- 搜索仅依赖静态内容，不创建认证、RPC、子进程或缓存；首次为空，结果为空有明确反馈，Escape 清空。页面选择清理搜索。
- 方法直达与章节定位保存在 URL；刷新、前进后退可恢复；非法方法 / 章节显示未找到。方法筛选是当前 API 页面局部状态，离开后释放。
- 移动导航默认关闭、选择后关闭；阅读焦点移至标题或目标章节；当前导航项保持可见。新增 Input 复用已有 shadcn 源码及许可证。
- 新内容 / 参考 / 搜索均在 docs 功能目录；UI 仅 type-import SDK，不加载 Node 实现。没有旧生产入口迁移，没有新生产依赖。

## 验证

- 文档 typecheck、5 项文档测试、静态构建、docs Oxlint、git diff --check 通过。类型检查包含全部 16 个示例。
- 浏览器复用原标签与本地 4174 服务；验证方法标签 → API 筛选 → 示例章节 → 刷新定位 / 焦点，中文及方法搜索、无匹配与清除 / Escape 恢复、38 条 API 和 31 条事件展示、新增认证示例复制成功。
- 桌面检查常驻侧栏与阅读样式；390 / 320 宽度下页面不横向溢出。参数表内容宽 580px，仅表格容器滚动；320px 覆盖页整体宽仍为 320px。测试后恢复默认 viewport；控制台无 warning / error。
- 根目录 pnpm check 在全局 lint 阶段被独立的未提交 VS Code 变更阻塞：`apps/vscode/src/integrations/nextEdit/nextEditProposal.ts:30`，`eslint(no-control-regex)`。本轮没有修改该文件；全仓 typecheck / test 阶段未执行。
- 本轮未再次模拟剪贴板拒绝权限，未执行真实 Core、模型任务或 IDE 操作；未部署、未 push。
