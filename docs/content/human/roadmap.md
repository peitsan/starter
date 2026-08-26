# 路线图

> Starter 的功能演进路线。每完成一个里程碑打勾。

- [x] **v0.0.x** 项目骨架（CI / Husky / lint / 6 个 workspace 包占位）
- [x] **v0.1.0** MVP：F1 扫描 / F2 启停 / F3 延迟 / F4 依赖 / F5 并发 / F6 IO 节流 + F11 CLI + F12 MCP 基础
- [x] **v0.2.0** F7 时间线 / F10 托盘 / daemon 服务 / Tauri 壳 / MCP 完整
- [ ] **v0.3.0** F8 进程优先级（真 CreateProcess + Priority）
- [ ] **v1.0.0** 计划任务/服务扫描、UI 打磨、代码签名

## 当前进度

最新批次为 **Batch 12（M0–M3 审计里程碑）**：

- ✅ 写操作统一走 daemon：ipc-client / registry / CLI / MCP 全部路由到 HTTP RPC（本地 fallback）
- ✅ core 支撑：transfer（导入导出）/ configAll / dependencyGraph / listChanges
- ✅ MCP **27 tools + 6 resources + 5 prompts**（含 yes 确认流）+ SSE transport（127.0.0.1:7812）
- ✅ 单测 **158/158** 全过，typecheck 0 错
- ✅ 全量源码审计 → [AUDIT_REPORT.md](../AUDIT_REPORT.md)
- ✅ 系统手册 / 开发手册 → [系统手册](system-manual) / [开发手册](developer-manual)

**下一批**：Batch 13 = Tauri bundle (.msi/.nsis) + GitHub Actions 自动打包 + 计划任务/服务扫描。

## 详细规划

完整的产品需求与数据模型见 [PRD](prd)。