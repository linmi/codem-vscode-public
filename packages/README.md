# 通用包

| 包 | 职责 | 运行环境 |
| --- | --- | --- |
| `@codem/app-server` | Core 运行时解析与打包、认证代理、stdio RPC、连接及会话生命周期 | Node |
| `@codem/protocol` | 模型、技能、权限模式等共享类型和校验 | Host / 界面，无运行时依赖 |
| `@codem/session-history` | 只读解析 Core JSONL schema 13 历史及工具结果 | Node |

`app-server` 依赖 `protocol`。应用按需组合 `app-server` 与 `session-history`；两个服务包不依赖任何应用或界面框架。
