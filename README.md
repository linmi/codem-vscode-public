# CodeM VS Code 重写工作区

旧项目已完整归档，新实现从独立目录重新开始。

| 目录 | 用途 |
| --- | --- |
| [`rewrite/`](rewrite/README.md) | 新项目的唯一开发目录，目前尚未创建应用代码或安装依赖。 |
| [`history/`](history/README.md) | 旧项目完整源码、测试、配置、依赖锁文件、许可证和迁移文档，仅作参考。 |

归档来源：`c389c6304f0108cd50fd31ad3b79bd5402f28ad2`，归档日期：2026-09-19。旧项目文件内容原样保留；已安装的本地依赖及生成文件也随目录移动，但仍不纳入版本控制。Git 历史保留在本仓库。

根目录不再提供旧项目的 package、workspace、构建或启动配置。`history/` 通过 `.ignore` 和 VS Code 工作区设置排除在默认搜索、文件监听及任务自动发现之外。不要把它加入新项目的 workspace、TypeScript include 或构建入口。需要查阅时可显式使用 `rg --no-ignore history/...`，或在 VS Code 搜索中关闭排除设置。

新界面参考 VS Code 原生 Chat 的布局和交互，后端围绕 CodeM App Server。历史实现只在有明确需求时按文件复制；复制时整理依赖、类型和必要测试，保留版权及许可证，并记录来源。新实现不得直接 import、链接或通过路径别名依赖 `history/`。

历史目录中的 README、AGENTS、计划和命令描述归档时的旧项目，不是新项目的开发指令。本次只完成归档与隔离，没有开始重写。
