# 开发日志

> 批次记录。最新批次为 **Batch 12**。

## Batch 12 — Agent Settings / MCP 完整化

**目标**：服务流出 MCP，让外部 Agent 能完整操作排程表。

**实装**：
- store 新增 `dependencies.ts`（依赖仓库，防环 DFS）与 `op-log.ts`（审计仓库）
- controller 新增 `addDependency` / `removeDependency` / `listDependencies` / `applyPreset` / `undoLast` / `scheduleRun` / `timeline` / `ioStatus` / `serviceStatus`
- **op_log 统一**：写操作全部走 items 层（自带审计，含 prev/next）
- MCP 扩到 **17 tools + 3 resources + 3 prompts**

**结果**：✅ core 86 + daemon 30 + ui 14 + cli 9 + mcp 3 = **142/142** 全过；typecheck 0 / lint 0；撤销机制验证通过。

## Batch 1 — 项目骨架 / workspace 修复

**目标**：修复 `ERR_PNPM_FETCH_404 @starter/ipc-client`，建 `docs/DEV_LOG.md` 骨架。

**结果**：
- `pnpm install` ✅（648 包，better-sqlite3 编译完成）
- `pnpm -r typecheck` ✅ / `pnpm -r test` ✅ / lint 修复 ✅
- 4 个 workspace 包内部依赖改 `workspace:*`；新增 `@eslint/js` devDep

## Batch 2 — F1 启动项扫描

**目标**：注册表 Run/RunOnce + 启动文件夹扫描。

**结果**：
- 跨平台 Scanner interface；`parseRegQuery` 纯函数便于单测
- ✅ 12/12 单测通过；本机真扫到 **35 项**
- 坑：raw string `r'..\..'` 在 esbuild 报错；`parseCommand(...).then` 返回类型不匹配；测试期望按 Windows CMD `""` 转义改写

## 技术锚点

- 每轮开始先读本文件，结尾把当轮摘要写进 "## State" 段。
- 根目录白名单只允许特定条目，其余归档到 `packages/ docs/ scripts/ tools/`。
