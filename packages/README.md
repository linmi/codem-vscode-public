# 通用包

| 包 | 职责 | 运行环境 |
| --- | --- | --- |
| `@codem/app-server` | Core 运行时解析与打包、认证代理、stdio RPC、连接及会话生命周期 | Node |
| `@codem/protocol` | 模型、技能、权限模式等共享类型和校验 | Host / 界面，无运行时依赖 |
| `@codem/history` | 只读解析 Core JSONL schema 13 历史及工具结果 | Node |
| `@codem/contracts` | 跨语言样例与基线，不是运行时服务 | 构建 / 测试 |
| `@codem/ui` | 双宿主正式聊天壳（composer / 菜单 / 交互 / 运行信息 / 共享消息列表安全 Markdown） | 浏览器 |

`app-server` 依赖 `protocol`。应用按需组合公开导出；服务包不依赖任何应用或界面框架。
