# 路线图

> Starter 的功能演进路线。每完成一个里程碑打勾。

- [x] **v0.0.x** 项目骨架（CI / Husky / lint / 4 个 workspace 包占位）
- [ ] **v0.1.0** MVP：F1 扫描 / F2 启停 / F3 延迟 / F4 依赖 / F5 并发 / F6 IO 节流
- [ ] **v0.2.0** F7 时间线 / F10 托盘
- [ ] **v0.3.0** F8 进程优先级
- [ ] **v0.5.0** F11 CLI 完整实现
- [ ] **v0.6.0** F12 MCP Server 完整实现
- [ ] **v1.0.0** 文档完善、UI 打磨、代码签名

## 当前进度

根据 [开发日志](dev-log)，最新批次为 **Batch 12**：

- ✅ Agent Settings 完整化：MCP **17 tools + 3 resources + 3 prompts** + 防环 DAG + undo 撤销 + op_log 审计
- ✅ 单测 **142/142** 全过，typecheck / lint 0 错
- ✅ 新增 `docs/AGENT_API.md`（Agent/MCP API 完整文档）

**下一批**：Batch 13 = Tauri bundle (.msi/.nsis) + GitHub Actions 自动打包 + i18n 收尾。

## 详细规划

完整的产品需求与数据模型见 [PRD](prd)。
