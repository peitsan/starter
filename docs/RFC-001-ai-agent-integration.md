# RFC-001 — Starter × AI Agent 集成（含 OpenCode）

| 字段 | 值 |
|---|---|
| 编号 | RFC-001 |
| 标题 | Starter × AI Agent 集成（含 OpenCode 接入方案） |
| 作者 | Paxon |
| 状态 | Draft |
| 创建日期 | 2026-08-26 |
| 关联 | PRD v0.1、MRD v0.1、PRD 附录 A、审计报告 (`docs/audit-traceability.csv`)、V0.2_PLAN |
| 目标版本 | v0.3.0 |

---

## 1. 摘要 (Summary)

本 RFC 解决三件事：

1. **回答用户问题：「用 OpenCode 进行启动项配置」是否可行** —— ✅ **可行**，并给出接入步骤与必备前置。
2. **补齐 PRD/MRD + 审计暴露的缺口**：MCP/CLI 工具不全、写操作绕开 daemon、缺导入导出、缺 SSE 等。
3. **把架构补对**：CLI/MCP 写操作统一走 daemon，达成 PRD A.1/A.4 的"统一审计、零代码重复"。

---

## 2. 动机 (Motivation)

### 2.1 用户原话
> "看看是否能够实现用 opencode 进行启动项配置"

