# Codey

Codey 是一个基于 Tauri 2 的本地优先桌面工作区。它把文件树、编辑器、终端、Git、Markdown、Draw.io、白板和 Excalidraw 等工具放在同一个工作界面中，并通过官方 Codex CLI 的 `app-server` 提供 Agent 对话能力。

## 核心能力

- 通过 Codex Agent 进行对话、创建线程、恢复历史线程和执行任务
- 子 Agent 任务可在当前 ChatView 的只读抽屉中查看消息和工具摘要；使用 `thread/read` 读取，不恢复或抢占正在运行的子线程。
- 子 Agent 创建卡片展示可取得的昵称、角色、状态、模型、思考强度、历史继承范围、工作目录、父级和创建时间，抽屉复用这些信息。卡片按身份、模型设置、来源信息紧凑排列，并随可用宽度换行。模型和继承范围可从 app-server 返回路径对应的本地记录只读补齐；创建时尚未写入的字段在任务完成或打开详情时补读。省略加密任务正文和无法确认的属性。
- 文件树、文本编辑器、Markdown 预览和图片预览
- ChatView 支持标准 Markdown 媒体嵌入（`![说明](路径)`）和明确写出的音频/视频 HTML；相对媒体路径按当前工作区解析，本地文件通过 Tauri asset protocol 加载。普通 Markdown 文件链接保持编辑器跳转行为（相对路径也会按当前工作区解析）。为保证安全，不支持任意 iframe、script 或其他嵌入式页面。
- 本地终端与工作区管理
- Git 状态和常用 Git 操作
- Draw.io、白板、Excalidraw 等可视化工具
- 本地设置、主题、字体和工作区状态
- 应用内自动更新支持

## Codex 集成方式

Codey 是 Codex 的桌面客户端，不包含 Codex runtime，也不从源码编译 Codex。

启动 Agent 时，Rust 后端会查找并启动用户机器上的：

```text
codex app-server
```

双方通过标准输入输出进行逐行 JSON-RPC 通信。Codex 的运行时版本、登录状态、模型、配置和扩展由用户安装的 Codex CLI 自己负责。

Codey 遵循以下边界：

- 使用用户全局安装的 `codex` CLI；Windows、macOS、Linux 均依赖系统可执行入口
- 不设置自定义 `CODEX_HOME`
- 不创建或维护 Codey 私有 Codex home
- 不写入、迁移或修复用户的 `~/.codex`
- 不安装、卸载、启用或禁用 Codex skills、plugins、marketplaces
- 不修改 Codex 全局配置、MCP、provider 或 model catalog
- 不编译或依赖 `external/codex`

因此，用户在 Codex CLI 中已有的全局配置和登录状态会由外部 `codex app-server` 按官方规则使用。Codey 自己的设置只影响 Codey UI 和本地工作区。

### ChatView 的 `@` 资源补全

在聊天输入框中输入 `@` 可以选择当前 Codex 环境里的资源：

- 已启用的 Skill（发送为 `UserInput::Skill`，携带 Skill 名称和 `SKILL.md` 路径）
- 已安装且启用的 Plugin（发送为 `UserInput::Mention`，携带 Plugin 名称和 `plugin://...` 标识）

候选由外部 app-server 的 `skills/list` 和 `plugin/list` 返回，Codey 只负责展示和发送选择结果，不安装、启用或修改这些资源。这个补全不会搜索文件；文件和目录仍使用拖拽或附件入口。当前 app-server 没有独立的 Agent catalog，因此线程或 sub-agent 不会被伪装成 `@` 候选。

## 环境要求

- Node.js，版本以 `.nvmrc` 为准
- Yarn
- Rust stable 与 Cargo
- 已安装并可以在终端执行的 Codex CLI

先确认 Codex CLI 可用：

```bash
codex --version
```

如果 Codey 找不到 Codex，请检查当前桌面进程继承到的 `PATH`。使用 nvm、fnm、Volta、Homebrew 或其他包管理器安装 Codex 时，需要确保对应的可执行入口对 Codey 可见。Windows 的 `WindowsApps` 包目录不作为绕过权限的方式使用。

## 开发

安装依赖：

```bash
yarn
```

同步当前 Codex CLI 的 app-server TypeScript 协议绑定（需要先确认 `codex --version` 可用）：

```bash
yarn codex:protocol:generate
```

协议绑定会提交到 `src/lib/codex/protocol/generated/`，不会在普通构建时自动改写。

启动前端开发服务：

```bash
yarn dev
```

启动完整桌面开发模式：

```bash
yarn start-window
```

默认不会把外部 `codex app-server` 的常规 tracing 或工具输出刷到 WebView；子进程默认使用
`warn,codex_otel.log_only=off`。需要临时排查 app-server 时，分别设置 Codey 的
`RUST_LOG=debug` 和子进程专用的 `CODEY_CODEX_RUST_LOG=debug`。

执行完整的前端类型和 Svelte 检查：

```bash
yarn run check
```

项目仍有一批历史类型错误。CI 使用已提交的错误基线，只允许错误数量和位置减少，不允许新增错误：

```bash
yarn check:ci
```

修复历史错误后，使用以下命令缩减基线并提交更新；该命令不会接受新增错误：

