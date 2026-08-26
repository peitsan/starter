

## 0.1.0 (2026-08-26)


### Features

* **cli,core:** f2 enable/disable + 8 cli commands ([8904cf9](https://github.com/peitsan/starter/commit/8904cf9e285f173c6ec4c5724cf2cbabcb2ed30e))
* **core:** f1 startup scanner (windows registry + startup folders) ([a072f40](https://github.com/peitsan/starter/commit/a072f40c268c2a3c993ee9d82d61a965cff3497c))
* **core:** f2 sqlite store with op_log audit (6 tables, 13 tests) ([3ba08da](https://github.com/peitsan/starter/commit/3ba08daa3ab58b92fbeabda1138f2bc074cc9bb8))
* **core:** f3-f6 scheduler (dag + io watchdog + concurrent) ([907dfef](https://github.com/peitsan/starter/commit/907dfef3a8f69cab6601df7188e38d34eb427501))
* **mcp:** f12 mcp server with 5 tools + 1 resource + 1 prompt ([7056f1c](https://github.com/peitsan/starter/commit/7056f1ca5f7eb8ee35d07718af9d0c6651e41564))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-26

### Highlights

First MVP release of **Starter** — a modern Windows startup manager with **IO-aware scheduling**,
a **CLI**, and an **MCP server** that lets LLM agents (Cursor, Claude Desktop) control everything via natural language.

### Added

#### Core (F1–F6)
- **F1 Startup scanner** — Windows registry `HKCU/HKLM\…\Run/RunOnce` + user/common startup folders
  via `reg.exe query` (zero native deps); parser fully unit-tested
- **F2 Enable / disable** — `reg.exe add/delete` writer; `HKLM` rejected with `E_ELEVATION_REQUIRED`;
  critical items (Microsoft Defender / SecurityHealth) protected
- **SQLite storage** — 6 tables (`startup_item`, `startup_dependency`, `startup_run`,
  `startup_run_event`, `op_log`, `app_config`) + `schema_meta`; WAL mode;
  `op_log` records every CLI/MCP write with actor + args
- **F3 Delay** + **F4 DAG dependencies** + **F5 Concurrent control** + **F6 IO throttling**
  unified in a single `Scheduler` engine:
  - `Dag` class with topological sort, cycle detection, ready-nodes selection
  - `Watchdog` with `IoSource` interface (`FakeIdleIoSource` / `WindowsIoSource` / scripted)
    + state machine (`firstBusySince` + `confirmMs` to filter jitter)
  - `Scheduler` event loop: pause on IO busy, respect concurrent cap, advance on ready
- **TypeScript strict** (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`)
- 62 unit tests across `scanner` / `store` / `controller` / `winreg` / `dag` / `io` / `scheduler`

#### CLI (F11)
- 8 commands: `scan` / `list` / `show` / `enable` / `disable` / `set-delay` / `set-priority` / `doctor`
- `--json` mode for stable machine-readable output
- Stable exit codes: 0=ok 1=generic 2=args/not-found 3=protected 4=elevation 5=internal
- `--yes` to skip confirmation prompts on `enable` / `disable`
- 9 unit tests for formatter

#### MCP Server (F12)
- 5 tools: `scan_startup_items`, `list_startup_items`, `enable_startup_item`,
  `disable_startup_item`, `set_delay`
- 1 resource: `starter://items`
- 1 prompt: `optimize_for_io` (auto-generates optimization suggestions from current config)
- stdio transport (Cursor / Claude Desktop one-line config)
- 3 unit tests + 1 E2E smoke (`packages/mcp/bin/smoke.mjs`)

#### Engineering
- **Monorepo** with `pnpm` workspaces (`packages/*`); internal deps use `workspace:*`
- **Husky 9** + `lint-staged` + **commitlint** (Conventional Commits)
- **ESLint 9** flat config + **Prettier 3** + **EditorConfig** + **`.gitattributes`**
- **release-it** + `@release-it/conventional-changelog` for auto CHANGELOG / tag / GitHub Release
- GitHub topics: `windows`, `startup-manager`, `react-native`, `mcp`, `llm-agent`, `io-scheduler`, `typescript`
- Branch protection on `master` (`required_linear_history`)

### Notes
- macOS / Linux startup sources are stubbed (`detectScanner` throws). Roadmap item for v0.2.
- HKLM writes need a privileged daemon process; out of scope for v0.1.

[Unreleased]: https://github.com/peitsan/starter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/peitsan/starter/releases/tag/v0.1.0
