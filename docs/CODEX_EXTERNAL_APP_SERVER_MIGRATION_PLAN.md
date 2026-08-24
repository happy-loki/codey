# Codex External App-Server Migration Plan

> 状态：第一轮迁移、环境写入收敛、设置界面只读化和文档同步已完成。本文保留为当前架构与验收基线。

## 目标

把 Codey 从“进程内集成 Codex Rust runtime”改成“外部启动 Codex CLI 的 `app-server`”，同时保持现有 Codey 聊天、线程、工具请求确认等前端交互尽量不变。

新的边界是：

- Codey 只做 Codex 客户端和桌面壳。
- 后端通过 stdin/stdout 与 `codex app-server` 做逐行 JSON-RPC 通信。
- 前端继续使用现有 Tauri commands：`codex_thread_start`、`codex_turn_start`、`codex_model_list`、`codex_respond_to_request` 等。
- 前端继续接收现有事件：`codex:notification`、`codex:request`。
- Codey 不再设置或继承 `CODEX_HOME`。
- Codey 不再安装、修复、启用、禁用 Codex skills/plugins。
- Codey 不再写入或注入 Codex config、MCP、model provider、model catalog。
- Codex home 固定交给 `codex-cli` 官方默认规则处理：Codey 启动外部 `codex app-server` 时移除 `CODEX_HOME`，让 Codex 使用标准 `~/.codex`。

## 非目标

- 不自动帮用户修复 WindowsApps 安装目录。WindowsApps 包目录可以作为诊断线索，但不能硬编码为可执行入口。
- 不迁移或修改用户全局 `~/.codex` 配置。
- 不保留 Codey Gateway、bundled browser/chrome plugin、内置 skill 自动安装等 Codey 私有 Codex 环境能力。

## 参考实现

参考项目：`D:/codey/refrence/CodexMonitor-main`

关键借鉴点：

- `src-tauri/src/backend/app_server.rs`
- 启动 `codex app-server` 子进程。
- `initialize` request 后发送 `initialized` notification。
- stdout 按行解析 JSON-RPC：
  - `id + result/error`：匹配 pending request。
  - `id + method`：服务端 request，转发到前端。
  - `method` 且无 `id`：服务端 notification，转发到前端。
- stdin 写入 JSON-RPC request/response/notification，每条消息一行。

## 阶段 1：切掉 Codex Rust Runtime 编译依赖

### 改动范围

- 从 `src-tauri/Cargo.toml` 移除 `codex-*` path dependencies。
- 后端不再引用 `external/codex/codex-rs/*` 的 Rust crates。
- 少量协议类型改成本地轻量定义或直接用 `serde_json::Value`：
  - JSON-RPC request id。
  - server notification/request payload。
  - patch preview 需要的变更结构。
- 旧的 in-process app-server 初始化、ConfigBuilder、EnvironmentManager、cloud requirements、Codex login/config loader 全部退出启动路径。
- 重构 `src-tauri/src/codex_integration.rs` 里的 `CodexState`。
- `CodexState` 从保存 `InProcessClientSender` 改为保存外部 app-server client。
- 新 client 至少包含：
  - `child: Mutex<tokio::process::Child>`
  - `stdin: Mutex<tokio::process::ChildStdin>`
  - `pending: Mutex<HashMap<RequestIdKey, oneshot::Sender<Value>>>`
  - `next_id: AtomicU64`
- `send_request(method, params)`：
  - 生成 JSON-RPC id。
  - 写入 `{"id": "...", "method": "...", "params": ...}`。
  - 等待 pending response。
  - 对 app-server error 返回清晰错误。
- `send_response(request_id, response)`：
  - 写入 `{"id": request_id, "result": response}`。
- stdout loop：
  - response 唤醒 pending。
  - server request emit `codex:request`。
  - server notification emit `codex:notification`。
- stderr loop：
  - 只记录日志，不写 Codex 环境。

### 验收

- `src-tauri` 不再需要 `external/codex` 子模块即可进入编译。
- `codex_initialize` 能在 app 启动后返回成功。
- `codex_model_list` 能通过外部 app-server 返回模型列表或返回来自 Codex CLI 的明确错误。
- `codex_thread_start` / `codex_turn_start` 不需要改前端调用形态。
- 服务端 elicitation/request 仍能通过 `codex:request` 到达 UI，`codex_respond_to_request` 能回写 response。

## 阶段 2：停止环境写入和私有注入

### 删除/停用启动副作用

- 不创建 `%LOCALAPPDATA%/codey/codex` 作为 Codex home。
- 不调用 `std::env::set_var("CODEX_HOME", ...)`。
- 启动外部 `codex app-server` 子进程时显式移除父进程里的 `CODEX_HOME`。
- 不移除 `OPENAI_API_KEY` / `CODEX_API_KEY`。
- 不调用 `try_install_bundled_skills`。
- 不调用 bundled plugin reconcile/repair。
- 不调用 Control Plane model catalog sync。
- 不调用 `append_node_repl_mcp_overrides`。
- 不写 `config.toml`。
- 不注入 Codey MCP runtime overrides。
- 不设置 Codex originator/user-agent/build override。

### 保留

