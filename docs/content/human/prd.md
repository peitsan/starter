# PRD — 产品需求文档（摘要）

> 完整版见仓库 [`docs/PRD.md`](https://github.com/peitsan/starter/blob/master/docs/PRD.md)。

## 产品定位

Starter 是一个 **Windows 启动项管理软件**，核心差异化是 **磁盘 IO 感知的启动调度** —— 硬盘 I/O 高时自动不塞新启动项。

## 12 个特性（F1–F12）

| 编号 | 特性 | 说明 |
| --- | --- | --- |
| F1 | 扫描 | 注册表 / 启动文件夹 / 计划任务 / 服务 |
| F2 | 启停 | 启用 / 禁用启动项 |
| F3 | 延迟 | 设置延迟毫秒 |
| F4 | 依赖 | DAG 依赖图，自动防环 |
| F5 | 并发 | 并发数限制 |
| F6 | IO 节流 | 磁盘 IO 感知，动态暂停/续跑 ⭐ |
| F7 | 时间线 | 启动事件时间线 |
| F8 | 进程优先级 | 设置进程优先级 |
| F10 | 托盘 | 系统托盘常驻 |
| F11 | CLI | 命令行入口 |
| F12 | MCP | LLM Agent 接入 |

## 数据模型要点

- **SQLite** 存储，`schema_version = v1`
- **fingerprint**：启动项稳定 id（基于 source + source_path + name 哈希）
- **risk**：critical / normal / recommend_off
- **op_log**：写操作审计日志

## Release 计划

- v0.1.0 MVP（F1–F6）
- v0.2.0 F7 / F10
- v0.3.0 F8
- v0.5.0 F11
- v0.6.0 F12
- v1.0.0 打磨

> 完整的 CLI & MCP 附录、错误码、配置项见仓库 PRD 附录 A。
