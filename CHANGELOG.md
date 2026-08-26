# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project skeleton: monorepo (`packages/core`, `packages/cli`, `packages/mcp`, `packages/ipc-client`)
- Tooling: ESLint 9 flat config, Prettier 3, TypeScript 5.6 strict, Husky 9 hooks, lint-staged 15, commitlint 19
- Release pipeline: `release-it` + `conventional-changelog` → auto CHANGELOG + tag + GitHub Release
- `.editorconfig`, `.gitattributes`, `.gitignore`, `.npmrc`, `.nvmrc` for cross-platform consistency
- `docs/MRD.md` and `docs/PRD.md` (with **Appendix A: CLI & MCP** for LLM Agent integration)
- 4 placeholder npm workspace packages, all with README + tsconfig + smoke test

[Unreleased]: https://github.com/peitsan/starter/compare/v0.0.0...HEAD
