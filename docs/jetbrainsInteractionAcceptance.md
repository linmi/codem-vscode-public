# JetBrains 审批、附件和 Diff 完整验收

2026-09-22。验收复用 IDEA 2026.2.3 同一个项目窗口，初始 Core 0.8.45，中途随既有升级任务切至 0.8.47；CLI 0.1.208。fixture、模拟界面、真实 Core、原生 IDEA 分别记录，未跑的项不视为通过。

结论：审批、附件和 Diff 的主要原生操作链路通过，附件生命周期、审批选项、多选协议和 Diff 句柄等问题已修复并回归；整体仍有保留项，不能标记为全部无异常。最终编辑轮次出现来源未确定的 Core 通用警告，且独立 JCEF 页面刷新尚未原生实测。下面各修复章节按阶段记录，当前结果以准出矩阵及最终操作复验为准。

## 附件生命周期修复

- 现状：附件 ID 按列表长度生成，删除再添加会碰撞；粘贴图片落到全局临时目录却没有所有者和清理路径，成功发送后仍留在附件栏。
- 目标：AttachmentCollection 独占句柄、待发送列表、自建图片文件和按连接代次关联的读取引用。业务文件由用户拥有，绝不删除；只回收本模块创建的临时图片目录。
- 首次/重复添加使用新 UUID；一次粘贴先验证整个批次，再原子发布。取消文件选择不变更状态。20 个附件与单次 20 MiB 为现有业务上限；MIME 与文件签名不符立即拒绝。
- 发送受理后移出附件栏；失败保留输入及附件。正在使用的图片在移除、切换时仍保留，直到对应轮次终态或 Core 退出。旧连接退出不能删除新连接仍使用的图片。
- 默认回归覆盖编号不复用、用户原文件保留、使用中图片延期释放、失败后重试、异常批次原子失败、数量/大小上限、已移除/重复/消失句柄拒绝。JetBrains check（91 项）已通过。
- 真实图像识别、原生选区/附件操作及完整 Diff 仍待后续记录。

## 准出矩阵

| 边界 | 成功路径 | 失败/取消/生命周期 | 真实操作 |
| --- | --- | --- | --- |
| 审批 | 允许一次及拒绝由 Core 接受 | 原生取消停止；旧请求/Ready 重放由回归覆盖；IDE 重启后无旧卡片 | IDEA + Core 通过 |
| 问答/计划 | 多题逐页、回退保留、自由文本、多选、计划同意/拒绝反馈 | 原生问答取消；非法选项/旧页由回归覆盖 | 多选修复后 IDEA + Core 通过 |
| 附件 | 文件、目录、文件图片、真实剪贴板、未保存选区均进入请求 | 原生移除/重加/选择器取消、失败保留及重试；关闭后私有图片目录实查已回收 | IDEA + Core 通过 |
| Diff | 实际变更统计、原生双栏及定位文件一致 | 分片/部分/二进制/损坏/路径逃逸/过期句柄由回归覆盖 | IDEA + Core 通过 |


## 审批展示与回答修复

- 原 Core 选项 ID 及中文问答标签直接充当 UI 句柄，共享界面只接收限定格式的句柄，导致部分选项消失。现在每页使用独立 UUID，请求/选项真实身份仅在 InteractionRouter 内映射。
- 多题问答逐页显示，使用共享界面已有确认/上一题能力；答案由请求所有者保存，回退显示之前选择和自由文本。最后一题才生成一次完整 Core answers；旧页句柄、重复选项、其他会话请求不能提交。
- 计划只显示同意/拒绝并展示计划正文，拒绝反馈仍发送给 Core。审批展示白名单 preview 字段，文件只展示名称，敏感详情不进入 UI。
- 取消权限审批遵循 VS Code 既有行为：停止轮次，不构造 Core 不支持的 cancelled 权限结果。终态和关闭撤销旧请求；界面重放复用同一请求状态。非法回答会换发可用面板，避免永久停在提交中。
- 默认 JetBrains 回归（96 项）通过，真实批准/拒绝路径正在验收；首次真实附件探针已确认旧临时路径不在 Core thread roots，正在单独修复该边界。


## 私有图片目录与真实 Core 验证

