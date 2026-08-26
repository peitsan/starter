# Starter Documentation

> Modern Windows startup manager with **IO-aware scheduling**, **CLI**, and **MCP server** (LLM Agent interface).

🌐 **Repository**: <https://github.com/peitsan/starter>
📦 **Latest release**: [v0.1.0](https://github.com/peitsan/starter/releases/tag/v0.1.0)
🤖 **For AI agents / LLMs**: jump straight to the [**Agent Guide**](AGENT_GUIDE.md)

---

## 📚 Documents

| Doc | Audience | What's inside |
|---|---|---|
| **[Agent Guide](AGENT_GUIDE.md)** | 🤖 LLM agents | 30-second quick start: MCP tools, CLI, SDK, common scenarios, error codes |
| **[README](../README.md)** | 👤 Humans | Project overview, features, architecture, quick start |
| **[MRD](MRD.md)** | 📊 Product / Biz | Market requirements, target users, competitive analysis, KPIs |
| **[PRD](PRD.md)** | 🛠 Product / Dev | Product requirements (12 features F1–F12), data model, release plan |
| **[Dev Log](DEV_LOG.md)** | 🧑‍💻 Contributors | Batch-by-batch development diary, design decisions, pitfalls |

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
- **F11** — 8 CLI commands with stable `--json` output
- **F12** — 5 MCP tools + 1 resource + 1 prompt
- **74 unit tests** across scanner / store / controller / winreg / dag / io / scheduler / cli / mcp
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

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution guide and [DEV_LOG.md](DEV_LOG.md) for the development history.
