# ChatView Markdown 与流式性能改造计划

状态：第一阶段已落地，持续验证中

日期：2026-09-04

## 1. 目标

解决 Agent 输出较大或持续时间较长时，ChatView 卡顿并间接拖慢编辑器、文件树和预览的
问题，同时保留实时 Markdown 渲染体验。

本计划包含两个层次：

1. Markdown 渲染只重新处理仍在增长的内容，已经闭合的 block 保持 DOM 不变。
2. ChatView 的高频 delta 更新不再让整条时间线和所有可见卡片重复计算。

目标不是把 Markdown 延迟到任务完成后才显示，也不是重写现有虚拟列表。

## 2. 已确认的性能热点

### 2.1 Markdown 热点

- `MarkdownRenderer.svelte` 当前以一个 `{@html renderedHtml}` 容器渲染整个消息。
- 每次内容变化都会重新执行 `Marked.parse`、DOMPurify 和媒体 URL 处理。
- 流式阶段虽然使用 `requestAnimationFrame` 合帧，但合帧后仍然对完整字符串重新解析。
- `afterUpdate` 会重复扫描代码块并触发 MathJax；大消息下这些操作会阻塞主线程。
- 代码高亮、数学排版和媒体增强不应该参与每个 token 的热路径。

### 2.2 ChatView 热点

- `ChatView.svelte` 收到 `outputDelta` 后拼接完整字符串，并通过 `turns = [...turns]` 触发
  响应式更新。
- `ThreadItemFlatList.svelte` 每次 `turns` 更新都会重新投影全部历史行。
- `ThreadItemCard.svelte` 会对大型输出重复 `split`、统计行数和构造预览字符串。
- 一个长时间运行的命令会持续触发以上路径，即使实际只有一个卡片在变化。

### 2.3 影响范围

Tauri 前端和编辑器使用同一个 WebView。主线程被 ChatView 的解析、DOM 更新和布局占满时，
编辑器打开文件、文件树交互和预览也会排队，因此表现为“ChatView 卡住了编辑器”。

## 3. 方案调研结论

### 3.1 `svelte-exmarkdown`

参考目录：`refrence/svelte-exmarkdown-main`

它提供了清晰的 `remark -> rehype -> HAST -> Svelte component` 扩展链路，适合统一渲染器
和自定义组件。但 `Markdown.svelte` 在 `md` 变化时仍会完整执行 `parse(md)`，底层
`remark-parse`、`remark-rehype` 和 `runSync` 没有增量 parser state。因此它不能直接解决
长消息的流式卡顿问题。

另外，当前发布版本要求 Svelte 5，默认插件不包含 Codey 的本地路径解析、安全 URI 白名单、
Tauri asset URL 和显式 Markdown 媒体增强。它可以作为未来组件化渲染的参考，不作为本次性能
改造的直接替换品。

### 3.2 `@humanspeak/svelte-markdown`

它提供 `writeChunk()`、流式 token 复用和 Svelte 组件级更新，工程实践比较完整，但当前版本
要求 Svelte 5，并且流式模式仍会重新解析完整 Markdown，只是复用稳定 token 和 DOM。它可以
作为 Svelte 5 升级后的对照实现，但仍需要接入 Codey 的媒体、文件链接和安全策略。

### 3.3 `generative-dom`

它采用增量 tokenizer、可 diff AST 和 DOM patch：稳定 token 不重新解析，只处理当前未完成
的 block，并提供 Svelte 4/5 adapter。这是最接近目标的外部实现。

但它的默认链接和图片安全策略只覆盖 HTTP(S)，需要额外适配 Codey 的本地绝对路径、相对路径、
`file/asset/tauri` URL 和显式音视频规则。项目较新，不能在没有兼容性和安全测试的情况下直接
替换生产渲染器。

## 4. 当前技术决策

采用“现有渲染规则 + stable-block 增量层”的渐进方案：

- 保留 Marked、DOMPurify、现有 GFM 规则和媒体/文件链接处理。
- 不引入 React 运行时。
- 不建立跨会话的全局 Markdown 缓存或复杂持久化缓存。
- 每个流式 Markdown 实例只维护当前消息的 block 状态和稳定 DOM。
- 已确认闭合的 block 只解析和增强一次；最后一个不完整 block 按帧更新。
- 如果历史内容发生替换、线程恢复后内容不一致或解析状态无法证明安全，丢弃该实例的
  block 状态并执行一次完整重建，优先保证最终 Markdown 正确。