- Core 0.8.45 实测拒绝系统临时目录中的 localImage：图片不在 thread roots。现在 thread/start、resume 和 clear 一致加入本 Session 自建的独立图片目录；不授权整个系统临时目录，不把该内部路径作为用户额外目录下发 UI。
- 私有目录在 Session 生命周期内保持稳定，只在 Core 全部关闭后删除；每张图片仍在对应读取引用释放后清理。删除再添加不会造成 Core 根目录失效。发送前重新检查原附件路径，防止选择后被符号链接替换。
- 额外目录重配统一经过已有 unsubscribe/resume 路径，移除原来直接重复加载当前会话的 resumeWithDirectories 入口，避免重配时丢掉图片目录或触发 already loaded。内部调用和测试同步迁移，无持久数据格式变化。
- 显式 `test:live --tests '*LiveToolTest'` 修复后通过：模型读到文件、目录、未保存选区标记和图片左右红/蓝；Core 各出现一次拒绝与允许审批，拒绝后磁盘未变，允许后修改成功；Diff +1/-1，两侧分别含原值/新值。只使用临时 fixture，真实 Core 已退出。
- 模型调用的正常执行为一次上下文读取、一次拒绝修改、一次允许修改；没有改账户、没有扩大到用户真实文件。此前失败的探针在 turn/start 校验阶段即被拒绝，不作为完成证据。

## Diff 协议与会话边界修复

- 当前问题：分片虽有顺序检查，但缺失字段、浮点计数、行号和统计不一致可能被默认值掩盖；恢复/新建会话未完整清除原会话内容与分片缓存。
- 目标边界：FileDiffAssembler 只接收锁定 Core 协议的合法分片，完整 JSON 后一次发布；Session 独占当前会话的汇总、内容和分片缓存，恢复成功、新建和连接重置统一清理。失败恢复不会把不完整 JSON 展示为 Diff。
- 对齐 packages/app-server/src/items.ts 的身份、布尔值、整数、行号连续性、hunk 计数与总统计校验；每条内容限制 8 MiB。二进制、无内容与仅 raw 文本不伪造左右文件。原生展示仅使用 Core 文本和文件名推断语言，不按返回路径读取本机文件，因此路径逃逸不能造成额外文件读取。
- 默认 101 项回归通过，包含分片完成前不展示、重复/乱序/身份切换拒绝、损坏字段、部分/二进制/省略、大小限制、会话恢复清理及分片编号复用。严格解析后的真实 LiveToolTest 再次通过（40 秒，附件、拒绝/允许、+1/-1 与前后内容）。
- 修改集中于 Diff 解析和 Session 清理，未新增共享状态或依赖方向；原生窗口操作仍待下一步实测。

## 原生文件定位补齐

- 实测原生 Diff 左右与磁盘一致，但资源面板的“在编辑器中打开文件”发送 openChangedFile，JetBrains 尚未接入该动作，日志明确记录拒绝。现在增加同名入站动作，Session 只解析当前 Diff 的不透明句柄，Host 在 IDEA 线程刷新并打开文件。
- 文件导航不增加持久状态；受当前 Session 的 Diff 清理规则约束。打开前检查工作区信任、真实路径仍在项目/已选目录、文件确实存在。已删除文件、跨根相对路径、符号链接逃逸和会话切换后的旧句柄均明确失败，不向 Webview 暴露路径。
- 默认 102 项测试通过，包含真实临时目录与符号链接的正负向导航回归。真实 IDEA 验证等待安装本次 JAR。

## 发送拒绝后的图片回收

- 集成审查发现：Core 明确拒绝 turn/start 时，待发送附件保留正确，但读取引用未释放；用户随后移除图片仍需等下一轮终态或断连才回收。
- JSON-RPC 对应请求的 error 现在显式建模为 RequestRejected，与超时、连接断开等结果不明错误区分。只有明确拒绝的 turn/start 释放该连接的附件读取引用；输入栏继续保留附件供重试，移除后立即回收。超时/结果不明仍持有图片直到 Core 终态或退出，不提前删掉可能还在读取的文件。
- 选区先校验，再获取附件读取引用；本地失效选区不会留下未发送的引用。回归覆盖真实 Session 拒绝→保留→移除→文件消失，以及 RPC 明确拒绝和断连不能混淆。
- Core 0.8.47 附件复测一次在颜色回答断言失败（原输出未记录），不能判定原因；补充 fixture 响应日志后复测通过，未修改或放宽原断言。后一次包含英文 LEFT=red/RIGHT=blue、三个标记和拒绝/允许/Diff 完整链路。保留前一次失败，不声称稳定性已经得到长期验证。

## Diff 句柄不跨会话复用

- 补查原路径列表发现：清空后再次从 diff-1 编号，旧页面延迟点击可能命中新会话的第一个变更。现在当前 Session 保存 UUID→路径映射；同会话同一路径稳定，恢复/新建清理后重新生成 UUID。
- 不改变 Core 或持久数据协议；UI 仍只发送不透明 ID。生产数字序号解析入口已删除。回归在新会话已有可打开 Diff 时重放旧 ID，确认查看差异和打开文件均拒绝，新 ID 仍可用。