```bash
yarn check:baseline:update
```

这里必须写成 `yarn run check`；Yarn Classic 的内置 `check` 命令优先级高于同名脚本，直接执行 `yarn check` 只会检查依赖完整性。

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
src-tauri/target/debug/codey.exe
```

构建 Release 桌面二进制：

```bash
yarn tauri-build
```

输出位于：

```text
src-tauri/target/release/codey.exe
```

Release 构建保留 WebView DevTools，运行后可按 `F12` 或 `Ctrl+Shift+I` 查看主窗口控制台。

上述本地开发命令生成可运行二进制。面向用户的 Windows 版本通过 GitHub Actions 生成简体中文 MSI 安装包，支持安装、覆盖升级和卸载；在 Windows 本地可用 `yarn tauri build --bundles msi` 构建安装包。

## GitHub Actions

公开构建分成两条流水线：

- `ci.yml`：在 `push` 和 `pull_request` 上跑 Windows 和 macOS 的 `yarn build`、`yarn check:ci`、发布门禁测试和 `cargo test`，验证 Windows MSI 安装/卸载，并上传未发布的构建 artifact
- `release.yml`：在 `v*` 标签和手动触发时创建 Release 草稿，构建并验证三个平台的安装包与签名更新文件，全部通过后才公开发布

发布产物命名为：

- Windows：`codey-v<version>-windows-x64-msi.msi`（简体中文安装向导）
- macOS arm64：`codey-v<version>-macos-arm64-dmg.dmg`
- macOS x64：`codey-v<version>-macos-x64-dmg.dmg`

Release 还包含 macOS `.app.tar.gz` 更新包、更新包的 `.sig` 签名和 `latest.json`。Windows 自动更新直接使用 MSI。Apple 签名只适用于 macOS；当前 Windows MSI 未配置 Authenticode 发布者证书。

发布前通过 Release ID 读取草稿资产，将更新清单中的地址转换为当前版本的公开下载地址，再校验各平台及签名。草稿不会被客户端发现；仅推送标签或构建成功还不代表发布完成。

### 应用内自动更新

从 `0.0.50` 起，应用使用公开仓库的 `releases/latest/download/latest.json`。默认启动时检查并在后台下载更新，用户点击“立即重启”后安装；也可以在设置中检查更新或关闭自动更新。

`0.0.49` 及更早版本没有配置更新地址，需要先手动安装一次新版。后续发布递增版本后，已安装的新版才能发现可用更新。应用不会把同版本重新安装一遍。

正式发布必须配置 `TAURI_SIGNING_PRIVATE_KEY`；私钥如有密码，还需配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。应用内只保存公钥，私钥仅由发布环境读取。`tauri.release.conf.json` 开启签名更新包生成，普通本地/CI 构建无需私钥。详见 [发布与自动更新](docs/RELEASE_AND_UPDATES.md)。

### macOS 发布凭证

CI 的 macOS 检查构建使用 ad-hoc 签名，不需要 Apple 凭证。正式 Release 使用 `Developer ID Application` 证书并进行公证；以下 secret 应只配置在 `happy-loki/codey` 仓库：

- 必需：`APPLE_CERTIFICATE`（包含私钥的 `Developer ID Application` `.p12` 文件的 base64 内容）、`APPLE_CERTIFICATE_PASSWORD`
- 可选：`APPLE_SIGNING_IDENTITY`（不填时由证书自动推断）、`APPLE_PROVIDER_SHORT_NAME`
- 公证二选一：
  - App Store Connect API（具备 Developer 权限）：`APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_P8`（`.p8` 文件内容）
  - Apple ID：`APPLE_ID`、`APPLE_PASSWORD`（app-specific password）、`APPLE_TEAM_ID`

Codey 不发布到 App Store。证书必须在 Mac 上生成 CSR 并导出带私钥的 `.p12`。可以全程在 Mac clone 当前仓库后写入 GitHub Secrets，也可以把 `.p12` 拷回 Windows 再写。完整操作步骤见 [docs/MACOS_RELEASE_SIGNING.md](docs/MACOS_RELEASE_SIGNING.md)。

当前 workflow 让 Tauri 自动导入临时钥匙串，因此不额外需要 `KEYCHAIN_PASSWORD`。不要把证书、私钥或密码提交到仓库。

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

Codey 需要用户自行准备 Codex 的认证环境。项目不会替用户保存或迁移 Codex 凭据。

## 当前状态

当前项目正在从旧的进程内 Codex 集成收敛到官方 Codex CLI app-server 架构。前端聊天和工作区交互保持原有形态，后端协议桥接使用外部 CLI，因此不同 Codex CLI 版本之间需要通过实际联调验证兼容性。

详细迁移背景和验收基线见 [`docs/CODEX_EXTERNAL_APP_SERVER_MIGRATION_PLAN.md`](docs/CODEX_EXTERNAL_APP_SERVER_MIGRATION_PLAN.md)。
协议绑定、时间线 item 和通知路由的同步安排见 [`docs/CODEX_APP_SERVER_PROTOCOL_ALIGNMENT.md`](docs/CODEX_APP_SERVER_PROTOCOL_ALIGNMENT.md)。

## 许可

见 [`LICENSE`](LICENSE)。
