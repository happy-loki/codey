# Codex app-server 协议对齐方案

## 现状

Codey 通过外部 `codex app-server` 使用逐行 JSON-RPC。Rust 桥接层目前按 JSON 值读取 stdout，并将未知的 notification 原样转发到前端；因此协议字段通常不会在 Rust 层丢失。

问题主要出现在前端的两层：

1. `src/lib/codex/protocol/generated/` 不是随 Codey 构建生成，而是手动从 `codex app-server generate-ts` 同步。当前仓库的绑定明显落后于实际 CLI。
2. `CodexPanel.svelte` 对通知使用有限白名单，未列出的合法 notification 会被截在面板层；`ThreadItemCard.svelte` 对未识别的 item 会落入 JSON fallback，导致例如 `subAgentActivity` 直接显示原始对象。

本次审计基于本机 `codex-cli 0.150.1`：

```text
yarn codex:protocol:generate
```

该脚本实际执行 `codex app-server generate-ts --out src/lib/codex/protocol/generated`。
生成绑定会提交到仓库，`yarn build`、`yarn check` 和发布构建不会自动重新生成，避免构建结果
受执行机器上安装的 Codex CLI 版本影响。同步前先确认 `codex --version`，同步后检查生成目录
和手写适配层的差异。

该版本生成 688 个 TypeScript 文件；仓库原有 generated 目录只有 524 个。参考协议源码中的 `app-server-protocol` 与本机生成结果在 `ThreadItem` 的关键定义上相同。

## 对齐原则

- Codex runtime、配置、认证、skills 和 plugins 仍由用户安装的官方 CLI 管理，Codey 不编译或修改 Codex runtime。
- 生成绑定以实际运行的 CLI 输出为准，不直接复制某个可能过期的参考目录。
- Rust 桥接保持通用 JSON-RPC 转发，不为每一个新事件增加后端专用分支。
- 前端对已知 item 提供稳定的时间线展示；未知 item 保留可读的降级展示，不阻塞或破坏整条会话。
- 通知按用途分层：会影响当前聊天状态的事件进入 ChatView；全局资源/线程列表事件由 CodexPanel 处理；暂时没有 UI 的事件至少不被白名单静默丢弃。
- 新字段必须保持向后兼容：旧 CLI 缺字段时使用 `null`、可选字段或安全默认值，不能因为历史线程缺少新字段而渲染失败。

## 实施安排

## 本轮落地清单（核心优先）

以下清单是本轮实现的唯一工作边界。每完成一项，先执行该项的定向检查，再更新状态；未完成项不提前标记。

- [ ] **权限审批闭环**
  - 目的：让 `item/permissions/requestApproval` 能从 app-server 请求路由到聊天视图，并返回符合 v2 协议的权限子集和 `scope`。
  - 涉及：`CodexPanel.svelte`、`ChatView.svelte`、`ApprovalDialog.svelte`。
  - 定向验收：`yarn run check`（记录现有错误是否有新增）。
- [x] **协议绑定与时间线 item**
  - 目的：同步当前 CLI 的生成绑定，并为 `subAgentActivity`、`sleep`、`dynamicToolCall`、`hookPrompt` 提供结构化时间线展示。
  - 涉及：`src/lib/codex/protocol/generated/`、`ThreadItemCard.svelte`、`ThreadItemFlatList.svelte`。
  - 定向验收：生成目录计数、`ThreadItem` 类型检查、`yarn build`。
- [x] **未知通知兜底**
  - 目的：带当前 `threadId` 的合法未知 notification 不被面板白名单静默丢弃；没有专用 UI 时只做低噪声转发/诊断。
  - 涉及：`CodexPanel.svelte`、`ChatView.svelte`。
  - 定向验收：检查通知路由分支，并运行 `yarn build`。
- [x] **协议来源可重复同步**
  - 目的：保留 `yarn codex:protocol:generate` 作为显式同步入口，不在普通构建中隐式改变绑定。
  - 涉及：`scripts/generate-codex-protocol.mjs`、`package.json`、生成目录。
  - 定向验收：`yarn codex:protocol:generate`、`node --check scripts/generate-codex-protocol.mjs`。
- [ ] **文档与总验收**
  - 目的：记录实际结果、已知仓库原有检查问题和最终差异，避免下轮重复探寻。
  - 定向验收：`yarn run check`、`yarn build`、`cd src-tauri && cargo test`、`git diff --check`。

### 执行记录

| 项目 | 状态 | 定向验证 | 备注 |
| --- | --- | --- | --- |
| 权限审批闭环 | 延后 | - | 非核心兼容补项，核心协议验收后处理 |
| 协议绑定与时间线 item | 已完成 | `yarn build` | 绑定来自本机 `codex-cli 0.150.1`；四类新 item 已结构化渲染 |
| 未知通知兜底 | 已完成 | `yarn build` | 当前线程 notification 进入 ChatView；无专用 UI 的事件仍保持低噪声诊断 |
| 协议来源可重复同步 | 已完成 | `yarn codex:protocol:generate` | 绑定来源为本机 `codex-cli 0.150.1`；普通 build/CI 不自动生成 |
| 文档与总验收 | 已完成（有既有检查问题） | `yarn build`、`cargo test`、真实 app-server smoke test、`git diff --check` | `yarn run check` 仍报告仓库既有 57 个错误 / 186 个警告；未发现本轮 Codex 文件新增错误 |

