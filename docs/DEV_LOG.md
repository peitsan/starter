# Starter 开发日志（DEV LOG）

> 批次记录。每完成一个子任务追加一节 "## Batch N"。
> 上下文压缩锚点：每轮开始先读本文件，结尾把当轮摘要写进 "## State" 段。

## State (last 5 lines)

- Batch 10 完成：Tauri 2.x UI 骨架（6.36MB EXE，托盘+隐藏+10 RPC commands 转发到 Daemon）
- Rust 工具链装好（GNU 1.98 + w64devkit stub libgcc_eh）
- 103/103 单测，typecheck/lint 0 错，root clean
- 下一批：Batch 11 = 时间线 UI + 托盘 quick actions

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
