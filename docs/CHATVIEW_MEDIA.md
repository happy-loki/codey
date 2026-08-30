# ChatView 媒体渲染

ChatView 的 Markdown 渲染器只把显式的 Markdown 媒体嵌入和明确写出的媒体 HTML 当作媒体：

- 图片语法：`![说明](./images/example.png)`
- 音频/视频嵌入语法：`![录音](./audio/example.mp3)`、`![视频](./video/example.mp4)`
- 音频：`<audio src="./audio/example.mp3" controls></audio>`
- 视频：`<video src="./video/example.mp4" controls></video>`
- 受限的媒体 HTML：`<source>`、`<track>` 和 `<picture>`

普通 Markdown 链接（例如 `[打开文件](./src/main.ts)` 或 `[录音文件](./audio/example.mp3)`）不会按扩展名猜测媒体类型，而是作为文件链接打开编辑器。相对文件链接按当前工作区解析。

`![说明](...)` 是显式嵌入语法：图片扩展名渲染为图片，音频/视频扩展名渲染为对应的原生播放器。普通 `[说明](...)` 链接和消息中的裸路径不会按扩展名猜测媒体类型。

相对路径以当前 ChatView 工作区目录为基准。Windows、macOS 和 Linux 的绝对路径以及 `file://` 路径会先转换为 Tauri asset URL，再交给 WebView 加载，因此不会直接请求被 WebView 拒绝的 `file:///...` 地址。远程 `https:`、`blob:` 和受支持的媒体 `data:` URL 会保留。

音频和视频默认显示原生控件、预加载元数据，并不会自动播放。媒体格式是否能播放仍取决于系统 WebView 的编解码器支持。

渲染前会经过 DOMPurify 安全过滤。ChatView 不允许任意 `iframe`、`script`、`object` 或 `embed`，也不会执行 Markdown 中的脚本 URL。
