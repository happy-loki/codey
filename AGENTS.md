# Repository Guidelines

This guide helps new contributors ramp quickly on the Arthas desktop stack.

## Project Purpose
- Arthas is a Tauri desktop app that launches the user's installed `codex app-server` process and provides a rich, local-first workspace UI (editor, terminal, file tree, diagrams, etc.).
- It focuses on "AI + tools" workflows: the UI talks to the Rust backend, which brokers JSON-RPC traffic to Codex and exposes local Arthas capabilities (filesystem, git, workspace state, etc.) to the assistant.

## Architecture Overview
- UI (Svelte/Vite): `src/` renders the workspace experience and consumes protocol bindings for talking to Codex and the backend.
- Desktop shell + backend (Tauri 2 / Rust): `src-tauri/` owns windows, commands, permissions, and system integration.
- External Codex app-server client: `src-tauri/src/codex_integration.rs` starts `codex app-server` as a subprocess and communicates over stdin/stdout JSON-RPC.
- Codex environment: Arthas relies on the user's installed Codex CLI and global `~/.codex` configuration. It does not install MCP servers, skills, plugins, or config entries for Codex.
- Release/update pipeline: in-app updater support remains, but release artifacts should be produced by GitHub Actions and published from the open-source repository. Do not reintroduce private release scripts or self-hosted update endpoints.

## Typical Data Flow
- User action in UI -> frontend code (Svelte) dispatches a request (either to Tauri commands, or to Codex via the app-server protocol).
- UI <-> backend bridge -> Tauri IPC invokes Rust commands in `src-tauri/src/commands/` for local capabilities (fs/git/system/workspace, etc.).
- UI <-> Codex app-server -> Rust backend forwards JSON-RPC requests/responses/notifications to the external `codex app-server`; see `src-tauri/src/codex_integration.rs`.
- Results -> responses and notifications are forwarded back to the UI to update views (editor, terminal, tool outputs, notifications).

## Project Structure & Module Organization
- `src/`: Svelte web UI entry (`App.svelte`), shared components in `src/lib`, config helpers in `src/config`.
- `src-tauri/`: Tauri 2 Rust backend; key files include `src-tauri/src/main.rs`, `src-tauri/src/codex_integration.rs`, and the `commands/` module.
- `skills/`: Legacy bundled skill assets. Do not auto-install them into Codex home or mutate the user's Codex environment.
- `public/`: Static assets (app shell, splash screens, fonts, icons).
- `docs/`: Current design and migration notes for the Codex CLI app-server architecture.
- `scripts/`: Small local helper scripts only; release publishing belongs in GitHub Actions.
- Build outputs live in `dist/` (web) and `src-tauri/target/` (Rust). For now, release builds produce runnable binaries instead of MSI installers.

## Build, Test, and Development Commands
- `yarn dev`: Launch the Vite dev server (web UI only).
- `yarn build`: Produce the production web bundle in `dist/`.
- `yarn start`: Preview the built UI locally.
- `yarn start-window`: Run the full desktop app in dev mode (`tauri dev --features devtools`).
- `yarn tauri-build-debug`: Build the web bundle and debug desktop binary.
- `yarn tauri-build`: Build the web bundle and production desktop binary.
- Rust tests run with `cd src-tauri && cargo test`.

## Coding Style & Naming Conventions
- Format frontend code with Prettier (`.prettierrc.json`) using 4-space tabs, semicolons, and double quotes.
- Use TypeScript ESM modules, favor explicit types, and name variables `camelCase`, components `PascalCase`, and Rust modules `snake_case`.
- Co-locate Svelte styles with components and rely on `rustfmt` for backend formatting.

## Testing Guidelines
- Run `yarn check` for TypeScript/Svelte diagnostics.
- Add Rust unit tests inside modules (`mod tests`) and execute `cargo test` from `src-tauri/`.

## Commit & Pull Request Guidelines
- Follow Conventional Commits, e.g., `feat(ui): add cline panel` or `fix(bridge): handle cancel`.
- Keep PRs focused with clear descriptions, verification steps, linked issues, and UI screenshots or GIFs when relevant.
- Update documentation whenever behavior, commands, or configuration change.

## Security & Configuration Tips
- Use the Node LTS defined in `.nvmrc` and install dependencies with `yarn`.
- Review Tauri permissions in `src-tauri/tauri.conf.json` and capability manifests before shipping.
- Arthas 桌面端使用 Codex CLI 官方默认 home：启动外部 `codex app-server` 时不继承 `CODEX_HOME`，默认落到 `~/.codex`。不要创建或写入私有 `%LOCALAPPDATA%\\arthas\\codex`。
- Arthas 不安装、修复、启用、禁用 Codex skills/plugins，也不写入 Codex config、MCP、model provider 或 model catalog。
- Provider credentials live in the environment (e.g., `DEEPSEEK_API_KEY`). Avoid committing secrets or absolute paths.

## Codex Protocol Bindings
- Frontend code imports protocol types from `src/lib/codex/types.ts`, which re-exports the checked-in generated bindings (v2 schema plus ServerNotification helpers).
- Backend code uses local lightweight protocol helpers in `src-tauri/src/codex_protocol_types.rs`.
- Do not reintroduce `external/codex` Rust path dependencies or make normal Arthas builds compile Codex from source.