## 真实 IDEA 已执行记录

复用 IDEA 2026.2.3 唯一 codem-plugin 窗口，所有文件操作限定在本任务 `.artifacts/jetbrainsAcceptance/`。未创建开发沙箱或额外浏览器。

- Core 0.8.45：原生文件选择器取消后没有附件；加入 sample.txt、context 目录及 colors.png，移除 sample.txt 再加入，其余附件不受影响。发送受理后附件栏清空。模型实际报告 IDEA_FILE_MARKER_MAGENTA、IDEA_DIRECTORY_MARKER_CYAN 及图片左红右蓝。
- 审批模式显式切至“默认权限”；编辑 sample.txt 的审批卡显示三个 Core 选项。选择 reject_once 后工具显示 denied by user，轮次结束，磁盘仍为 color=red。再次提交并选择 allow_once，磁盘变为 color=green、标记保留。全程未选始终允许或完全访问。
- 编辑器 selection.txt 原磁盘内容 SAVED_MARKER_GRAY；在 IDEA 中修改并选中 IDEA_UNSAVED_MARKER_YELLOW，未保存时直接读取磁盘仍为旧值。模型通过选区附件精确回复新标记。随后为重载保存该测试文件，不将保存后状态冒充未保存验收。
- 文件资源面板显示 sample.txt +1/-1；点击查看差异打开 IDEA 原生双栏，AX 的 Before/After 分别为原标记+color=red / 原标记+color=green。不是文件名占位或模拟截图。
- 再次请求 green→blue，关闭审批卡。界面显示“已停止 · 已处理 39秒”，输入恢复，磁盘保持 green；旧审批未复活。
- 中途另一个已授权任务升级锁定 Core 到 0.8.47。本任务先保存/退出同一 IDEA，再逐文件比对安装 ZIP，仅替换变化的 runtime manifest、Core 和 JAR。升级后的 green→purple 修改、原生 Diff 前后与磁盘一致。首次点击“打开文件”失败后已修复，更新 JAR 后真实打开 sample.txt 编辑器，AX 内容为保留标记+color=purple。
- 该阶段安装 JAR SHA256 为 fb45e08fb60c8e846fa5167eda16bf9529e388ef99bd8edc613d8cc0e84ee1c4，含明确拒绝回收和 UUID Diff 句柄修复。Core 0.8.47 / CLI 0.1.208。
- 该阶段 JAR 的真实剪贴板链路：在系统预览打开本任务 colors.png，复制图像→IDEA 粘贴→移除→再次粘贴→发送。模型回复 LEFT 纯红色 #FF0000、RIGHT 纯蓝色 #0000FF。发送后待发送附件清空；本任务创建的 colors.png 预览窗口已关闭，原有 previewDashboard.png 窗口保留。

原始本机 Host 动作记录在 `~/Library/Logs/JetBrains/IntelliJIdea2026.2/idea.log`（17:24 起）。以上用原生 AX/截图、文件实值与 Host 动作相互核对。模拟预览和真实 VS Code 未由本任务单独运行，不借用它们声称本次 IDEA 验收通过。

## 真实多题问答发现的协议问题

- 原生第一页选择 Magenta 并填写 NOTE_ONE，下一步→上一题后选择和文本均保留；改为 Cyan/NOTE_TWO，再进入第二题时发现 Small 和 Large 不能同时选中。为避免提交错误结果，已通过关闭卡片取消此次真实问答。
- 显式 LiveQuestionTest 捕获 Core 0.8.47 实际 item/tool/requestUserInput：questions 中字段为 multiSelect=false/true。原解析识别 allowsMultipleSelection / multi_select，因此把多选当成单选；新增实测在修复前稳定失败于 second.multiple。
- 唯一目标模型为锁定 Core 的 multiSelect：省略是单选默认值，提供时必须是布尔值。删除旧字段读取，旧字段输入和错误类型明确拒绝；同步更新 JetBrains 生产解析、fixture、负向回归和真实测试。无持久数据或独立消费者需要接受旧入站字段。
- 此处只改变 JetBrains 的 Core 入站适配，共享 UI 的 multiple 属性不变。Node App Server 独立适配存在同样旧读取（host.ts questionList），已向正在处理 Core 升级的既有任务提供证据，未在 IDEA 变更中混入另一客户端修改。
- 修复后 LiveQuestionTest 通过，Core 接收 Cyan、Small + Large、NOTE_TWO；默认 105 项回归通过。默认检查中另暴露一个 fixture 竞态：等待 Diff 后即断言尚未消费的 thread/status/changed；已改为等待该状态实际到达，保留全部原断言。