[OpenCode](https://opencode.ai)（sst 出品的开源 AI 编码 CLI，Claude Code 的开源替代）支持 **MCP 协议**作为工具源，与 Cursor / Claude Desktop / DSH 同类。Starter 的 `@starter/mcp` 已经实现了 stdio MCP server，**OpenCode 接入的协议层是零成本的**。但要"用 OpenCode 配置启动项"有完整闭环，还差 4 类前置。

### 2.2 审计暴露的 4 个阻断点
对照 `docs/audit-traceability.csv`：

| 阻断点 | 证据 | 影响 OpenCode 的场景 |
|---|---|---|
| **缺 `get_config` / `set_config`** | server.ts 无 | Agent 无法改并发上限、IO 阈值、auto_start |
| **缺 `import_config` / `export_config`** | server.ts 无 | Agent 无法备份/恢复、跨机同步、配置审计 |
| **缺 `get_run_history`** | timeline 只读最近一次 run | Agent 无法对比历史启动时间 |
| **CLI/MCP 写操作绕开 daemon** | controller.ts 直接 `reg.exe` | Agent 写操作与主进程审计/权限隔离脱节；与 PRD A.1/A.4 设计违背 |
| **优先级语义 4 处冲突** | CLI/MCP/daemon/PRD 各自一套 | Agent 设的 priority 在 daemon 跑出来不是预期值 |
| **daemon 真调度丢 DAG 依赖** | `daemon/controller.ts:165` `deps: new Map()` | Agent 加的依赖关系在真实登录调度不生效 |
| **F9 导入导出完全缺失** | 全包无 export/import | Agent 无法离线保存策略 |

### 2.3 为什么要补"统一经 daemon"架构
PRD A.1 明确：

> 隔离：MCP Server 纯 JS，跑在 Node 侧，不需要管理员权限也能用只读操作。
> 可审计：所有 CLI/MCP 调用先落到 SQLite 的 op_log，出问题能复盘。
> 可复用：CLI 和 MCP 共享同一份命令注册器，零代码重复。

当前实现（v0.2）三个目标**部分违背**：
- 隔离 ✓ 的一半：MCP 写操作直写 HKCU（虽然不需要管理员权限，但"统一经主进程代办"未落地）
- 可审计 △：op_log 记录但不在主进程视角
- 可复用 ✗：CLI 与 MCP 是两套独立实现，重复定义

---

## 3. 目标 / 非目标 (Goals / Non-Goals)

### 3.1 Goals（本 RFC 范围）
1. **让 OpenCode 完整接入 Starter**（补 4 类缺失 tool + 接入文档）。
2. **CLI/MCP 写操作统一走 daemon HTTP RPC**（架构补对）。
3. **CLI 与 MCP 共享命令注册器**（消除重复）。
4. **补 F9 导入导出**（含 schema 版本号、diff、备份）。
5. **修优先级语义冲突 + daemon 真调度丢依赖** 2 个正确性 bug。
6. **MCP 加 SSE 传输**（可选，远程/调试）。
7. **MCP 写操作加显式确认流**（`yes?` 参数 + agent hook 规范）。

### 3.2 Non-Goals
- 不做 macOS / Linux scanner（MRD §7.2 Out of Scope）。
- 不做云端账号同步。
- 不重写 UI 前端框架（仍 Vanilla JS + Tauri）。
- 不做"自动检测推荐禁用项 AI 建议"（MRD v2 探索项）。

---

## 4. 设计与实现 (Design)

### 4.1 整体架构

```
                    ┌─────────────────────────────────────┐
                    │  AI Agent (OpenCode / Cursor /      │
                    │  Claude Desktop / DSH)              │
                    │  via MCP (stdio) or HTTP RPC         │
                    └─────────────────┬───────────────────┘
                                      │ MCP / HTTP+Bearer
                                      ▼
              ┌──────────────────────────────────────────────┐
              │  @starter/mcp  (Node.js, stdio + SSE)        │
              │  - tools / resources / prompts              │
              │  - 写操作：构造 JSON-RPC，调 daemon          │
              │  - 读操作：可直连 SQLite（同源 IPC）         │
              └─────────────────┬────────────────────────────┘
                                │ HTTP 127.0.0.1:7811 + Bearer
                                ▼
              ┌──────────────────────────────────────────────┐
              │  @starter/daemon (Windows Service, SYSTEM)   │
              │  - 持有 UAC：可写 HKLM / 计划任务            │
              │  - CreateProcess 真起进程（带 priority + DAG）│
              │  - 统一审计：op_log 落 SQLite                 │
              │  - 路径 /rpc、/v1/items、/v1/io、/health     │
              └─────────────────┬────────────────────────────┘
                                │ SQLite WAL
                                ▼
                    ┌──────────────────────────┐
                    │  %ProgramData%\Starter\  │
                    │  starter.db  + auth.token│
                    └──────────────────────────┘

  @starter/cli ──── 直连 SQLite（只读）─────┐
  @starter/ui  ──── HTTP daemon RPC ────────┤  (本地)
  OpenCode    ──── stdio MCP ───────────────┘
```

关键变化：
- **MCP 与 CLI 写操作都转 daemon**（原来：MCP/CLI 直写 HKCU + Controller）。
- **命令注册器共享**：建 `packages/core/src/registry/`，CLI/MCP/daemon 都从这里 import（消除重复）。
- **daemon 补上 deps / priority 修正**。

### 4.2 命令注册器共享

新增 `packages/core/src/registry/commands.ts`，把每个写操作定义成：

```ts
export interface Command<TIn, TOut> {
  name: string;                    // 'disable' | 'set_delay' | ...
  cli: string;                     // 'disable <id>' / 'set-delay <id> <ms>' / ...
  schema: { in: z.ZodType<TIn>; out: z.ZodType<TOut> };
  requiresActor: Actor[];          // ['cli', 'mcp', 'daemon']
  risk: 'read' | 'write-low' | 'write-high';
  /** 实际执行业务；return JSON 稳定 v1 */
  exec(ctx: CommandCtx, in: TIn): Promise<TOut>;
  /** 撤销（从 op_log 反演） */
  undo?(ctx: CommandCtx, prev: unknown): Promise<void>;
}
```

CLI/MCP/daemon 都 `import { REGISTRY } from '@starter/core/registry'`，由各端薄薄一层做参数解析与输出：
- CLI 端：把 commander argv 映射到 `Command.exec`
- MCP 端：把 JSON-RPC args 映射到 `Command.exec`
- daemon 端：把 `/rpc` body.method 映射到 `Command.exec`

这样新加命令只写一次。

### 4.3 补 MCP tool / resource / prompt

**新增 tool**（11 个）：
| tool | 入参 | 出参 (v1) | 备注 |
|---|---|---|---|
| `get_config` | `{key: ConfigKey}` | `{ok, value, source: "db"\|"default"}` | |
| `set_config` | `{key, value, yes?: bool}` | `{ok, prev, next}` | yes=false 时返回 `{ok:false, require_yes:true}` |
| `import_config` | `{path, mode: "merge"\|"replace"\|"append", yes?: bool}` | `{ok, diff: {...}, backup: "path"}` | 导入前自动备份 |
| `export_config` | `{path}` | `{ok, path, schema_version: "v1", item_count: n}` | 写 schema_version |
| `get_run_history` | `{limit?: number, since?: ms}` | `{ok, runs: [{id, started_at, finished_at, kind, total, paused_count, items: [...]}]}` | |
| `get_dependency_graph` | `{}` | `{ok, nodes: [...], edges: [...]}` | 替代 PRD 的 `dependency_audit` prompt |
| `add_run_log` | `{run_id, item_id, status, detail?}` | `{ok}` | daemon 端用 |
| `revert_preset` | `{report: PresetReport}` | `{ok, reverted: n}` | apply_preset 的逆向 |
| `list_changes` | `{limit?: number, since?: ms, action?: string}` | `{ok, entries: OpLogRow[]}` | 审计查询 |
| `set_io_throttle` | `{queue_threshold?: number, busy_threshold_pct?: number, idle_confirm_ms?: number, yes?: bool}` | `{ok}` | 高频调参 |
| `simulate_dry_run` | `{}` | `{ok, run: ScheduleRunReport}` | 与 `schedule_run` 默认 dry-run 区分 |

**新增 resource**（3 个）：
| URI | 内容 |
|---|---|
| `starter://config` | 全部 app_config（KV）+ 默认值 |
| `starter://io` | 最近一次 IO 采样（idle% / 队列 / 阈值 / 是否繁忙） |
| `starter://runs/latest` | 最近一次 run 详情（含 events） |

**新增 prompt**（2 个）：
| prompt | 模板要点 |
|---|---|
| `find_bloat` | 列出 risk=recommend_off 且 vendor 非 Microsoft/Intel/AMD/NVIDIA/Realtek 的项 |
| `dependency_audit` | 跑 `get_dependency_graph`、DFS 找环、列孤立节点、给整理建议 |

### 4.4 写操作确认流（A.3.5 补全）

每个写 tool 的入参加 `yes?: boolean`：

```ts
case 'disable_startup_item': {
  if (!a.yes) {
    return jsonResult({ ok: false, require_yes: true, preview: await previewDisable(a.id) });
  }
  // 真正写
}
```

Agent 端规范（写到 `docs/AGENT_API.md`）：
1. 首次调用不带 `yes` → server 返回 `require_yes: true` + `preview`
2. Agent 把 preview 展示给用户 / 自己做判断
3. 再次调用带 `yes: true` → 执行

CLI 端：`starter disable <id> --yes`（已存在）；不带 `--yes` 时若 stdin 是 TTY 就交互问，否则当作 `yes=false` 走 preview 路径（保留脚本友好）。

### 4.5 修优先级语义冲突

**统一方案**（写入 `docs/GLOSSARY.md`）：

| 数值 | Windows 优先级类 | PRD 表述 | daemon `start` flag |
|---|---|---|---|
| 0 | `IDLE_PRIORITY_CLASS` | Idle | `/LOW` |
| 1 | `BELOW_NORMAL_PRIORITY_CLASS` | BelowNormal | `/BELOWNORMAL` |
| 2 | `NORMAL_PRIORITY_CLASS` | Normal | `/NORMAL` |
| 3 | `ABOVE_NORMAL_PRIORITY_CLASS` | AboveNormal | `/ABOVENORMAL` |
| 4 | `HIGH_PRIORITY_CLASS` | High | `/HIGH` |
| 5 | `REALTIME_PRIORITY_CLASS` | Realtime (不推荐) | `/REALTIME` |

改动：
- core `items.ts:88` 默认值改 `priority: 2`（NORMAL）
- CLI/MCP 文档/帮助文本改用上表
- daemon 映射不变（与表一致）
- `schema.ts` 注释同步

### 4.6 修 daemon 真调度丢依赖

`packages/daemon/src/controller.ts:135-215` 的 `scheduleRun`：

```diff
-    deps: new Map(),
+    deps: new Map(
+      items.map((it) => [it.id, this.core.listDependencies(it.id).outgoing]),
+    ),
```

加单测 `packages/daemon/tests/controller.test.ts`：mock 两个 item A→B，跑 `scheduleRun({simulatedRunMs: 200, concurrentMax: 4})`，断言 B 的 `started_at >= A.started_at + 150ms`（留余量）。

### 4.7 CLI 写操作走 daemon

`packages/cli/src/commands.ts`：

```ts
// 写操作走 daemon；读操作可直连 SQLite（同源同进程）
async function withCtrl(cmd: 'enable' | 'disable' | 'set_delay' | 'set_priority' | 'add_dependency' | 'remove_dependency' | 'import' | 'export', args: unknown) {
  if (isWriteOp(cmd) && await daemonReachable()) {
    return await ipc.rpc(cmd, args);  // POST /rpc
  }
  // fallback: 本地 Controller（兼容无 daemon 场景）
  return await localCtrl[cmd](args);
}
```

前提：`@starter/ipc-client` 必须实装 HTTP client（当前 3 行占位）：

```ts
// packages/ipc-client/src/index.ts （补全）
export async function rpc(method: string, params: unknown, opts?: { url?: string; token?: string }) {
  const url = opts?.url ?? DEFAULT_DAEMON_URL;
  const token = opts?.token ?? (await readToken());  // ~/.starter/auth.token or %ProgramData%\Starter\auth.token
  const r = await fetch(`${url}/rpc`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, id: crypto.randomUUID() }),
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return (await r.json()).result;
}
```

`daemonReachable()` = `fetch(${url}/health, {timeout: 200})` 200ms 内回 200 算可达。**离线守护**：`@starter/daemon` 启动时若 scanner 已能直读 db、CLI 也直读 db，仅写操作 fallback 到本地并打印 `[starter] daemon unreachable, falling back to local write`。

### 4.8 SSE 传输

`packages/mcp/src/server.ts` 加 transport 分发：

```ts
if (process.argv.includes('--transport=sse')) {
  const port = Number(process.env.PORT ?? 7812);
  const transport = new SSEServerTransport(`/sse:${port}`);
  await server.connect(transport);
} else {
  await server.connect(new StdioServerTransport());
}
```

绑定 `127.0.0.1`（PRD A.3.5）；支持 `STARTER_MCP_TOKEN` env 鉴权。

### 4.9 导入导出

数据格式（`docs/CONFIG_SCHEMA.md`）：

```json
{
  "schema_version": "v1",
  "exported_at": 1787000000000,
  "items": [{ "fingerprint": "fp_xxx", "enabled": true, "delay_ms": 30000, "priority": 1 }],
  "dependencies": [{ "item_id": "fp_a", "depends_on": "fp_b" }],
  "config": { "concurrent_max": "4", "io_busy_threshold_pct": "80" }
}
```

`mode`:
- `merge`：按 fingerprint upsert，**不动 enabled/delay/priority 没在文件里出现的项**
- `replace`：清空后全量替换
- `append`：只插入新项，不改已有

导入前自动 `cp starter.db starter.db.bak-{ts}`。

---

## 5. OpenCode 接入方案

### 5.1 可行性结论

**✅ 完全可行**。OpenCode 支持 MCP 工具，Starter 已有 stdio MCP server，协议层零成本。完整闭环（增删改查启动项 + 改依赖 + 调阈值 + 导入导出 + 审计）需要本 RFC §4.3 + §4.5 + §4.6 落地。

### 5.2 接入步骤

**前置**：Starter v0.3.0+ 已发布（含本 RFC 全部条目）。

**1. 安装 OpenCode**

```bash
npm install -g opencode-ai
# 或 sst 官方推荐
curl -fsSL https://opencode.ai/install | bash
```

**2. 启动 Starter daemon（后台）**

```bash
# 一次性
starter-daemon install       # 装 Windows Service
starter-daemon start         # 启动
# 或开发模式（控制台）
starter-daemon console
```

**3. 配置 OpenCode 的 MCP**

`~/.config/opencode/config.json`（OpenCode 配置位置，具体以官方文档为准）：

```json
{
  "mcp": {
    "servers": {
      "starter": {
        "type": "stdio",
        "command": "starter",
        "args": ["serve-mcp", "--stdio"]
      }
    }
  },
  "provider": {
    "anthropic": { "apiKey": "sk-ant-..." }
  }
}
```

注：OpenCode v1+ 配置文件路径可能是 `~/.opencode.json` 或 `OPENCODE_CONFIG` env，参考当时文档；MCP 配置 schema 字段名也可能微调（`mcpServers` vs `mcp.servers`），以 OpenCode 文档为准。

**4. 在 OpenCode 里使用**

```bash
$ opencode
> 扫一下我电脑的启动项，把 IO 高的延迟 60 秒，OneDrive 必须第一个起
# OpenCode 会自动调：
#   1. scan_startup_items
#   2. list_startup_items({risk: "recommend_off"})
#   3. set_delay(id, 60000) 多次
#   4. add_dependency(onedrive_id, depends_on=network)
#   5. （可选）schedule_run({simulated_ms: 3000}) 看效果
#   6. （可选）get_run_history 验证
```

### 5.3 与 Cursor / Claude Desktop / DSH 对照

| 能力 | OpenCode | Cursor | Claude Desktop | DSH |
|---|---|---|---|---|
| MCP stdio | ✓ | ✓ | ✓ | ✓（v0.3+） |
| 配 Starter MCP | `config.json` | `mcpServers` | `mcpServers` | `cordis.yml` |
| 自动调用 tool | ✓（agent 模式） | ✓（Agent 模式） | ✓ | ✓ |
| 写操作确认 | 通过本 RFC `yes` 字段 | 同 | 同 | 同 |

注：DSH 接入 Starter 的 cordis 插件在另一 RFC 范围（与 DSH 团队对齐），本 RFC 不展开。

### 5.4 OpenCode 特有限制

- OpenCode 是**终端/TUI 工具**，无 GUI 托盘；用本 RFC 4.7 修好后，agent 流程与 GUI 体验互补。
- OpenCode 的 file/bash 工具比 Cursor 更开放；MCP tool 与 file/bash 之间**需要权限边界**：本 RFC 4.4 写操作确认流同时覆盖 MCP tool，file/bash 操作（编辑 SQLite）应被禁止或走 daemon 强约束。
- OpenCode 跨平台（macOS/Linux/Windows），但 Starter 主体 Windows-only；OpenCode 在 macOS 上跑也能调 Starter 的 MCP 做只读（list/show/doctor），写操作（HKCU/HKLM）会失败但能清晰报错。

---

## 6. 安全 (Security)

1. **写操作走 daemon**：所有 `enable`/`disable`/`set_*`/`add_*`/`import` 必须经 daemon HTTP，daemon 用 SYSTEM 权限 + Bearer Token。
2. **MCP yes 确认流**：写 tool 入参 `yes?: bool`；server 端强制二次校验。
3. **ipc-client 鉴权**：token 仅从 `%ProgramData%\Starter\auth.token`（0o600）读取；从不写日志、永不通过 MCP tool 暴露。
4. **critical 项仍走 controller 返回 `protected`**（保留现有逻辑，不放宽）。
5. **op_log 写所有变更**，包括 agent 调用 actor 字段（`actor: 'mcp' | 'cli' | 'daemon' | 'ui'`）。
6. **导出 JSON 不含 token / 路径中个人标识**（脱敏）。

---

## 7. 兼容性 (Compatibility)

- **数据**：schema_version `v1`（已存在）；新增 `v2` 字段用 optional；提供 `import_config` 兼容读 `v1`。
- **CLI**：新增 11 个子命令（`config get/set`、`io`、`run now/history`、`import/export`、`serve-mcp`、`version`、`add-dep`、`rm-dep`），不破坏现有 8 个。
- **MCP**：新增 11 个 tool（增量），不删已有 17 个。
- **daemon**：HTTP RPC 新增 method；旧 client 仍可调旧 method。

---

## 8. 验收 (Acceptance)

### 8.1 必达
- [ ] RFC §4.3 全部 tool/resource/prompt 在 `STARTER_TOOL_NAMES` / `STARTER_RESOURCE_URIS` / `STARTER_PROMPT_NAMES` 中存在
- [ ] `pnpm -r typecheck && pnpm -r test` 全过（≥ 150 用例）
- [ ] `docs/audit-traceability.csv` 中标 ❌ 的 F9 / 写操作走 daemon / 优先级语义 / daemon 丢依赖 4 项全部变 ✅ / 🟡
- [ ] `starter export config.json` → 文件含 `schema_version: "v1"`
- [ ] `starter import config.json` 触发自动备份 + diff 预览
- [ ] OpenCode 接入后能完整跑通 §5.2 步骤 4 的自然语言指令

### 8.2 推荐达
- [ ] MCP SSE 模式本地可用，绑 127.0.0.1
- [ ] CLI 与 MCP 共享 REGISTRY（`@starter/core/registry`），零命令名硬编码
- [ ] 导入导出 e2e 测试覆盖 merge/replace/append
- [ ] OpenCode 在 macOS/Linux 上能 list/show/doctor（只读 OK，写报错清晰）

---

## 9. 风险与开放问题 (Risks)

| 风险 | 等级 | 缓解 |
|---|---|---|
| 写操作走 daemon 增加延迟（IPC 1 个 hop） | 低 | 本机 loopback <1ms；CLI 写操作可允许 50ms 延迟 |
| daemon 不在时 CLI 写操作降级本地 | 中 | 显式提示 `[starter] daemon unreachable, falling back to local`；op_log 记 actor='cli' 让审计可分清 |
| 命令注册器抽象过重 | 中 | 先用最薄一层（typed map + handler），不引入 zod 之类的重量依赖；后续按需 |
| OpenCode 配置文件路径/字段随版本变 | 低 | README 标"以 OpenCode 官方文档为准"；CLI 子命令 + 独立 MCP server 启动可避免直耦合 |
| 优先级 5=REALTIME 误用 | 中 | CLI help 警告；MCP set_priority 5 需 yes=true |

---

## 10. 里程碑 (Milestones)

| 阶段 | 周 | 交付 |
|---|---|---|
| M0 | 1 | 优先级语义统一 + daemon deps bug 修 + 单测 |
| M1 | 2 | 命令注册器 `@starter/core/registry` + ipc-client 实装 + CLI/MCP 写操作走 daemon |
| M2 | 1 | MCP 补 11 tool + 3 resource + 2 prompt + SSE transport |
| M3 | 1 | CLI 补 11 子命令 + F9 导入导出 + 备份 |
| M4 | 1 | OpenCode 接入文档 + E2E 测试（OpenCode 实跑 + 验证 SQLite） |
| M5 | 1 | 发布 v0.3.0 + GitHub Release + 更新 AGENT_API.md |

---

## 11. 参考 (References)

- PRD：`docs/PRD.md`（F1–F12、附录 A CLI/MCP）
- MRD：`docs/MRD.md`
- 审计追踪矩阵：`docs/audit-traceability.csv`
- OpenCode：<https://opencode.ai>（sst 出品，开源 AI 编码 CLI）
- MCP 规范：<https://modelcontextprotocol.io/>

---

## 附录 A：MCP 写操作确认流示例

```
$ # 第一次：agent 调 disable_startup_item({id: "fp_xxx"})
< { "ok": false, "require_yes": true,
    "preview": { "id": "fp_xxx", "name": "Clash", "current": "enabled",
                 "after": "disabled", "command": "...", "risk": "recommend_off" } }

$ # agent 展示给用户
User: yes
$ # 第二次：disable_startup_item({id: "fp_xxx", yes: true})
< { "ok": true, "id": "fp_xxx", "op_log_id": 42 }
```

## 附录 B：OpenCode 自然语言 → tool 调用映射

| 用户自然语言 | OpenCode 调用的 tool 序列 |
|---|---|
| "扫一下我电脑的启动项" | `scan_startup_items` |
| "把 IO 高的全部延迟 60 秒" | `list_startup_items({risk:"recommend_off"})` → `apply_preset([{match:"*", delay_ms:60000}])` |
| "OneDrive 必须第一个起" | `list_startup_items({search:"onedrive"})` → `set_delay(id, 0)` + `get_dependency_graph` 检查冲突 |
| "VS Code 等 OneDrive 同步完再起" | `list_startup_items({search:"vs code"})` → `add_dependency(vscode_id, onedrive_id)` |
| "我看看到底哪些项在卡" | `get_run_history({limit: 5})` |
| "我启动太慢了，帮我优化" | `get_prompt(diagnose_slow_boot)` → 按建议 `apply_preset` |
| "把配置导出来存到 dropbox" | `export_config({path: "C:/.../starter-config.json"})` |
| "撤销最近 5 步" | `undo_last_change({limit: 5})` |
| "磁盘 IO 现在什么状况" | `io_status` + `read_resource starter://io` |
