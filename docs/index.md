# Starter Documentation

> Modern Windows startup manager with **IO-aware scheduling**, **CLI**, and **MCP server** (LLM Agent interface).

🌐 **Repository**: <https://github.com/peitsan/starter>
📦 **Latest release**: [v0.2.0](https://github.com/peitsan/starter/releases/tag/v0.2.0)
🤖 **For AI agents / LLMs**: jump straight to the [**Agent Guide**](content/agent/guide.md)

---

## 📚 Documents

文档已统一收进文档站 `docs/content/`（SPA 首页 `docs/index.html`，人类版 `#/human/…`、Agent 版 `#/agent/…`）。

| Doc | 位置 |
|---|---|
| **Agent Guide**（🤖 LLM agents） | [`content/agent/guide.md`](content/agent/guide.md) |
| **MCP 工具一览**（27 tools） | [`content/agent/mcp-tools.md`](content/agent/mcp-tools.md) |
| **MCP API 参考** | [`content/agent/api.md`](content/agent/api.md) |
| **System Manual**（🛠 Operators） | [`content/human/system-manual.md`](content/human/system-manual.md) |
| **Developer Manual**（🧑‍💻 Developers） | [`content/human/developer-manual.md`](content/human/developer-manual.md) |
| **PRD**（产品需求） | [`content/human/prd.md`](content/human/prd.md) |
| **MRD**（市场需求） | [`content/human/mrd.md`](content/human/mrd.md) |
| **Dev Log**（开发日志） | [`content/human/dev-log.md`](content/human/dev-log.md) |
| **Roadmap**（路线图） | [`content/human/roadmap.md`](content/human/roadmap.md) |
| **审计报告**（历史） | [`archive/audit-report.md`](archive/audit-report.md) |
| **RFC-001**（AI Agent 集成，历史） | [`archive/rfc-001-ai-agent-integration.md`](archive/rfc-001-ai-agent-integration.md) |

---

## 🚀 Quick start

### 1. Plug into Cursor / Claude Desktop (MCP)

```json
{
  "mcpServers": {
    "starter": {
      "command": "node",
      "args": ["<path-to-repo>/packages/mcp/dist/index.js"]
    }
  }
}
```

Then ask your agent:

> "Scan my startup items and delay all IO-heavy ones by 60 seconds. OneDrive must start first."

### 2. Or use the CLI

```bash
pnpm install
pnpm -r build
node packages/cli/dist/index.js scan
node packages/cli/dist/index.js list --search OneDrive
node packages/cli/dist/index.js set-delay <id> 30000
node packages/cli/dist/index.js doctor
```

### 3. Or use the SDK

```ts
import { Controller, detectScanner, Scheduler, WindowsIoSource } from '@starter/core';
const ctrl = new Controller({ scanner: detectScanner() });
await ctrl.scan();
```

---

## ✨ Highlights

- **F1–F6** — scan / enable / disable / delay / DAG / concurrent / **IO throttling** ⭐
- **F11** — CLI commands with stable `--json` output
- **F12** — **27 MCP tools + 6 resources + 5 prompts** (stdio / SSE), all writes go through the daemon
- **158 unit tests** across scanner / store / controller / winreg / dag / io / scheduler / cli / daemon / ipc-client / mcp / ui
- **MIT licensed** — open source

---

## 🛠 Development

```bash
nvm use           # Node 22
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm run lint
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution guide and [Dev Log](content/human/dev-log.md) for the development history.
