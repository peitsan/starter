# 开发手册（Developer Manual）

> 面向**贡献者 / 二次开发者**：仓库结构、技术栈、构建/测试、编码规范、架构决策、如何扩展。
> 运维向内容请看 [系统手册](system-manual.md)。

---

## 1. 技术栈

| 层 | 技术 |
|---|---|
| Monorepo | pnpm workspaces（`packages/*`）+ pnpm 9.12 |
| 语言 | TypeScript 5.6（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`） |
| 运行时 | Node ≥ 20（.nvmrc 锁 22） |
| 数据库 | better-sqlite3（WAL 模式） |
| CLI | commander 12 |
| MCP | `@modelcontextprotocol/sdk`（stdio + SSE） |
| Windows 服务 | node-windows |
| 桌面 UI | Tauri 2.x（vanilla JS 前端 + Rust 壳） |
| 质量 | ESLint 9 flat + Prettier + commitlint（Conventional Commits）+ Husky |

---

## 2. 仓库结构

```
.
├── docs/                      # 文档 + GitHub Pages 文档站
│   ├── content/human/         # 文档站「Human」模式内容（含本手册）
│   ├── content/agent/         # 文档站「Agent」模式内容
│   ├── assets/                # 文档站 app.js / app.css
│   ├── index.html             # 文档站 SPA 入口
│   ├── SYSTEM_MANUAL.md       # 系统手册（仓库版）
│   ├── DEVELOPER_MANUAL.md    # 开发手册（仓库版）
│   └── AUDIT_REPORT.md        # 全量审计报告
├── packages/
│   ├── core/                  # 领域模型 + SQLite + 调度引擎
│   ├── daemon/                # Windows 服务 + HTTP RPC
│   ├── ipc-client/            # 本地 HTTP 客户端
│   ├── cli/                   # 命令行
│   ├── mcp/                   # MCP Server
│   └── ui/                    # Tauri 桌面壳
├── .github/workflows/         # CI + Pages 部署
├── .husky/                    # pre-commit / commit-msg / pre-push
└── package.json               # 根（workspaces + release-it）
```

---

## 3. 常用命令

```bash
nvm use                        # Node 22
pnpm install                   # 装依赖
pnpm -r run build              # 构建所有 TS 包
pnpm -r run typecheck          # 全量类型检查
pnpm -r run test               # 全量测试（158 个）
pnpm run lint                  # ESLint
pnpm run format                # Prettier 格式化
pnpm run format:check          # 格式检查
pnpm run clean                 # 清理构建产物
```

单包操作示例：
```bash
pnpm -w @starter/mcp run test
pnpm -w @starter/mcp run e2e          # MCP e2e（27 tool / 6 resource / 5 prompt）
pnpm -w @starter/daemon run dev       # daemon 开发模式（tsx watch）
```

> `@starter/ui` 的 build 需要本机安装 Rust/cargo（Tauri 依赖）。

---

## 4. 核心架构与分层

### 4.1 依赖方向（单向）
```
ui / cli / mcp / daemon  ──►  core（唯一领域层）
cli / mcp ──► ipc-client ──► daemon（写操作 RPC）
```
- `@starter/core` **不依赖**任何其他包，是纯领域层。
- CLI/MCP 的写操作统一经 registry + daemon 路由；读操作直连 SQLite。

### 4.2 命令注册器（registry，零代码重复）
`packages/core/src/registry/commands.ts` 定义写操作（enable/disable/set_delay/…/config_set）：
每个命令 = `name / cli / describe / validate(args) / exec(ctx, c, args)`。
CLI 与 MCP 从 `@starter/core` 导入同一份定义，只做「参数解析 + 输出格式」。

### 4.3 写操作路由（RFC-001 §4.7）
```
调用方 ──daemonReachable()?──┐
   ├─ 是 → ipc-client.rpc() → daemon /rpc → core
   └─ 否 → 本地 core 直调（同一 SQLite WAL，语义一致）
