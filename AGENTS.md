# Repository Guidelines

本文件是 Codey 的开发和维护约定。修改代码前先确认变更属于当前架构，不要根据旧版本的 Codex 集成方式恢复已删除的模块。

## 项目目的

Codey 是一个 Tauri 2 桌面应用，为本地工作区提供编辑器、文件树、终端、Git、Markdown、Draw.io、白板和 Excalidraw 等能力。Agent 功能由用户机器上安装的官方 Codex CLI 提供。

Codey 的职责是：

- 提供桌面 UI 和本地工作区工具
- 通过 Tauri IPC 暴露文件、Git、系统和工作区能力
- 启动并代理外部 `codex app-server`
- 将 Codex 的 JSON-RPC 响应和通知转发给前端

Codey 不拥有 Codex runtime，也不负责管理 Codex 的安装、认证或全局环境。

## 架构

### 前端

`src/` 是 Svelte/Vite 前端。`src/App.svelte` 负责应用入口和主要工作区布局，`src/lib/` 放置编辑器、终端、文件树、设置、Agent、Draw.io、白板和 Excalidraw 等模块。

Codex 相关 UI 位于 `src/lib/codex/`，协议类型位于 `src/lib/codex/types.ts` 及其本地生成/声明文件。

### Tauri 和 Rust 后端

`src-tauri/` 负责窗口、Tauri commands、权限、日志、系统集成和工作区状态。主要模块包括：

- `src-tauri/src/main.rs`：应用启动和 Tauri 状态注册
- `src-tauri/src/codex_integration.rs`：外部 Codex 进程和 JSON-RPC 桥接
- `src-tauri/src/codex_protocol_types.rs`：后端使用的轻量协议类型
- `src-tauri/src/commands/`：文件、Git、系统和工作区命令
- `src-tauri/src/settings.rs`：Codey 自身的本地设置

### 外部 Codex app-server

后端启动用户安装的：

```text
codex app-server
```

通信约定如下：

- 每条消息占一行 JSON
- Codey 通过 stdin 发送 request、response 和 notification
- Codey 从 stdout 读取 Codex 的 response、server request 和 notification
- 带 `id` 的 response 唤醒对应的 pending request
- 服务端 request 和 notification 通过 Tauri 事件转发到前端
- 服务端 stderr 只进入 Codey 日志，不作为协议数据处理

初始化时需要完成 app-server 协议规定的 `initialize` request 和 `initialized` notification。保持现有 Tauri command 和前端事件 payload 兼容，避免无必要地改动聊天交互。

## 数据流

典型调用链：

```text
用户操作
  -> Svelte 前端
  -> Tauri IPC command
  -> Rust 后端
  -> 外部 codex app-server stdin
  -> 外部 codex app-server stdout
  -> Rust pending request / Tauri event
  -> Svelte UI
```

本地文件、Git、系统和工作区操作走 `src-tauri/src/commands/`。Codex 对话、线程、模型列表和服务端请求走 `codex_integration.rs`。

## Codex 环境约束

这些约束是架构的一部分，不能为了方便测试或实现功能而绕过：

- 不添加 `external/codex` Rust path dependency
- 不让正常 Codey 构建编译 Codex 源码
- 不设置或继承自定义 `CODEX_HOME`
- 不创建 `%LOCALAPPDATA%\\codey\\codex` 等私有 Codex home
- 不写入用户的官方 `~/.codex`
- 不修改 Codex `config.toml`
- 不安装、卸载、修复、启用或禁用 skills、plugins、marketplaces
- 不注入 Codey 私有 MCP、provider、model catalog 或配置覆盖
- 不迁移用户已有的 Codex 登录状态和凭据

启动外部 CLI 时应移除进程环境中的 `CODEX_HOME`，让 Codex CLI 按官方默认规则选择 home。不要通过修改 WindowsApps 权限来执行 AppX 内部文件；找不到可执行入口时，应给出明确诊断，让用户配置可用的全局 `codex` 命令。

## 目录约定

```text
src/                         Svelte/Vite 前端
src/lib/codex/               Agent UI 和协议类型
src/lib/drawio/              Draw.io 功能
src/lib/whiteboard/          白板功能
src-tauri/                   Tauri 配置和 Rust 后端
src-tauri/src/codex_integration.rs
                             外部 Codex app-server 桥接
src-tauri/src/commands/      本地能力命令
docs/                        当前架构、迁移和验收文档
scripts/                     小型本地辅助脚本
public/                      静态资源
dist/                        前端构建输出，不提交
src-tauri/target/            Rust 构建输出，不提交
```

不要重新引入已删除的 IM、mindmap、embedded MCP 或旧的进程内 Codex runtime 模块。

## 常用命令

```bash
yarn                         # 安装前端依赖
yarn dev                     # 启动 Vite 前端开发服务
yarn build                   # 构建前端
yarn run check               # 完整 Svelte/TypeScript 检查（允许查看现有错误）
yarn check:ci                # CI 类型门禁：阻止新增错误
yarn start-window            # 启动 Tauri 开发模式
yarn tauri-build-debug       # 构建 Debug 桌面二进制
yarn tauri-build             # 构建 Release 桌面二进制
```

Rust 测试：

```bash
cd src-tauri
cargo test
```

当前构建命令生成可运行二进制，不生成 MSI。自动更新功能保留，但公开版本的构建、签名和发布应由 GitHub Actions 及 GitHub Release 产物负责，不要恢复旧的私有发布脚本、私有更新服务或私有发布地址。

## 编码规范

- 前端使用 TypeScript ESM、Svelte 和现有项目组件模式
- 变量使用 `camelCase`，组件使用 `PascalCase`，Rust 模块使用 `snake_case`
- 前端格式遵循 `.prettierrc.json`
- Rust 修改后运行 `rustfmt`
- 优先复用已有 command、事件和协议类型，不为一次性调用增加新抽象
- 注释只解释非显而易见的协议、生命周期或兼容性原因
- 保持变更范围聚焦，不顺手恢复旧模块或重构无关代码

## 测试要求

前端或 Svelte 代码变更后运行：

```bash
yarn check:ci
```

Rust 后端变更后运行：

```bash
cd src-tauri
cargo test
```

涉及 Codex 桥接时，还要进行一次真实联调：确认 `codex --version` 可用，启动 Codey 后能完成初始化、创建或恢复线程、发送一轮对话，并验证服务端通知以及需要用户响应的 request 能回到 UI。不要用 mock 代替唯一的外部进程验收。

## 文档和提交

行为、命令、配置边界或构建流程改变时同步更新 `README.md` 和 `docs/` 中的相关文档。

提交使用 Conventional Commits，例如：

```text
feat(codex): support external app-server notifications
fix(ui): preserve chat approval state
docs: update external Codex architecture
```

每次提交保持主题单一，并在提交说明或 PR 描述中记录验证命令。

## 安全规则

禁止提交：

- API key、token、密码和账号信息
- `.env` 文件
- 私钥、证书和签名文件
- 服务器地址、内部 IP 和私有发布配置
- 用户的 Codex home、工作区数据或日志

Provider credentials 必须由运行环境提供。检查变更时特别关注绝对路径、环境变量转发、日志输出和错误信息中是否泄露敏感数据。