- Codey 自己的 embedded MCP server 可以继续存在，供 Codey 本身的数据集工具使用。
- 但不自动写进 Codex 全局配置，也不通过 CLI overrides 注入给 Codex。

### 验收

- 启动 Codey 不会新增或修改 `%LOCALAPPDATA%/codey/codex`。
- 启动 Codey 不会修改 `~/.codex/config.toml`、`skills/`、`plugins/`。
- 即使父进程存在 `CODEX_HOME`，外部 `codex app-server` 也不继承它，始终回落到 Codex CLI 官方默认 home。

## 阶段 3：Codex CLI 发现与诊断

### 查找顺序

1. Codey 显式设置的 Codex binary path/command。
2. 当前 `PATH` 里的 `codex`。
3. 常见 PATH 补充：
   - Windows: `%APPDATA%/npm`、nvm/nvm-windows、fnm、Volta、Bun、`~/.cargo/bin`、Scoop、Chocolatey、`%LOCALAPPDATA%/Microsoft/WindowsApps`。
   - macOS/Linux: Homebrew、`~/.local/bin`、`~/.cargo/bin`、nvm、fnm、Volta、asdf、mise、Bun。
4. Windows Appx 安装目录只做错误提示，不直接硬编码执行。

### 验收

- 找不到 CLI 时提示用户运行 `codex --version` 并配置可执行入口。
- WindowsApps 包目录存在但不可执行时，不把它当成成功。
- `codex --version` 超时或失败时，错误信息包含 stdout/stderr 摘要。
- Windows 上的 `codex.cmd` / `codex.bat` 可通过隐藏窗口的 `cmd /D /S /C` 启动，支持空格和中文路径。

## 阶段 4：收敛 Settings / Skills / Plugins UI

严格“不影响 Codex 环境”时，写入入口必须处理：

- settings 保存：禁用、改为只读，或明确变成“打开全局 Codex 配置文件”而不是 Codey 写入。
- skills 导入/删除/启用：禁用或隐藏。
- plugin install/uninstall/enable/marketplace：禁用或隐藏。
- bundled official plugin 修复入口：移除。

### 验收

- UI 中没有会静默修改 `~/.codex` 的 Codey 操作。
- 用户要改 Codex 环境时，必须离开 Codey 自动流程，改用 Codex 自己的 CLI/配置方式。

## 第一轮实施结果

以下事项已完成：

1. 移除 `Cargo.toml` 中的 `codex-*` path dependencies。
2. 添加本地轻量 JSON-RPC / protocol helper。
3. 添加外部 app-server client。
4. 改 `CodexState::send_request` / `send_response` 走子进程 JSON-RPC。
5. 改 `init_codex_inner` 启动 `codex app-server`，发送 `initialize` / `initialized`。
6. 去掉启动时私有 `CODEX_HOME`、skills/plugins/config/model catalog/MCP 注入。
7. 保留现有 Tauri command 和前端事件 payload。
8. 运行前端检查、构建和 Rust 验证，并根据结果修正。

## 第二轮实施结果

以下事项已完成：

1. settings 中的 Codex UI 偏好改为 Codey 本地偏好文件，不再写入全局 Codex `config.toml`。
2. MCP 状态和工具信息保留查看能力，编辑、启用、禁用等写入入口改为只读或明确拒绝。
3. Skills、Plugins、Marketplace 的写入入口明确拒绝，不再由 Codey 自动安装、修复或切换。
4. `docs/` 只保留本次外部 app-server 迁移文档，旧进程内集成总结和私有发布说明已删除。

## 第三轮实施结果

以下事项已完成：

1. 移除 Agent 面板对 Codey account/authMode 的前端门禁；未读取到 account 时不再跳转旧账号设置页。
2. Agent 启动后直接进入线程/聊天工作区，模型、历史、新会话按外部 `codex-cli` runtime 能力加载。
3. Settings 移除旧账号入口，不再显示旧登录页。
4. 后端 `codex_account_login` / `codex_account_logout` / `codex_cancel_login_account` 改为明确拒绝，避免 Codey 修改全局 Codex 登录态。

## 当前仍需关注

1. 用户机器需要提供可执行的全局 `codex` CLI；WindowsApps 包目录只用于诊断，不绕过 AppX 权限。
2. 外部 Codex CLI 的 app-server 协议版本变化需要通过兼容性测试发现，Codey 不再通过编译 `external/codex` 来锁定运行时版本。
3. 应用内自动更新能力保留；后续 updater endpoint 应指向 GitHub Actions/Release 产出的公开更新 manifest 和二进制产物，不再使用私有 release 仓库、自托管更新服务或本地发布脚本。

## GitHub 发布流水线

公开发布改为 GitHub Actions 驱动：

- `ci.yml` 在 `push` 和 `pull_request` 上验证 Windows 与 macOS
- `release.yml` 在 `v*` 标签和手动触发时发布 Release
- Windows 产物保持直接 `.exe`
- macOS 产物输出 `.dmg`
- CI 检查构建使用 macOS ad-hoc 签名；正式 macOS Release 使用 `Developer ID Application` 证书并完成公证，凭证只配置在 `happy-loki/codey` 仓库

这样可以把构建、验证和发布都收敛到公开仓库，后续自动更新也可以直接指向 GitHub Release 产物。
