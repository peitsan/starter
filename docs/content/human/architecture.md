# 架构设计

Starter 采用 **monorepo / npm workspaces** 结构，前后端与 Agent 接口分层清晰。

## 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  LLM Agent (Cursor / Claude Desktop / DSH)                  │
└──────────────────┬──────────────────────────────────────────┘
                   │ MCP (stdio / SSE)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  @starter/mcp      MCP Server（Node.js，纯 JS）              │
└──────────────────┬──────────────────────────────────────────┘
                   │ 本机 HTTP 127.0.0.1:7811 + Bearer Token
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  @starter/cli      CLI 入口（Node.js）                       │
└──────────────────┬──────────────────────────────────────────┘
                   │ 直接读 SQLite / 走 IPC
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  @starter/core     领域模型、SQLite、调度引擎                │
│  原生主进程（已提权）── 注册表 / WMI / 进程 / IO 监控          │
└─────────────────────────────────────────────────────────────┘
                   ▲
                   │ 复用 .NET / C# 桥接（react-native-windows 侧）
┌──────────────────┴──────────────────────────────────────────┐
│  @starter/ui       React Native (react-native-windows) 桌面  │
└─────────────────────────────────────────────────────────────┘
```

## 仓库结构

```
.
├── docs/                     # 文档（本站在此构建）
├── packages/
│   ├── core/                 # 领域模型、SQLite、调度引擎（DAG + IO watchdog）
│   ├── cli/                  # starter 命令行入口
│   ├── mcp/                  # MCP Server（让 LLM Agent 接入）
│   ├── daemon/               # 已提权守护进程（RPC 服务）
│   ├── ipc-client/           # HTTP client（CLI/MCP → 已提权主进程）
│   └── ui/                   # React Native (react-native-windows) 桌面端
├── tsconfig.base.json
├── pnpm-workspace.yaml
└── package.json              # 根（workspaces + release-it）
```

## 数据层

- **SQLite**：`%USERPROFILE%\.starter\starter.db`
- **op_log**：所有写操作的审计日志（含 `prev` / `next`，支持撤销）
- **schema_version**：当前 `v1`

## 关键技术决策

- **注册表读取走 `reg.exe query` 而非 ffi-napi**：零原生依赖，跨平台扫描器接口便于将来扩展 macOS/Linux
- **fingerprint**：基于 `source + source_path + name` 哈希，得到启动项的稳定 id
- **风险分级**：`critical`（不可关）/ `normal`（推荐保留）/ `recommend_off`（可关）
- **workspace 依赖用 `workspace:*` 协议**：避免 pnpm 9 把内部包当外部包拉取
