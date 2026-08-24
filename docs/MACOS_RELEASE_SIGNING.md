# macOS Release Signing

Codey 不发布到 App Store。macOS 正式 Release 通过 GitHub Release 分发 `.dmg`，需要 `Developer ID Application` 签名和 Apple notarization。

CI 的 macOS 检查构建使用 ad-hoc 签名，不需要这些凭证。只有 `.github/workflows/release.yml` 会读取它们。

凭证只配置到当前仓库 `happy-loki/codey`：

```text
https://github.com/happy-loki/codey/settings/secrets/actions
```

不要把 `.p12`、`.p8`、证书、密码或私钥提交到 git。

## 在哪台电脑做

可以全程在 Mac 上做，和 Windows 填 secret 的结果一样。推荐直接在 Mac clone 当前仓库，按这份文档做完证书、API Key 和 `gh secret set`。

```bash
git clone https://github.com/happy-loki/codey.git
cd codey
```

clone 只是为了对照文档和在仓库目录执行命令。凭证不会写入仓库文件，也不需要在 Mac 上提交。

必须在 Mac 上完成的只有这三步，因为私钥要在 Keychain 里生成：

1. 生成 CSR
2. 安装下载的 `.cer`
3. 导出包含私钥的 `.p12`

浏览器操作和 `gh secret set` 在 Mac 或 Windows 都可以。公证用的 App Store Connect API Key 只用于 `notarytool`，不会创建 App，也不会提交 App Store。

## 需要配置的 Secrets

最少配置这 5 个：

| Secret | 来源 | 填什么 |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | Mac 导出的 `.p12` | 文件的整段 Base64 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时自己设的密码 | 导出密码，不是 Apple 登录密码 |
| `APPLE_API_KEY` | App Store Connect Team API Key | Key ID |
| `APPLE_API_ISSUER` | 同一页顶部 | Issuer ID |
| `APPLE_API_KEY_P8` | 下载的 `AuthKey_<KEY_ID>.p8` | 文件全文，不是路径 |

通常不要配置：

- `APPLE_SIGNING_IDENTITY`：Tauri 会从证书推断
- `APPLE_PROVIDER_SHORT_NAME`：只有 Apple ID 属于多个团队时才需要
- `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`：这是公证备选方案。已经配置 API Key 时不要再配这一组，当前 workflow 会报错

不要配置：

- `Apple Development` / `Apple Distribution` / `Developer ID Installer` 证书
- Tauri updater 私钥
- 其他仓库的 secret

## Mac：生成 CSR

1. 打开 `Keychain Access`（钥匙串访问）
2. 菜单：`Keychain Access` → `Certificate Assistant` → `Request a Certificate From a Certificate Authority…`
3. 填写：
   - User Email Address：Apple Developer 邮箱
   - Common Name：例如 `Codey Developer ID`
   - CA Email Address：留空
   - 选择 `Saved to disk`
4. 保存为 `CodeyDeveloperID.certSigningRequest`

这台 Mac 会同时生成对应私钥。之后必须在同一台 Mac 上安装 `.cer` 并导出 `.p12`。

## 浏览器：创建 Developer ID Application 证书

Windows 或 Mac 浏览器都可以。

