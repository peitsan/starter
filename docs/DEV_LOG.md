# Starter 开发日志（DEV LOG）

> 批次记录。每完成一个子任务追加一节 "## Batch N"。
> 上下文压缩锚点：每轮开始先读本文件，结尾把当轮摘要写进 "## State" 段。

## State (last 5 lines)

- M0/M1/M2 完成：优先级统一（RFC-001 §4.5，默认 2）+ daemon deps 修复 + daemon dbPath 修复
- M1：@starter/ipc-client 实装（10/10）+ @starter/core/registry 命令注册器 + CLI/MCP 写操作走 daemon IPC（fallback 本地，兼容旧 daemon 裸 boolean）
- M2：MCP 扩到 27 tools + 6 resources + 5 prompts + yes 确认流（RFC-001 §4.6）+ SSE transport（127.0.0.1:7812 实测）+ import/export（RFC §4.9）
- 单测 core 91 + daemon 32 + ipc-client 10 + ui 14 + cli 9 + mcp 3 = 159/159 全过，typecheck 0 错；MCP e2e（真实起 server）27/27 PASS
- 已更新 docs/AGENT_API.md（27 tools/6 resources/5 prompts/daemon IPC 路由）；下一批：Tauri bundle + 部署新 daemon 二进制 + 20-run trim + TaskScheduler/Service 扫描

## 根目录白名单

只允许存在以下条目（其他全部归档到 packages/ docs/ scripts/ tools/）：

```
.editorconfig
.gitattributes
.gitignore
.husky/
.lintstagedrc.json
.npmrc
.nvmrc
.prettierignore
.prettierrc.json
.vscode/
CHANGELOG.md
CONTRIBUTING.md
LICENSE
README.md
commitlint.config.cjs
eslint.config.mjs
package.json
pnpm-lock.yaml          (生成)
pnpm-workspace.yaml
tsconfig.base.json
tsconfig.json
```

## Batch 1 (2026-08-26)

### 目标
- 解决上一轮 `pnpm install` 报的 `ERR_PNPM_FETCH_404 @starter/ipc-client`：原因是 pnpm 9 默认把 workspace 内部包当外部包去 registry 拉。需要在 `pnpm-workspace.yaml` 明确 `packages` 范围，并在根 `package.json` 用 `workspace:*` 协议。
- 修好 workspace 内部依赖解析，install 成功。
- 建 `docs/DEV_LOG.md` 骨架。

### 计划改动
- 把 4 个 workspace 包之间的依赖从 `"*"` 改成 `"workspace:*"`（pnpm 推荐写法）。
- 重跑 `pnpm install`。
- 跑 `pnpm -r typecheck` 验证。
- `git add -A && git commit` + `git push`。

### 结果
- `pnpm install` ✅ 648 包，husky 装好，better-sqlite3 编译完成
- `pnpm -r typecheck` ✅ 4 个包全过
- `pnpm -r test` ✅ cli 1/1 pass，mcp 0/0（占位），core 走 tsx + node:test
- `pnpm run lint` ❌ → 修：补 `@eslint/js` → ✅
- 改动：4 个 package.json 内部依赖改 `workspace:*`；新增 `@eslint/js` devDep
- 下一步：Batch 2 — F1 启动项扫描（注册表 Run/RunOnce + 启动文件夹）

## Batch 2 (2026-08-26)

### 目标
- F1 启动项扫描器：注册表 Run/RunOnce + 启动文件夹
- 跨平台接口（Scanner interface），便于将来 macOS/Linux 扩展
- 单测覆盖 parseRegQuery / parseCommand / fingerprint

### 计划改动
- 新增 `packages/core/src/scanner/{types,command,windows,detect,index}.ts`
- 新增 `packages/core/tests/scanner.test.ts`（12 个 case）
- 新增 `packages/core/bin/scan-smoke.mts`（本机真跑演示）

### 关键设计
- 注册表读走 `reg.exe query` 而非 ffi-napi：零原生依赖
- 解析器独立成 `parseRegQuery` 纯函数，方便单测
- 启动文件夹过滤 .lnk/.bat/.cmd/.exe/.vbs/.js/.jar
- 风险分级（critical / normal / recommend_off）粗粒度识别 Microsoft 系

### 结果
- ✅ `pnpm -r typecheck` 0 错
- ✅ `pnpm -r test` 12/12 pass（含 `STARTER_RUN_REG_SCAN=1` 真 reg.exe）
- ✅ `pnpm --filter @starter/core exec tsx bin/scan-smoke.mts` → **本机扫到 35 项**（OneDrive / Steam / Sunlogin / Clash / DeepSeek / Ollama / Thunder / BaiduYun / GoogleDrive / 有道云...）
- ❌ 遇到 2 个坑：(1) raw string `r'..\..'` 在 esbuild 报错 → 改 `'..\\..'`；(2) `parseCommand(...).then(items => results.push(...items))` 返回 number，Promise<void> 类型不匹配 → 加 `{ }` 块包成 void
- ❌ 测试期望写错：原想测 `\"` 转义但 tokenizer 是 Windows CMD 风格 `""` → 改测试
- 下一步：Batch 3 — F2 启/停（写注册表）+ SQLite 仓储

## Batch 12 (2026-08-26) — Agent Settings / MCP 完整化

### 目标
- 服务流出 MCP，让外部 Agent 能完整操作排程表（不再只有 5 个基础 tool）

### 实装
- store 新增 2 repo：
  - `packages/core/src/store/dependencies.ts` — DependencyRepository（add/remove/listFor/防环 DFS）
  - `packages/core/src/store/op-log.ts` — OpLogRepository（write/list/listUndoable）
- controller 新增方法：addDependency/removeDependency/listDependencies/applyPreset/undoLast/scheduleRun/timeline/ioStatus/serviceStatus
- **op_log 统一**：写操作全部走 items 层（setEnabled/setDelay/setPriority/addDependency/removeDependency 自带审计日志，含 prev/next），controller 不再重复写
- MCP 扩到 **17 tools + 3 resources + 3 prompts**：
  - 新增 show/set_priority/add_dependency/remove_dependency/list_dependencies/apply_preset/undo_last_change/schedule_run/doctor/io_status/service_status/timeline
  - resources: starter://items / ://timeline / ://doctor
  - prompts: optimize_for_io / diagnose_slow_boot / safe_disable_plan
- daemon RPC + Tauri 都加了新方法绑定
- docs/AGENT_API.md 新建；AGENT_GUIDE.md 更新到 17 tools

### 结果
- ✅ core 86 + daemon 30 + ui 14 + cli 9 + mcp 3 = **142/142** 全过
- ✅ typecheck 0 / lint 0 / root clean
- ✅ MCP dist 验证含全部新 tool/resource/prompt
- 撤销机制：undoLast 反向执行最近 N 条（set_delay 恢复 prev，disable↔enable，add_dep↔rm_dep）

### 下一批
- Batch 13 = Tauri bundle (.msi/.nsis) + GitHub Actions 自动打包 + i18n 收尾（真 EXE 验证多语言）