Svelte 5 升级作为基础设施工作单独完成，但不要求一次性把整个应用改成 runes。Svelte 5
兼容旧语法，可以先升级编译链，再逐个迁移 Markdown 和 ChatView 的新组件。

## 5. 目标架构

### 5.1 Markdown stable-block 流程

```text
delta/chunk
  -> 当前消息的 stream buffer
  -> 识别已经闭合的 Markdown block
  -> 稳定 block：只解析、sanitize、媒体处理一次
  -> 活跃 tail：每帧最多重新解析一次
  -> keyed block DOM，稳定区不重建
```

#### Block 状态

每个 block 至少包含：

- 稳定 ID（由流内起始偏移生成，不使用数组下标作为唯一身份）
- 原始 Markdown 文本
- 已解析并清理后的 HTML
- `complete` 状态
- 是否需要完成后的高亮、MathJax 或媒体增强

#### 边界判定

边界判定必须保守，不能因为暂时看到空行就错误冻结内容：

- 普通段落、标题、水平线在明确结束后可以冻结。
- 未闭合 fenced code、列表、引用、表格保留在活跃 tail 中。
- 当前实现先保留最后一个或两个可能继续增长的 block；不确定时重新解析 tail。
- 流结束时调用 `flush`，对 tail 做一次最终完整解析。

#### 渲染和增强

- `MarkdownBlock.svelte` 负责单个 block 的 HTML 挂载，使用 keyed each 保持稳定 DOM。
- 流式阶段只做必要的 Markdown 解析和安全过滤。
- 代码高亮、复制按钮、MathJax 和媒体增强只在 block 闭合后调度执行。
- 增强任务使用队列和 `requestIdleCallback`（不可用时回退到短延迟任务），不能阻塞下一帧
  的文本显示。
- 保留现有规则：只有标准 Markdown 图片或明确的音频/视频 HTML 才渲染媒体，普通文件链接
  仍然跳转编辑器。

### 5.2 ChatView 更新隔离

不改变 `@tanstack/svelte-virtual` 的滚动、测量和布局算法，只改变输入它的数据方式：

- 结构性变化（新增 turn/item、状态变化、折叠变化）继续更新 `turns` 并重建行投影。
- 文本 delta 进入当前 item 的流式 buffer，不在每个 delta 上复制整棵 `turns`。
- 所有 delta 在一个 animation frame 内合并，最多触发一次可见行更新。
- 当前卡片订阅自己的流式文本版本；无关卡片不重新执行 `getSummary`、目录解析和 Markdown
  解析。
- 行高发生变化时只请求受影响的虚拟行重新测量，不改变虚拟列表的核心逻辑。
- 卡片被虚拟化卸载后，流式 buffer 仍保留；重新挂载时从该 item 的当前内容恢复显示。

### 5.3 大型命令输出

- 接收端使用 chunk 数组或可追加 buffer，避免每个 delta 都创建新的完整字符串。
- 预览只保留头尾窗口和字符数，避免重复 `split` 全量日志；grep/read 摘要的行数统计在追加输出时只扫描新增后缀，避免 `split/filter` 数组分配。
- 长输出默认保持纯文本 `<pre>`，不送入 Markdown、MathJax 或代码高亮路径。
- 用户主动展开完整输出时再按需加载或渲染，展开动作不能影响主 ChatView 的流式更新。
- 原始输出仍可复制，不能因为预览截断而丢失数据。

## 6. Svelte 5 升级边界

### 阶段 A：编译链升级

- 升级 `svelte`、`@sveltejs/vite-plugin-svelte`、`svelte-check` 和相关类型包。
- 保留 legacy component syntax，先确保现有页面和 Tauri 构建不变。
- 检查 `svelte-splitpanes`、`@tanstack/svelte-virtual`、Monaco 和所有自定义 action 的兼容性。
- 先通过 `yarn run check`、`yarn build`，再进行组件迁移。

### 阶段 B：新组件使用 runes

- 新增的 `MarkdownBlock`、流式 buffer 和 ChatView 状态隔离组件使用 `$state`、`$derived`、
  `$effect`。
- 不为了使用 runes 重写已经稳定的文件树、编辑器和虚拟列表。
- 每次迁移保持一个主题单一的提交，避免升级和业务行为变更混在一起。

### 阶段 C：按需迁移旧组件