```

### 4.4 调度引擎（scheduler / dag / io）
- `dag/graph.ts`：DAG 校验（环检测）+ 就绪节点。
- `io/monitor.ts`：Watchdog 用 `typeperf` 采样 `% Idle Time` + `Current Disk Queue Length`，连续忙 `confirmMs` 后 pause。
- `scheduler/engine.ts`：主循环 `while !allTerminal`：忙则等 → 并发满则等 → 取 ready → 标记 running →（模拟/真实）→ done。

### 4.5 关键设计决策
| 决策 | 理由 |
|---|---|
| 注册表读写走 `reg.exe` | 零原生依赖，输出稳定，易调试 |
| id = fingerprint（source+path+name 哈希） | 可复现、可迁移 |
| SQLite WAL + op_log | 审计 + 撤销一体 |
| 写操作统一走 daemon | 集中提权（HKLM/UAC）+ 统一审计 |
| 不引入 zod | validate 函数足够轻量 |
| workspace 依赖 `workspace:*` | 避免 pnpm 把内部包当外部拉取 |

---

## 5. 数据层开发指引

- 新增表：改 `packages/core/src/store/schema.ts`（`applySchema` 幂等）+ 对应 Repository。
- 新增配置键：加进 `store/config.ts` 的 `ConfigKey` + `DEFAULTS` + `validateConfigValue`。
- 导入/导出：`store/transfer.ts`（`TRANSFER_VERSION='v1'`），新增字段要兼容旧快照。
- 迁移：目前 schema v1，无迁移框架；未来按 `schema_meta` / `PRAGMA user_version` 演进。

---

## 6. 如何新增一个 MCP 工具

1. **core 层**：在 `Controller` 加方法（读）或 registry 加命令（写）。
2. **MCP 层**：`packages/mcp/src/server.ts`
   - `ListToolsRequestSchema` 里登记 tool + inputSchema；
   - `CallToolRequestSchema` 的 switch 实现 handler；
   - 写操作走 `requireYes(args, preview)` + `writeViaDaemon(method, params, local)`。
3. **catalog**：把名字加进 `mcp/src/catalog.ts`（测试会校验数量）。
4. **测试**：`mcp/tests/server.test.ts` / `core/tests/*` 补 case；跑 `pnpm -w @starter/mcp run test`。
5. **文档**：更新 `docs/AGENT_API.md` + 文档站 `content/agent/*`。

> 同理，CLI 新命令 = registry 定义 + `cli/src/commands.ts` 注册 + 文档。

---

## 7. 测试规范

- 框架：Node 内置 `node:test`（TAP）+ `tsx` runner；无 Jest 重量依赖。
- 位置：`packages/<pkg>/tests/*.test.ts`（`node --test --import tsx tests/**/*.test.ts`）。
- 原则：
  - 不依赖真实注册表/服务（用 fake / subprocess 隔离）；
  - 写操作测试用 `:memory:` db 或临时目录；
  - catalog 数量测试防止丢 tool/resource/prompt。
- 全量：`pnpm -r run test`（当前 158 通过）。

## 8. UI（Tauri 2.x）开发

- 前端为 vanilla JS（`dist/main.js` + `dist/index.html`），i18n 走 `dist/lang/*`。
- `tests/frontend.test.mjs` 做静态结构校验（不跑浏览器）。
- 构建需 Rust 工具链：`pnpm -w @starter/ui run build`。
- Tauri 能力配置在 `src-tauri/capabilities/default.json`、`src-tauri/tauri.conf.json`。

---

## 9. 代码规范（提交前）

- **Conventional Commits**：`feat: / fix: / docs: / refactor: / chore: / ci: / test:`，commitlint 强制。
- **Prettier + ESLint 9 flat**：`lint-staged` 提交时自动 `prettier --write` + `eslint --fix`。
- **TypeScript strict**：`noUncheckedIndexedAccess`（数组索引要判空）、`exactOptionalPropertyTypes`。
- 提交示例：
  ```bash
  git add -A
  git commit -m "feat(mcp): add new tool get_something"   # 或 git cz
  ```

## 10. 分支与发布

- 分支：`master` 稳定；`feat/<topic>` 新功能；`release/x.y` 长期分支。
- 发布：`pnpm run release:dry` 预演 → `pnpm run release`（release-it 自动：
  从 commit 推断版本 → 生成 CHANGELOG → tag → GitHub Release draft）。
- CI：`.github/workflows/` 有 lint/typecheck/test + GitHub Pages 部署（`docs/` 站点）。

---

## 11. 扩展路线（对照 PRD / 审计）

- [ ] 计划任务 / 服务扫描（`F1.6 / F1.7`，`Source` 已定义）
- [ ] 风险分级细化（厂商/PE 资源识别）
- [ ] 统一 run 时间线来源（SQLite vs ndjson 二选一）
- [ ] UI 深度集成（Tauri 调 daemon RPC）

详见 `docs/PRD.md`、`docs/RFC-001-ai-agent-integration.md`、`docs/AUDIT_REPORT.md`。