## 最终操作复验

- 最终安装的多选修复 JAR 为 `dd5cec4fb1f8b38fd90693eff68ec542555c8e34be214c28ecdc74caaa0c23a5`，Core 0.8.47。原生第二题同时显示 Small、Large 两个勾选，提交后模型确认 Cyan + NOTE_TWO、Small + Large 两项。此前失败的原生探针未作为通过证据。
- 计划拒绝：先填写 PLAN_FEEDBACK_ORANGE，再选择拒绝。Core JSONL tool_result 明确为 `rejected: PLAN_FEEDBACK_ORANGE: do not read the fixture; end this acceptance turn.`，后续没有读取文件。计划同意：原生点击同意，Core 记录 approved，随后仅一次 read_files 读取 sample.txt，得到原标记和 purple；没有编辑、shell 或 Git。
- 实际附件失败恢复：原生加入 retry.txt 后暂时把该测试文件改名为 retry.held。发送显示 `CodeM attachment no longer exists`，原文本和附件仍留在输入栏。恢复文件原名后点击发送，附件与草稿清空，模型返回 IDEA_RETRY_MARKER_TURQUOISE。没有重新添加附件或重复录入文本。
- 从本任务图片会话的 Core 工具记录定位私有 PNG，关闭该 Session 后核查该 PNG 及其独立目录都不存在；原 colors.png 保留。Native 复制图片只创建一个本任务 Preview 窗口，已关闭；不关闭其他测试窗口。
- 在本任务代码提交 `f58a748c` 时，全仓 `pnpm check` 通过（lint、所有活跃包类型检查及默认测试）；此后其他任务的未提交修改不在该结论内。JetBrains 默认 105 项。显式 LiveToolTest、LiveQuestionTest 各自通过，未把真实模型调用加入默认检查。独立 JCEF 页面刷新仍只有 Ready 重放回归，未通过原生专用刷新入口实测；IDE 完整重启和重连已实际执行。

- 最终 JAR 原生审批和 Diff 复验：默认权限下，点击一次 allow_once；Core edit_file 仅替换 retry.txt 标记，磁盘为 IDEA_FINAL_MARKER_SILVER。资源面板为 retry.txt +1/-1；原生双栏 AX Before=IDEA_RETRY_MARKER_TURQUOISE、After=IDEA_FINAL_MARKER_SILVER；“打开文件”实际打开 retry.txt，编辑器 AX 与磁盘一致。UUID 句柄路径在最终安装版本中实际可用。
- 该最终轮次不是无异常样本：界面终态显示“已处理 4分1秒”及 `CodeM reported a warning`，没有展示最终回复正文。自己的 schema 13 历史记录可见一次 edit_file 成功、一次 read_files 回读和后续 assistant_text；Core 自检还根据同时变化的工作树插入了两条 synthetic 消息，模型明确保留其他任务修改。只能确认编辑、审批及 Diff 成功，不能由这些历史记录推断实时警告的具体原因或完整正常终态。Host 警告经过 SafeNotice 泛化，现有日志没有保留可定位的原因，未声称警告已解决。总耗时包含人工审批等待及 Core 自检，不能当作单次编辑性能。

## 保留项与准出边界

1. P1：最终轮次的通用警告及正文未显示。证据为最终原生界面与上述同会话历史不一致；可观察交付为同样的单文件批准操作正常显示回复和终态，或给出准确可操作的失败原因。限定 JetBrains 通知诊断、投影与终态展示，不改 Core 自检策略或其他任务文件；准出须由脱敏事件证据定位原因、相应正负向回归通过，再在同一个 IDEA 窗口复验。
2. P2：独立 JCEF 页面刷新。当前只有 Ready 重放回归和完整 IDE 重启证据；原生界面未找到专用刷新入口，Cmd+R 未触发 Ready，不能算刷新成功。限定页面/Host 生命周期；准出是在待审批及已选择的问答页实际重建 JCEF 后，恢复当前合法状态、拒绝旧页提交且 Core 只收到一次完整回复。不为验收临时增加生产测试后门。

本次已完成并验证的代码按独立边界提交，未 push。模拟界面和真实 VS Code 未单独运行；真实 IDEA 与显式真实 Core 分开留证。105 项默认回归覆盖失败、取消、非法输入及句柄/资源生命周期；这些测试不能替代上面两项尚未完成的原生证据。
