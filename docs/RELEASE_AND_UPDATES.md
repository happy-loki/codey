# 发布与自动更新

Windows 发布简体中文 MSI 安装包，macOS 发布 Apple 签名、公证后的 arm64 和 x64 DMG。自动更新使用同一公开 GitHub Release 中的 `latest.json`，无需私有更新服务。

## 用户侧行为

从 `0.0.50` 起，默认在启动时检查更新并后台下载。下载后显示重启提示，用户点击“立即重启”时才安装。设置页也支持手动检查或关闭自动更新。

`0.0.49` 及更早版本的更新配置为空，需要手动安装一次 `0.0.50` 或之后的版本。新安装版本只会发现更高版本的更新。macOS 应将应用拖入“应用程序”后运行，不要直接从只读 DMG 中运行。

## 发布配置

- `src-tauri/tauri.conf.json` 内置公开更新地址和 Tauri 更新签名公钥。普通本地/CI 打包默认不生成签名更新文件。
- `src-tauri/tauri.windows.conf.json` 配置 MSI、简体中文向导和固定 WiX `upgradeCode`。后续版本必须保持升级标识不变，才能覆盖升级同一个应用。
- `src-tauri/tauri.release.conf.json` 仅在正式发布时合并，启用 `createUpdaterArtifacts`。
- `release.yml` 创建草稿，依次构建 Windows MSI、macOS arm64、macOS x64。每个平台检查类型基线和 Rust 测试；Windows 实际安装并卸载 MSI，macOS 校验代码签名、Gatekeeper 和公证票据。最后校验所有平台更新条目、安装包和对应 `.sig`，再公开 Release。

更新包由 Tauri 签名。Windows 直接使用 `.msi` 和 `.msi.sig`，macOS 使用 `.app.tar.gz` 和 `.app.tar.gz.sig`；Tauri action 合并生成三平台的 `latest.json`。公开入口为：

```text
https://github.com/happy-loki/codey/releases/latest/download/latest.json
```

## 必要 Secrets

所有平台需要 `TAURI_SIGNING_PRIVATE_KEY`（Tauri CLI 生成的私钥内容）；加密私钥还需要 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。公钥可提交，私钥和密码不可提交。必须备份原始私钥；换用不匹配的密钥会使已安装用户无法验证更新。

Apple `.p12` 用于 macOS 代码签名，`.p8` 用于 Apple 公证；二者都不能替代 Tauri 更新私钥。Apple Secrets 见 [MACOS_RELEASE_SIGNING.md](MACOS_RELEASE_SIGNING.md)。Windows MSI 目前没有 Authenticode 发布者证书，更新文件仍由 Tauri 公钥验证。

## 发布新版

1. 递增 `package.json` 版本，执行 `yarn sync:version`，并通过 Cargo 命令同步锁文件中的 Codey 版本。
2. 提交版本变更，等待 `ci.yml` 成功。
3. 推送与版本完全一致的 `v<version>` 标签，或在 Actions 手动运行 `Release`。
4. 检查发布运行全部通过，Release 出现 MSI、两种架构 DMG、更新包、签名和 `latest.json`。

若任何平台失败，Release 保持草稿，不改变用户看到的最新稳定版本。修复后可重新运行同一草稿版本的流水线；不要覆盖已公开版本的安装包或重建签名密钥。

参考：[Tauri updater](https://v2.tauri.app/plugin/updater/)、[Windows Installer](https://v2.tauri.app/distribute/windows-installer/)、[Tauri action](https://github.com/tauri-apps/tauri-action)。
