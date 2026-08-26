# @starter/daemon

> Starter Daemon — Windows Service 跑在 SYSTEM 上下文，负责：
>
> - HKLM 注册表写（无需 UAC）
> - 真实启动调度（CreateProcess 拉起进程）
> - 持久 SQLite 存储（%ProgramData%\Starter\starter.db）
> - HTTP RPC 接口（127.0.0.1:7811 + Bearer token）

## 用法

```bash
# 开发模式（控制台）
pnpm --filter @starter/daemon run dev

# 装成 Windows Service（需要管理员）
node packages/daemon/dist/index.js install
sc start StarterDaemon

# 卸
sc stop StarterDaemon
node packages/daemon/dist/index.js uninstall
```

## RPC API

POST `http://127.0.0.1:7811/rpc` with `Authorization: Bearer <token>`:

```json
{ "method": "scan", "params": {} }
{ "method": "list", "params": { "enabled": true } }
{ "method": "set_delay", "params": { "id": "fp_xxx", "delay_ms": 30000 } }
{ "method": "schedule_run", "params": { "concurrent_max": 4 } }
```

GET `http://127.0.0.1:7811/health`（无需 token）→ `{ ok: true, status: "running" }`