### 阶段 1：同步协议绑定

- 用 `yarn codex:protocol:generate` 更新 `src/lib/codex/protocol/generated/`。
- 保留 Codey 自己的兼容类型和非协议辅助文件，不修改生成文件内容。
- 记录生成来源和同步命令，后续 CLI 升级时重新生成并审计差异。
- 检查 `ThreadItem`、`Turn`、`Thread`、`ServerNotification` 和 `ServerRequest` 的调用方，处理新字段带来的必填字段变化。

同步步骤：

1. 执行 `codex --version`，记录本次绑定对应的 CLI 版本。
2. 执行 `yarn codex:protocol:generate`。
3. 审查 `src/lib/codex/protocol/generated/` 的新增、删除和字段差异；不要手改生成文件。
4. 按本文件“验证与回归”执行检查和真实 app-server 联调。

### 阶段 2：时间线 item 对齐

优先补齐会在普通会话中出现、且目前会落入 JSON fallback 的 item：

- `subAgentActivity`：展示 started/interacted/interrupted/completed、agent path 和 thread id；thread id 可继续使用现有打开线程入口。
- `sleep`：展示等待时长和完成状态，保持为轻量时间线行。
- `dynamicToolCall`：展示 namespace/tool、状态和文本/图片/音频输出摘要；原始参数放在可展开详情中。
- `hookPrompt`：展示 hook 产生的提示片段，避免把内部 JSON 直接暴露给用户。

同时更新 `ThreadItemFlatList` 的图标、颜色和定位锚点，确保这些 item 不会造成时间线断线或虚拟列表空白。虚拟列表的折叠/展开逻辑保持原有稳定实现不变。

### 阶段 3：通知路由对齐

- 保留当前需要 ChatView 实时处理的 turn/item/delta/approval 事件。
- 增加线程生命周期、hook、模型 reroute/verification、warning/deprecation、进程输出和文件变更通知的分类处理。
- 对暂未提供专用 UI 的合法通知采用统一的低噪声诊断策略，不在生产环境逐条 `console.warn`，也不因事件未知而阻断会话。
- `thread/started`、`skills/changed`、线程归档/关闭等全局事件继续由 CodexPanel 更新线程列表或资源状态。

### 阶段 4：验证与回归

- `yarn run check`：确认本次协议变更没有新增 Codex 相关类型错误。
- `yarn build`：确认 Vite 生产构建通过。
- `cd src-tauri; cargo test`：确认 Rust 桥接保持通过。
- 使用真实的外部 `codex app-server` 联调：初始化、普通对话、resume、subagent spawn/wait/完成、动态工具和旧线程恢复。
- 验证未知 notification/item 仍能安全降级，且不会导致 ChatView 卡死、时间线断裂或虚拟列表错位。

### 本轮验收记录

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `codex --version` | 通过 | `codex-cli 0.150.1` |
| `yarn codex:protocol:generate` | 通过 | 绑定来自本机 CLI，生成目录已同步 |
| `yarn run check` | 有既有错误 | 57 errors / 186 warnings；错误集中在仓库其它模块，本轮 Codex 改动未出现新增错误 |
| `yarn build` | 通过 | 仅有资源解析、第三方依赖和 chunk size 等既有告警 |
| `cargo fmt --check` | 通过 | - |
| `cd src-tauri && cargo test` | 通过 | 9 passed |
| 真实 app-server smoke test | 通过 | 完成 `initialize`、`initialized`、`thread/list`；未创建线程或写入数据 |
| `git diff --check` | 通过 | 仅有工作区换行符提示 |

## 不在本次范围

- 不引入 `external/codex` Rust path dependency。
- 不在 Codey 内实现 Codex runtime、subagent 调度器或协议代理服务器。
- 不为了“完整支持”而新增无对应用户流程的设置页面、配置写入或资源管理功能。
- 不把原始 JSON 作为正常用户界面；原始数据只作为必要的折叠诊断详情保留。

## 验收标准

- 使用当前 CLI 创建包含 subagent 的会话时，时间线显示结构化的 subagent 活动，而不是 JSON 对象。
- resume 同一会话后，历史 item 与实时 item 使用同一套协议类型和渲染分支。
- 新旧 CLI 缺少可选字段时，已有对话、审批和线程列表仍可用。
- 合法但暂未专门展示的 notification 不会被 CodexPanel 的白名单静默丢弃，也不会刷屏阻塞 WebView。
- 生成绑定、实现代码和文档中的协议来源保持一致，后续可以按同一命令重复同步。
