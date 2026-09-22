# JetBrains 评审遗留问题修复验收

日期：2026-09-22。本轮范围是连接切换、历史字段校验、发送回执与草稿保留。

## 连接切换

- 根因：旧连接在新 Core 握手前退役，且旧 threadId、消息和资源句柄继续留在新连接中。
- ProjectSession 是连接状态唯一所有者。连接尝试保持旧 Core 存活；认证、空间准备、initialize、model/list 全部成功后，在锁内一起提交 Core、代次、空间和模型目录。
- 每次选择空间执行一次 auth status、一次 prepare、一次 Core 启动和一次 model/list；这些操作有前后依赖，没有重复初始化或额外目录缓存。
- 任一候选准备阶段失败，关闭候选并保留旧线程、消息和目录。成功后清除旧线程、回放游标、审批、附件/选区/目录句柄、工具目录、Diff 分片、后台进程和计时；保留草稿文字及主题、发送键、思考强度等本地偏好。
- 活跃轮次和重复连接尝试明确拒绝。关闭会话令候选代次失效，并等待候选最终回收。ToolWindowHost 重连复用现有 ProjectSession，注销和销毁后不再接受旧会话推送。
- 回归覆盖：prepare、进程启动、握手和模型目录失败；成功切换后的干净上下文；重复操作；初始化中关闭及进程回收。

## 历史读取

- 根因：错误类型被替换成空字符串，数值字段先取整再校验，合法 skill 输入也被还原为空文字。
- HistoryReplay 在读取边界拒绝非法 assistant_text.text、submission_id、input、record_seq 和 schema_version；错误包含线程和字段。技能调用按 name/arguments 还原。
- 保留已修正的 rewind_mark 元数据语义；cleared 才截断可见历史。没有引入新历史存储或旧名称兼容层。
- 回归覆盖：缺失、null、数字、布尔、数组、对象、空白正文、非整数序号/版本；合法文本、技能输入、回退标记和尾部未提交行。

## 发送与草稿

- 根因：Host 的临时用户消息先于 Core 回执发布，UI 把这行消息当成发送确认。
- ProjectSession 产生带 requestId 的 submission 回执；只有 Core 操作成功返回后才接受。前置校验、thread/start、turn/start 失败明确拒绝，失败发送的临时消息移除。未建立会话的失败由 Host 给出拒绝回执。
- 补充指令、旁路问答和 Shell 动作同样给出回执。Kotlin 编码、共享 UI 和 VS Code 调用方使用同一回执语义，不再从消息 ID、版本或 notice 推断发送结果。
- UI 等待期间保留原始草稿，重复提交禁用。拒绝保留原文；新输入不会被旧请求覆盖。只有成功且草稿仍是原文时清空。
- 浏览器入口把草稿与 Host 快照分开；草稿仅放在当前标签页的 sessionStorage，快照不能覆盖它。页面重载保留文字，不自动重发；关闭标签页不承诺恢复。没有写入项目文件。
- Kotlin 回归从真正的 send 调用链采集推送快照，覆盖提前拒绝、握手后发送失败、等待回执、成功和重复提交。UI 负向测试证明临时消息及无关提示不能充当回执。

## 验证结果与限制

| 层次 | 结果 |
| --- | --- |
| JetBrains 域测试 | 73 项通过；独立 check 通过 |
| 共享 UI | 19 项通过，类型检查通过 |
| VS Code 回归 | 398 项通过 |
| 静态检查 | 根目录 lint、全工作区 typecheck 通过 |
| 构建 | 完整 JetBrains build:plugin 通过，包含 src/plugin 适配层；VS Code build 通过 |
| 模拟界面 | 复用 4320 服务，单个 Playwright 会话验证生产 browser.js：临时消息、拒绝、重试成功、新草稿保护、刷新恢复均通过 |
| 完整 pnpm check | 未通过：未修改的 packages/app-server/tests/spaces.test.ts 首项 project_list 连续超时，单独执行同样复现；未跳过或放宽测试 |
| 真实 Core | 本轮未执行真实模型/账户请求 |
| 真实 IDEA / JCEF / 原生 Diff | 未部署到已打开的 IDEA，未重启用户窗口；编译和 HTTP 浏览器模拟不代替原生验收 |
| 真实 VS Code 操作 | 本轮未执行 |

浏览器复现脚本：`packages/ui/tests/draftBrowserChecks.mjs`，导出 `verifyDraftLifecycle(page)`，用于已打开生产 `index.html` 的 Playwright 页面，只注入 fixture 状态，不连接 Core。CLI 不支持动态 import 时，可把函数源码作为 run-code 的函数体加载执行。

本任务仅创建了 `codem-repair` 浏览器测试会话，验证后已关闭；保留原有预览服务和用户窗口。构建产物为 `apps/jetbrains/host/build/distributions/host-0.1.0.zip`。

全库检查还发现两处原有 VS Code 测试断言不准确：旧静态按钮检查已改为 React 挂载点及 surface 身份；进程 ID 检查改为结构化字段断言，避免随机 UUID 恰含数字 4321 造成误报。未修改对应生产业务。

本轮没有新生产依赖、双读双写或旧入口别名。功能状态仍分别由 ProjectSession、HistoryReplay 和共享 UI 草稿模块持有，没有新增循环或反向依赖。
