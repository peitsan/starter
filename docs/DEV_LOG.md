# Starter 开发日志（DEV LOG）

> 批次记录。每完成一个子任务追加一节 "## Batch N"。
> 上下文压缩锚点：每轮开始先读本文件，结尾把当轮摘要写进 "## State" 段。

## State (last 5 lines)

- 脚手架就绪 (lint/typecheck/test 全绿)
- pnpm 9.12.3 + workspace:* 协议
- 下一批：F1 扫描（注册表 Run + 启动文件夹）

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