- 先迁移 `MarkdownRenderer.svelte` 和与其直接相关的测试。
- 再迁移 ChatView 的流式状态边界。
- 其它组件只有在 Svelte 5 检查或性能测量明确需要时才迁移。

## 7. 实施顺序与验收

### 任务清单

- [ ] 建立基线：记录 10 KB、50 KB、200 KB 输出下的 delta 频率、每帧耗时、长任务和掉帧。
- [x] 升级 Svelte 5 编译链，保留 legacy 语法并完成全量构建检查。`yarn build` 已通过；`yarn run check` 现已固定检查当前项目，但项目仍有升级前遗留的类型错误。
- [x] 抽取 Markdown block 边界扫描器，覆盖普通段落、代码块、列表、引用、表格的保守边界；扫描器支持 source offset，追加输入只扫描活动尾部，已验证分块输入与一次性输入不丢字符。
- [x] 增加 `MarkdownBlock` 和流式 block 状态，替换单一 `{@html renderedHtml}`；稳定 block 使用 keyed DOM，活动尾部按帧重解析。
- [x] 将高亮、MathJax、媒体增强移出 token 热路径；streaming card 使用 `enhance={false}`，高亮/MathJax 等增强只在流结束后执行，媒体 URL 仅在闭合 block 上处理。
- [x] 将 ChatView delta 更新改为按帧合并；agent、plan、命令输出和 reasoning delta 每帧最多触发一次顶层 `turns` 更新。
- [x] 让结构行投影与文本内容更新分离，保持虚拟列表滚动和折叠行为不变；只缓存终止状态的普通 turn，活动 turn 保持实时投影。
- [x] 优化大型命令输出的预览计算和展开路径：命令解析结果按 item fingerprint 复用，预览继续使用头尾窗口，摘要行数增量统计，未改变完整输出复制行为。
- [ ] 增加性能 benchmark、Markdown 等价性测试、媒体/路径安全测试和真实 Codex 联调。

### 必须通过的功能验收

- [ ] Markdown 在流式过程中持续显示，不需要等待 turn 完成。
- [ ] 分块输入和一次性输入最终生成相同的 DOM 语义和链接/媒体行为。
- [ ] 未闭合代码块、列表、引用和表格不会在中途冻结成错误结构。
- [ ] 普通 `[file](path)` 仍然走编辑器跳转；只有标准 Markdown 媒体嵌入渲染媒体。
- [ ] Windows、macOS、Linux 的本地媒体路径仍按现有 Tauri asset 规则加载。
- [ ] 展开/折叠时间线项目后，虚拟列表位置、行高和滚动不乱跳。
- [ ] ChatView 流式输出期间可以打开文件、切换文件树和编辑器标签。

### 性能验收目标

- [ ] 单帧 ChatView 更新的 JavaScript 执行时间目标低于 8 ms，硬上限为 16 ms。
- [ ] 50 KB 以上流式 Markdown 不再随总长度呈明显 O(N²) 增长。
- [ ] 稳定 block 在后续 delta 中不再次执行 Marked、DOMPurify 或 MathJax。
- [ ] 长命令输出不会让编辑器打开出现可感知阻塞。
- [ ] 性能数据在 Debug 构建采集，Release 构建不输出高频诊断日志。

## 8. 风险与回退

- Markdown block 边界判断可能影响列表、表格和引用。实现必须以等价性测试为门槛，无法
  证明安全时回退到 tail 重解析，而不是冻结错误 DOM。
- Svelte 5 升级可能暴露第三方组件兼容问题。升级提交与渲染器提交分离，出现问题时可以
  单独回退渲染器而不回退协议和 ChatView 其它修复。
- 外部增量库暂不作为生产依赖。可以用 `generative-dom` 做 benchmark 对照，只有在路径、
  媒体、安全和插件能力全部对齐后才重新评估是否采用。

## 9. 参考实现

- [svelte-exmarkdown](https://github.com/ssssota/svelte-exmarkdown)：AST 到 Svelte 组件的扩展方式
- [@humanspeak/svelte-markdown](https://github.com/humanspeak/svelte-markdown)：Svelte 流式 token 复用实践
- [generative-dom](https://github.com/generative-dom/generative-dom)：增量 tokenizer、AST diff 和 DOM patch
- [generative-dom streamability contract](https://github.com/generative-dom/generative-dom/blob/main/docs/streamability.md)：流式等价性和安全约束
