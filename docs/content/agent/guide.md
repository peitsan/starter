# Starter — AI Agent 指南

> **写给 LLM agent 看的项目使用文档**。读这份文档就能调起 Starter 的全部能力。

## 这是什么

**Starter** 是一个 Windows 启动项管理软件。它能：
- 扫描所有开机自启的进程（注册表 + 启动文件夹）
- 启/停某个启动项
- 给启动项设延迟（DAG 依赖图）
- 监控磁盘 IO，盘炸了自动暂停下一批启动
- 通过 **MCP 协议**让 LLM 直接控制

**核心差异化**：磁盘 IO 感知的启动调度 — 硬盘 I/O 高时自动不塞新启动项。

## 三种使用方式

| 方式 | 适用 |
| --- | --- |
| **MCP 接入**（推荐） | Cursor / Claude Desktop / DSH 内的 agent |
| **CLI 命令行** | 写脚本 / 自动化 |
| **直接调 SDK** | 嵌入到自己的 Node.js 项目 |

## 一句话总结

> 调 `scan_startup_items` 拿数据 → 用 `list_startup_items` 查 → 用 `set_delay` / `enable_*` / `disable_*` 改 → 完事。

## 导航

| 页面 | 内容 |
| --- | --- |
| [30 秒上手](quick-start) | 最快路径：接入 + 一个完整任务 |
| [工具一览](mcp-tools) | 17 个 MCP 工具完整表 |
| [MCP API 参考](api) | 传输 / 资源 / prompts / 撤销机制 |
| [错误码](errors) | E_ 系列错误码与含义 |
| [常见场景](scenarios) | 8 个典型自然语言请求 → 工具调用链 |
| [约束 & 安全](constraints) | 必须遵守的规则 |