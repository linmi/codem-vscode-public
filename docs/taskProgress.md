# 任务工具进展卡片

`task_create` / `task_update` 使用独立的 React 卡片和本地 shadcn/ui Button、Collapsible；实时消息与 schema 13 历史共用 Host 的 `projectTaskDetails` 白名单投影。字段依据仓库锁定的 Core 0.8.44 安装产物中 TaskCreate / TaskUpdate 的工具声明：创建接收 summary、contents（字符串或 content/activeForm 对象）、replace；更新接收 updates 数组或单个更新对象，支持状态、内容、进行时文案、依赖增删和删除。未识别字段不进入 DTO，非法任务结构不产生推测的清单。

卡片展示该次工具调用的创建清单或变更，明确标注“本次创建 / 本次更新”。它是调用发生时的记录，不是跨调用合并的当前完整任务列表。更新没有 content / activeForm 时展示 Core 任务 ID，不从任意工具输出推测标题。整体执行计划仍由既有 `turn/plan/updated` 和运行详情负责。

工具 completed 只证明本次操作成功；创建后的任务保持 pending，更新使用输入中明确指定的任务状态。调用运行中、失败、拒绝、中断或没有终态时，任务行均标注请求内容未确认，不呈现成功勾选。重新收到调用结果时原位更新，保留用户展开详情的选择。无任务数据时显示明确的不可识别提示，输出仍可展开查看。

状态所有者仍是 ChatController 的消息快照和 Core 历史。卡片仅保存展开状态，不新增 RPC、子进程、缓存或持久化；重复快照不重挂载，重载依靠历史投影恢复任务数据，消息删除、切换会话和新建会话时卸载 React root。改动集中于工具投影、消息契约和 transcript 组件，无反向运行时依赖。

验证：`taskProgress.test.ts` 覆盖批量/单项输入、任务顺序、依赖、删除、字段隔离、非法旧输入拒绝、未确认状态和历史恢复；ChatController 测试覆盖独立 call/result 事件、失败及新会话清理；`taskProgressPreviewChecks.mjs` 在同一预览页检查深浅主题、380px 窄栏、键盘展开、重复快照、状态更新和会话清理。真实 Core 模型调用和真实 VS Code 操作不属于本轮已执行验证。
