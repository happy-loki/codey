# Arthas

Arthas 是一个基于 Tauri 2 的本地优先桌面工作区。它把文件树、编辑器、终端、Git、Markdown、Draw.io、白板和 Excalidraw 等工具放在同一个工作界面中，并通过官方 Codex CLI 的 `app-server` 提供 Agent 对话能力。

## 核心能力

- 通过 Codex Agent 进行对话、创建线程、恢复历史线程和执行任务
- 文件树、文本编辑器、Markdown 预览和图片预览
- 本地终端与工作区管理
- Git 状态和常用 Git 操作
- Draw.io、白板、Excalidraw 等可视化工具
- 本地设置、主题、字体和工作区状态
- 应用内自动更新支持

## Codex 集成方式

Arthas 是 Codex 的桌面客户端，不包含 Codex runtime，也不从源码编译 Codex。

启动 Agent 时，Rust 后端会查找并启动用户机器上的：

```text
codex app-server
```

双方通过标准输入输出进行逐行 JSON-RPC 通信。Codex 的运行时版本、登录状态、模型、配置和扩展由用户安装的 Codex CLI 自己负责。

Arthas 遵循以下边界：

- 使用用户全局安装的 `codex` CLI；Windows、macOS、Linux 均依赖系统可执行入口
- 不设置自定义 `CODEX_HOME`
- 不创建或维护 Arthas 私有 Codex home
- 不写入、迁移或修复用户的 `~/.codex`
- 不安装、卸载、启用或禁用 Codex skills、plugins、marketplaces
- 不修改 Codex 全局配置、MCP、provider 或 model catalog
- 不编译或依赖 `external/codex`

因此，用户在 Codex CLI 中已有的全局配置和登录状态会由外部 `codex app-server` 按官方规则使用。Arthas 自己的设置只影响 Arthas UI 和本地工作区。

## 环境要求

- Node.js，版本以 `.nvmrc` 为准
- Yarn
- Rust stable 与 Cargo
- 已安装并可以在终端执行的 Codex CLI

先确认 Codex CLI 可用：

```bash
codex --version
```

如果 Arthas 找不到 Codex，请检查当前桌面进程继承到的 `PATH`。使用 nvm、fnm、Volta、Homebrew 或其他包管理器安装 Codex 时，需要确保对应的可执行入口对 Arthas 可见。Windows 的 `WindowsApps` 包目录不作为绕过权限的方式使用。

## 开发

安装依赖：

```bash
yarn
```

启动前端开发服务：

```bash
yarn dev
```

启动完整桌面开发模式：

```bash
yarn start-window
```

执行前端类型和 Svelte 检查：

```bash
yarn check
```

运行 Rust 测试：

```bash
cd src-tauri
cargo test
```

## 构建

构建前端资源：

```bash
yarn build
```

构建 Debug 桌面二进制：

```bash
yarn tauri-build-debug
```

输出位于：

```text
src-tauri/target/debug/arthas.exe
```

构建 Release 桌面二进制：

```bash
yarn tauri-build
```

输出位于：

```text
src-tauri/target/release/arthas.exe
```

当前构建命令直接生成可运行二进制，不生成 MSI 安装包。后续公开版本的构建和发布应由 GitHub Actions 负责；自动更新能力保留，更新产物应来自公开仓库的 Release。

## 项目结构

```text
src/                         Svelte/Vite 前端
src/lib/codex/               Codex 面板、聊天和协议类型
src/lib/drawio/              Draw.io 集成
src/lib/whiteboard/          白板功能
src-tauri/                   Tauri 配置和 Rust 后端
src-tauri/src/codex_integration.rs
                             外部 codex app-server 的进程和 JSON-RPC 桥接
src-tauri/src/commands/      文件、Git、系统和工作区命令
docs/                        当前架构与迁移文档
scripts/                     本地辅助脚本
public/                      静态资源
```

## 安全

不要提交以下内容：

- API key、访问令牌、密码或账号信息
- `.env` 文件
- 私钥、证书和签名文件
- 服务器地址、内部 IP 或私有发布配置
- 用户个人的 Codex 配置和工作区数据

Arthas 需要用户自行准备 Codex 的认证环境。项目不会替用户保存或迁移 Codex 凭据。

## 当前状态

当前项目正在从旧的进程内 Codex 集成收敛到官方 Codex CLI app-server 架构。前端聊天和工作区交互保持原有形态，后端协议桥接使用外部 CLI，因此不同 Codex CLI 版本之间需要通过实际联调验证兼容性。

详细迁移背景和验收基线见 [`docs/CODEX_EXTERNAL_APP_SERVER_MIGRATION_PLAN.md`](docs/CODEX_EXTERNAL_APP_SERVER_MIGRATION_PLAN.md)。

## 许可

见 [`LICENSE`](LICENSE)。
