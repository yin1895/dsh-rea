# Changelog

## 0.1.0 — 2026-10-30

First working version, verified end to end on DSH `0.2.1-rc.3` (Windows x64).

- **Plugin**: one bundle patch mounts `dsh-rea` (host half + browser half) and `rea-mcp`
  (the REA MCP server, launched through the bundled progressive-disclosure bridge).
- **Host half** (`lib/index.js`): `/dsh-rea` prefix route on `webServer` with three request
  gates (guard header, `Sec-Fetch-Site`, `Origin`/`Host`), seven endpoints, bounded bodies.
- **Core** (`lib/core.js`): single-config read/write with `.bak` + atomic replace, editable
  variable whitelist with per-variable validation, `rea doctor` reduction, 15-step engine
  verify, environment sync, REA update, folder reveal. No Cordis dependency.
- **Browser half** (`lib/client.js`): hand-written `window.__ModuleLoader__` bundle, no
  bundler, no JSX; registers a `settings.section` page (`id: rea`, `order: 45`) that shows
  engine readiness, runs doctor and verify, edits the engine paths and the `directTools`
  advertisement list, and opens the REA folders.
- **Bridge** (`bridge/index.mjs`): transparent MCP stdio proxy that advertises a small
  `directTools` list plus `rea_catalog` / `rea_call`, so all 229 REA tools stay reachable
  without re-sending the full catalog on every request.
- **Tests**: `test/run.mjs` (29 checks), `test/http.mjs` (19 checks, real HTTP),
  `test/client.mjs --render` (17 checks, real React render), `bridge/smoke.mjs`.
- **Tooling** (`scripts/`): CLI wrappers, environment sync/publish, end-to-end self-test
  (10/10 steps: providers, capabilities, adb, apktool, managed DLL, archive, native PE
  through Ghidra, APK via jadx and apktool) and a copy-based profile deploy script.
- **Cleanup**: all non-plugin REA registrations removed — 16 clients (Claude Code, Codex,
  Cursor, Gemini CLI, Antigravity, Copilot CLI, Qwen Code, Kimi, VS Code, Windsurf,
  WorkBuddy, Grok Build, Hermes, OpenCode, ZCode) plus 6 skill installs, the standalone
  bridge directory, and 32 REA backup artifacts, all archived outside client config trees.