1. 打开 [Certificates](https://developer.apple.com/account/resources/certificates/list)
2. 点 `+`
3. 选择 `Developer ID Application`
4. Profile Type 选择 `G2 Sub-CA (Xcode 11.4.1 or later)`
5. 不要选择 `Previous Sub-CA`
6. `Choose File`，上传 `CodeyDeveloperID.certSigningRequest`
7. Continue，下载 `.cer`

不要选择这些类型：

- `Apple Development`
- `Apple Distribution`
- `Developer ID Installer`

GitHub Actions 使用 `macos-15`，应使用 G2 中间证书。`Previous Sub-CA` 是旧链，2022-02-01 之后签发的证书会在 2027-02-01 过期。

## Mac：安装证书并导出 .p12

1. 把下载的 `.cer` 拷到生成 CSR 的那台 Mac
2. 双击 `.cer`，安装到 `login` 钥匙串
3. 打开 Keychain Access → `login` → `My Certificates`
4. 找到 `Developer ID Application: … (TEAMID)`
5. 展开该项，确认下面有 `private key`
6. 右键点证书那一行，不要只点私钥
7. 选择 `Export…`
8. 格式选择 `Personal Information Exchange (.p12)`
9. 保存为 `DeveloperID.p12`
10. 设置导出密码，并单独记下来

如果看不到私钥，说明 `.cer` 没有装到生成 CSR 的那台 Mac。不要继续导出，回到生成 CSR 的 Mac 重做安装。

只拿到 `.cer` 不够。CI 需要带私钥的 `.p12`。

## 写入证书 Secrets

先确认 `gh` 登录的是 `happy-loki`：

```bash
gh auth status
```

推荐在 Mac 上直接写。把 `DeveloperID.p12` 放到当前目录后执行：

```bash
base64 -i DeveloperID.p12 -o certificate-base64.txt
gh secret set APPLE_CERTIFICATE --repo happy-loki/codey < certificate-base64.txt
gh secret set APPLE_CERTIFICATE_PASSWORD --repo happy-loki/codey
rm certificate-base64.txt
```

最后一条会等待粘贴 `.p12` 导出密码。

也可以把 `DeveloperID.p12` 拷回 Windows 再写：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("DeveloperID.p12")) |
  Set-Content -Encoding ascii -NoNewline certificate-base64.txt

Get-Content -Raw .\certificate-base64.txt |
  gh secret set APPLE_CERTIFICATE --repo happy-loki/codey

gh secret set APPLE_CERTIFICATE_PASSWORD --repo happy-loki/codey
```

写完后删除本地的 `certificate-base64.txt`。不要把这个文件或 `.p12` 提交到仓库。

## 浏览器：创建公证 API Key

这一步 Mac 或 Windows 都可以。

1. 打开 [App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
2. 进入 `Team Keys`
3. `Generate API Key`
4. 名称例如 `Codey Notarization`
5. Access 选择具备公证权限的角色，通常 `Developer` 或 `App Manager`
6. 记下 Key ID 和页面顶部的 Issuer ID
7. 下载 `AuthKey_<KEY_ID>.p8`

不要使用 APNs Auth Key。`.p8` 通常只能下载一次；丢失后需要撤销并重建。

Mac 上写入：

```bash
gh secret set APPLE_API_KEY --repo happy-loki/codey
gh secret set APPLE_API_ISSUER --repo happy-loki/codey
gh secret set APPLE_API_KEY_P8 --repo happy-loki/codey < AuthKey_XXXXXXXXXX.p8
```

Windows 上写入：

```powershell
gh secret set APPLE_API_KEY --repo happy-loki/codey
gh secret set APPLE_API_ISSUER --repo happy-loki/codey
Get-Content -Raw .\AuthKey_XXXXXXXXXX.p8 |
  gh secret set APPLE_API_KEY_P8 --repo happy-loki/codey
```

`APPLE_API_KEY` 填 Key ID。`APPLE_API_ISSUER` 填 Issuer ID。`APPLE_API_KEY_P8` 填 `.p8` 文件全文。workflow 会在 Runner 上写成临时文件并设置 `APPLE_API_KEY_PATH`。

## 备选：Apple ID 公证

只有不使用 API Key 时才配置这一组：

| Secret | 来源 | 填什么 |
| --- | --- | --- |
| `APPLE_ID` | Apple Developer / App Store Connect 登录邮箱 | 邮箱 |
| `APPLE_PASSWORD` | [App-Specific Passwords](https://account.apple.com/account/manage) | app-specific password，不是主密码 |
| `APPLE_TEAM_ID` | [Membership details](https://developer.apple.com/account) | 10 位 Team ID |

```powershell
gh secret set APPLE_ID --repo happy-loki/codey
gh secret set APPLE_PASSWORD --repo happy-loki/codey
gh secret set APPLE_TEAM_ID --repo happy-loki/codey
```

不要和 API Key 同时配置。

## 检查

只检查名称，不检查值：

```bash
gh secret list --repo happy-loki/codey
```

推荐配置完成后应看到：

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_API_KEY
APPLE_API_ISSUER
APPLE_API_KEY_P8
```

## 发布时才会用到

把 workflow 推到 `master` 后，打 `v*` 标签或手动运行 `release.yml`。macOS Release job 缺少证书或公证凭证时会失败。Windows Release 不读取这些 Apple secret。
