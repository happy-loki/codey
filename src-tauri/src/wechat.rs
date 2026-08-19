use base64::engine::general_purpose::STANDARD as Base64;
use base64::Engine;
use blake3::Hasher;
use log::{debug, error};
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use thiserror::Error;
use tokio::fs as async_fs;
use url::Url;

mod draft;

use draft::{DraftAddRequest, DraftArticlePayload, DraftResponse, DraftUpdateRequest};

const TOKEN_ENDPOINT: &str = "https://api.weixin.qq.com/cgi-bin/token";
const DRAFT_ADD_ENDPOINT: &str = "https://api.weixin.qq.com/cgi-bin/draft/add";
const DRAFT_UPDATE_ENDPOINT: &str = "https://api.weixin.qq.com/cgi-bin/draft/update";
const MATERIAL_ADD_ENDPOINT: &str = "https://api.weixin.qq.com/cgi-bin/material/add_material";

const IMAGE_CACHE_DIR: &str = "wechat";
const IMAGE_CACHE_FILE: &str = "image-cache.json";
const IMAGE_CACHE_VERSION: u32 = 1;
const IMAGE_CACHE_TTL: Duration = Duration::from_secs(60 * 60 * 24 * 7);
const IMAGE_CACHE_LIMIT: usize = 512;
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

#[derive(Debug, Error)]
enum WeChatError {
    #[error("未找到配置文件")]
    MissingConfig,
    #[error("微信配置缺少 {0}")]
    MissingField(&'static str),
    #[error("{0}")]
    InvalidInput(String),
    #[error("图片处理失败: {message}")]
    ImageProcessing { message: String },
    #[error("图片读取失败（{origin}）: {reason}")]
    ImageRead { origin: String, reason: String },
    #[error("图片上传失败（{origin}）: {reason}")]
    ImageUpload { origin: String, reason: String },
    #[error("微信接口错误 {code}: {message}")]
    Api { code: i32, message: String },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
}

#[derive(Debug, Clone)]
struct WeChatConfig {
    app_id: String,
    app_secret: String,
    default_thumb_media_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredWeChatSettings {
    #[serde(default)]
    app_id: String,
    #[serde(default)]
    app_secret: String,
    #[serde(default)]
    default_thumb_media_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct AccessTokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    errcode: Option<i32>,
    errmsg: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishWeChatDraftArgs {
    pub title: String,
    pub content_html: String,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub thumb_media_id: Option<String>,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub media_id: Option<String>,
    #[serde(default)]
    pub item_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishWeChatDraftResult {
    pub media_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyWeChatResponse {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadWeChatThumbResult {
    pub media_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedImageCache {
    version: u32,
    entries: Vec<PersistedImageEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedImageEntry {
    hash: String,
    url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    media_id: Option<String>,
    updated_at: u64,
}

#[derive(Debug, Clone)]
struct CachedImageEntry {
    url: String,
    media_id: Option<String>,
    updated_at: SystemTime,
}

impl CachedImageEntry {
    fn is_expired(&self) -> bool {
        match self.updated_at.elapsed() {
            Ok(elapsed) => elapsed > IMAGE_CACHE_TTL,
            Err(_) => false,
        }
    }
}

struct ImageCache {
    path: PathBuf,
    entries: HashMap<String, CachedImageEntry>,
    dirty: bool,
}

impl ImageCache {
    fn load(app_handle: &AppHandle) -> Result<Self, WeChatError> {
        let dir = cache_directory(app_handle)?;
        if !dir.exists() {
            fs::create_dir_all(&dir)?;
        }
        let path = dir.join(IMAGE_CACHE_FILE);
        let mut entries = HashMap::new();

        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(contents) if !contents.trim().is_empty() => {
                    match serde_json::from_str::<PersistedImageCache>(&contents) {
                        Ok(persisted) if persisted.version == IMAGE_CACHE_VERSION => {
                            for entry in persisted.entries {
                                let updated_at = UNIX_EPOCH + Duration::from_secs(entry.updated_at);
                                entries.insert(
                                    entry.hash,
                                    CachedImageEntry {
                                        url: entry.url,
                                        media_id: entry.media_id,
                                        updated_at,
                                    },
                                );
                            }
                        }
                        Ok(_) => {
                            debug!("忽略不兼容的微信图片缓存版本");
                        }
                        Err(err) => {
                            error!("解析微信图片缓存失败: {err}");
                        }
                    }
                }
                Ok(_) => {}
                Err(err) => {
                    error!("读取微信图片缓存失败: {err}");
                }
            }
        }

        let mut cache = Self {
            path,
            entries,
            dirty: false,
        };
        cache.prune_expired();
        Ok(cache)
    }

    fn prune_expired(&mut self) {
        let initial = self.entries.len();
        self.entries.retain(|_, entry| !entry.is_expired());
        if self.entries.len() != initial {
            self.dirty = true;
        }
    }

    fn get(&mut self, hash: &str) -> Option<CachedImageEntry> {
        match self.entries.get(hash) {
            Some(entry) if !entry.is_expired() => Some(entry.clone()),
            Some(_) => {
                self.entries.remove(hash);
                self.dirty = true;
                None
            }
            None => None,
        }
    }

    fn insert(&mut self, hash: String, entry: CachedImageEntry) {
        if self.entries.len() >= IMAGE_CACHE_LIMIT {
            let mut items: Vec<_> = self
                .entries
                .iter()
                .map(|(key, value)| (key.clone(), value.updated_at))
                .collect();
            items.sort_by_key(|(_, ts)| *ts);
            for (old_hash, _) in items.into_iter().take(IMAGE_CACHE_LIMIT / 10 + 1) {
                self.entries.remove(&old_hash);
            }
        }
        self.entries.insert(hash, entry);
        self.dirty = true;
    }

    fn save(&mut self) -> Result<(), WeChatError> {
        if !self.dirty {
            return Ok(());
        }

        if let Some(parent) = self.path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
            }
        }

        let entries: Vec<PersistedImageEntry> = self
            .entries
            .iter()
            .map(|(hash, entry)| {
                let updated_at = entry
                    .updated_at
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                PersistedImageEntry {
                    hash: hash.clone(),
                    url: entry.url.clone(),
                    media_id: entry.media_id.clone(),
                    updated_at,
                }
            })
            .collect();

        let payload = PersistedImageCache {
            version: IMAGE_CACHE_VERSION,
            entries,
        };

        let serialized = serde_json::to_string_pretty(&payload)?;
        fs::write(&self.path, serialized)?;
        self.dirty = false;
        Ok(())
    }
}

struct LoadedImage {
    data: Vec<u8>,
    mime_hint: Option<String>,
    extension_hint: Option<String>,
    origin: String,
}

impl LoadedImage {
    fn len(&self) -> usize {
        self.data.len()
    }
}

async fn load_local_image(path: PathBuf) -> Result<LoadedImage, WeChatError> {
    let display = path.display().to_string();
    let metadata = async_fs::metadata(&path)
        .await
        .map_err(|err| WeChatError::ImageRead {
            origin: display.clone(),
            reason: err.to_string(),
        })?;

    if metadata.len() > MAX_IMAGE_SIZE {
        return Err(WeChatError::ImageProcessing {
            message: format!(
                "图片文件过大（{} 字节，最大 {} 字节）",
                metadata.len(),
                MAX_IMAGE_SIZE
            ),
        });
    }

    let data = async_fs::read(&path)
        .await
        .map_err(|err| WeChatError::ImageRead {
            origin: display.clone(),
            reason: err.to_string(),
        })?;

    let extension_hint = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_string());

    Ok(LoadedImage {
        data,
        mime_hint: None,
        extension_hint,
        origin: display,
    })
}

async fn load_image_bytes(
    src: &str,
    base_path: Option<&Path>,
    client: &reqwest::Client,
) -> Result<LoadedImage, WeChatError> {
    let trimmed = src.trim();
    if trimmed.is_empty() {
        return Err(WeChatError::ImageProcessing {
            message: "图片地址为空".to_string(),
        });
    }

    let mut current = trimmed.to_string();
    let mut hops = 0u8;

    loop {
        if current.starts_with("data:") {
            return parse_data_uri(&current);
        }

        if let Some(local_path) = resolve_local_path(&current, base_path) {
            return load_local_image(local_path).await;
        }

        if let Ok(url) = Url::parse(&current) {
            match url.scheme() {
                "http" | "https" => {
                    if let Some(host) = url.host_str() {
                        if host.ends_with(".localhost") || host.eq_ignore_ascii_case("localhost") {
                            if let Some(path) = decode_asset_like_url(&url) {
                                current = path.to_string_lossy().into_owned();
                                hops = hops.saturating_add(1);
                                if hops > 8 {
                                    return Err(WeChatError::ImageProcessing {
                                        message: format!("图片路径解析跳转过多：{current}"),
                                    });
                                }
                                continue;
                            }
                        }
                    }
                    return download_remote_image(&current, client).await;
                }
                "tauri" | "asset" => {
                    if let Some(path) = decode_asset_like_url(&url) {
                        current = path.to_string_lossy().into_owned();
                        hops = hops.saturating_add(1);
                        if hops > 8 {
                            return Err(WeChatError::ImageProcessing {
                                message: format!("图片路径解析跳转过多：{current}"),
                            });
                        }
                        continue;
                    }
                }
                _ => {}
            }
        }

        if let Some(base) = base_path {
            let candidate = base.join(&current);
            if candidate.exists() && candidate.is_file() {
                current = candidate.to_string_lossy().into_owned();
                hops = hops.saturating_add(1);
                if hops > 8 {
                    return Err(WeChatError::ImageProcessing {
                        message: format!("图片路径解析跳转过多：{current}"),
                    });
                }
                continue;
            }
        }

        return Err(WeChatError::ImageProcessing {
            message: format!("无法识别的图片路径：{current}"),
        });
    }
}

fn parse_data_uri(value: &str) -> Result<LoadedImage, WeChatError> {
    let (meta, data_part) = value
        .split_once(',')
        .ok_or_else(|| WeChatError::ImageProcessing {
            message: "data URI 缺少数据部分".to_string(),
        })?;

    let header = meta.trim_start_matches("data:");
    if !header.contains(";base64") {
        return Err(WeChatError::ImageProcessing {
            message: "暂不支持非 base64 的 data URI".to_string(),
        });
    }

    let mime = header
        .split(';')
        .next()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let data = Base64
        .decode(data_part.trim())
        .map_err(|err| WeChatError::ImageProcessing {
            message: format!("解析 data URI 失败: {err}"),
        })?;

    if data.is_empty() {
        return Err(WeChatError::ImageProcessing {
            message: "data URI 内容为空".to_string(),
        });
    }

    if data.len() as u64 > MAX_IMAGE_SIZE {
        return Err(WeChatError::ImageProcessing {
            message: format!(
                "data URI 图片过大（{} 字节，最大 {} 字节）",
                data.len(),
                MAX_IMAGE_SIZE
            ),
        });
    }

    Ok(LoadedImage {
        data,
        mime_hint: mime,
        extension_hint: None,
        origin: "data URI".to_string(),
    })
}

fn resolve_local_path(value: &str, base_path: Option<&Path>) -> Option<PathBuf> {
    if let Ok(url) = Url::parse(value) {
        match url.scheme() {
            "file" => url.to_file_path().ok(),
            "asset" | "tauri" => decode_asset_like_url(&url),
            "http" | "https" => {
                if let Some(host) = url.host_str() {
                    if host.ends_with(".localhost") || host.eq_ignore_ascii_case("localhost") {
                        return decode_asset_like_url(&url);
                    }
                }
                None
            }
            _ => None,
        }
    } else {
        let candidate = Path::new(value);
        if candidate.is_absolute() {
            Some(candidate.to_path_buf())
        } else {
            base_path.map(|base| base.join(candidate))
        }
    }
}

fn decode_asset_like_url(url: &Url) -> Option<PathBuf> {
    let mut raw_path = url.path();

    if raw_path.is_empty() {
        if let Some(host) = url.host_str() {
            raw_path = host;
        }
    }

    if raw_path.is_empty() {
        return None;
    }

    let decoded_once = percent_decode_str(raw_path)
        .decode_utf8()
        .ok()
        .map(|value| value.to_string())?;

    if decoded_once.is_empty() {
        return None;
    }

    let mut path_str = decoded_once;

    if let Some(stripped) = path_str.strip_prefix('/') {
        if looks_like_windows_path(stripped) {
            path_str = stripped.to_string();
        }
    }

    let mut iterations = 0usize;
    loop {
        let decoded_more = percent_decode_str(&path_str)
            .decode_utf8()
            .ok()
            .map(|value| value.to_string())
            .unwrap_or_else(|| path_str.clone());

        if decoded_more == path_str || iterations >= 4 {
            break;
        }

        path_str = decoded_more;
        iterations += 1;
    }

    Some(PathBuf::from(path_str))
}

fn looks_like_windows_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

async fn download_remote_image(
    url: &str,
    client: &reqwest::Client,
) -> Result<LoadedImage, WeChatError> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| WeChatError::ImageRead {
            origin: url.to_string(),
            reason: err.to_string(),
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(WeChatError::ImageRead {
            origin: url.to_string(),
            reason: format!("HTTP 状态码 {status}"),
        });
    }

    if let Some(len) = response.content_length() {
        if len > MAX_IMAGE_SIZE {
            return Err(WeChatError::ImageProcessing {
                message: format!("远程图片过大（{} 字节，最大 {} 字节）", len, MAX_IMAGE_SIZE),
            });
        }
    }

    let mime_hint = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());

    let bytes = response
        .bytes()
        .await
        .map_err(|err| WeChatError::ImageRead {
            origin: url.to_string(),
            reason: err.to_string(),
        })?;

    if bytes.len() as u64 > MAX_IMAGE_SIZE {
        return Err(WeChatError::ImageProcessing {
            message: format!(
                "远程图片过大（{} 字节，最大 {} 字节）",
                bytes.len(),
                MAX_IMAGE_SIZE
            ),
        });
    }

    let extension_hint = extension_from_path(url);

    Ok(LoadedImage {
        data: bytes.to_vec(),
        mime_hint,
        extension_hint,
        origin: url.to_string(),
    })
}

fn extension_from_path(value: &str) -> Option<String> {
    if let Ok(url) = Url::parse(value) {
        return extension_from_path(url.path());
    }

    let trimmed = value.split('?').next().unwrap_or(value);
    let trimmed = trimmed.split('#').next().unwrap_or(trimmed);
    Path::new(trimmed)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_string())
}

fn determine_image_extension(
    src: &str,
    image: &LoadedImage,
) -> Result<(String, String), WeChatError> {
    if let Some(ext) = image
        .extension_hint
        .as_deref()
        .and_then(normalize_extension)
    {
        let mime = extension_to_mime(ext).to_string();
        return Ok((ext.to_string(), mime));
    }

    if let Some(ext) = extension_from_path(src)
        .as_deref()
        .and_then(normalize_extension)
    {
        let mime = extension_to_mime(ext).to_string();
        return Ok((ext.to_string(), mime));
    }

    if let Some(mime_hint) = &image.mime_hint {
        if let Some(exts) = mime_guess::get_mime_extensions_str(mime_hint) {
            for ext in exts {
                if let Some(norm) = normalize_extension(ext) {
                    let mime = extension_to_mime(norm).to_string();
                    return Ok((norm.to_string(), mime));
                }
            }
        }
    }

    if let Some(kind) = infer::get(&image.data) {
        if let Some(norm) = normalize_extension(kind.extension()) {
            return Ok((norm.to_string(), kind.mime_type().to_string()));
        }
    }

    Err(WeChatError::ImageProcessing {
        message: format!("无法识别图片格式（来源：{}）", image.origin),
    })
}

fn normalize_extension(ext: &str) -> Option<&'static str> {
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "gif" => Some("gif"),
        "bmp" => Some("bmp"),
        "webp" => Some("webp"),
        _ => None,
    }
}

fn extension_to_mime(ext: &str) -> &'static str {
    match ext {
        "jpg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

async fn process_content_images(
    html: &str,
    base_path: Option<&Path>,
    client: &reqwest::Client,
    access_token: &str,
    cache: &mut ImageCache,
) -> Result<(String, usize), WeChatError> {
    let regex =
        Regex::new(r#"(?is)<img\b[^>]*\bsrc\s*=\s*["'](?P<src>[^"']+)["']"#).map_err(|err| {
            WeChatError::ImageProcessing {
                message: format!("构建图片匹配表达式失败: {err}"),
            }
        })?;

    let mut result = String::with_capacity(html.len());
    let mut cursor = 0usize;
    let mut replacements = 0usize;
    let mut cache_map: HashMap<String, String> = HashMap::new();

    for captures in regex.captures_iter(html) {
        let Some(src_match) = captures.name("src") else {
            continue;
        };

        let start = src_match.start();
        let end = src_match.end();

        result.push_str(&html[cursor..start]);

        let original_src = src_match.as_str();
        let new_src = if let Some(existing) = cache_map.get(original_src) {
            existing.clone()
        } else {
            let processed =
                process_single_image(original_src, base_path, client, access_token, cache).await?;
            cache_map.insert(original_src.to_string(), processed.clone());
            replacements += 1;
            processed
        };

        result.push_str(&new_src);
        cursor = end;
    }

    result.push_str(&html[cursor..]);

    Ok((result, replacements))
}

async fn process_single_image(
    src: &str,
    base_path: Option<&Path>,
    client: &reqwest::Client,
    access_token: &str,
    cache: &mut ImageCache,
) -> Result<String, WeChatError> {
    let image = load_image_bytes(src, base_path, client).await?;
    let (extension, mime) = determine_image_extension(src, &image)?;

    let mut hasher = Hasher::new();
    hasher.update(&image.data);
    let hash = hasher.finalize().to_hex().to_string();

    if let Some(entry) = cache.get(&hash) {
        debug!("命中图片缓存: {} -> {}", src, entry.url);
        return Ok(entry.url);
    }

    let filename = format!("{hash}.{extension}");
    debug!("上传正文图片: {} -> {}", src, filename);

    let response =
        upload_material_request(client, access_token, image.data, &filename, &mime, "image")
            .await?;

    let media_id = response
        .media_id
        .ok_or_else(|| WeChatError::MissingField("media_id"))?;
    let url = response
        .url
        .ok_or_else(|| WeChatError::MissingField("url"))?;

    cache.insert(
        hash,
        CachedImageEntry {
            url: url.clone(),
            media_id: Some(media_id),
            updated_at: SystemTime::now(),
        },
    );

    Ok(url)
}

async fn upload_material_request(
    client: &reqwest::Client,
    access_token: &str,
    data: Vec<u8>,
    filename: &str,
    mime: &str,
    material_type: &str,
) -> Result<MaterialUploadResponse, WeChatError> {
    let part = reqwest::multipart::Part::bytes(data)
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|err| WeChatError::ImageUpload {
            origin: filename.to_string(),
            reason: err.to_string(),
        })?;

    let form = reqwest::multipart::Form::new().part("media", part);

    let response = client
        .post(MATERIAL_ADD_ENDPOINT)
        .query(&[("access_token", access_token), ("type", material_type)])
        .multipart(form)
        .send()
        .await
        .map_err(|err| WeChatError::ImageUpload {
            origin: filename.to_string(),
            reason: err.to_string(),
        })?
        .error_for_status()
        .map_err(|err| WeChatError::ImageUpload {
            origin: filename.to_string(),
            reason: err.to_string(),
        })?;

    let body = response
        .text()
        .await
        .map_err(|err| WeChatError::ImageUpload {
            origin: filename.to_string(),
            reason: err.to_string(),
        })?;

    let parsed: MaterialUploadResponse =
        serde_json::from_str(&body).map_err(|err| WeChatError::ImageProcessing {
            message: format!("解析微信图片上传响应失败: {err}"),
        })?;

    if let Some(code) = parsed.errcode {
        if code != 0 {
            return Err(WeChatError::Api {
                code,
                message: parsed.errmsg.unwrap_or_else(|| "上传图片失败".to_string()),
            });
        }
    }

    Ok(parsed)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct MaterialUploadResponse {
    media_id: Option<String>,
    url: Option<String>,
    errcode: Option<i32>,
    errmsg: Option<String>,
}

fn friendly_error_message(err: &WeChatError) -> String {
    match err {
        WeChatError::Api { code, message } => {
            let detail = message.trim();
            let hint = wechat_error_hint(*code);
            match hint {
                Some(text) if detail.is_empty() => format!("{}（错误码 {}）", text, code),
                Some(text) => format!("{}（错误码 {}）。详情: {}", text, code, detail),
                None if detail.is_empty() => format!("微信接口返回错误 {code}"),
                None => format!("微信接口返回错误 {code}: {detail}"),
            }
        }
        WeChatError::MissingConfig => "未找到微信配置文件，请在设置中保存一次凭证".to_string(),
        WeChatError::MissingField(field) => {
            format!("微信配置缺少必要字段：{field}")
        }
        _ => err.to_string(),
    }
}

fn wechat_error_hint(code: i32) -> Option<&'static str> {
    Some(match code {
        0 => return None,
        -1 => "微信返回通用错误，请查看详细信息后重试",
        -2 => "用户已取消本次操作",
        -3 => "发送失败，请稍后重试",
        -4 => "授权失败，请重新尝试授权",
        -5 => "当前操作在微信端不受支持",
        -6 => "应用签名校验失败，请确认签名配置",
        26 => "用户拒绝了授权登录",
        10026 => "BundleID 与微信平台配置不一致，请检查配置",
        40001 => "微信凭证无效，请重新连接以刷新 access_token",
        40002 => "grant_type 无效，请重新发起授权",
        40003 => "openid 无效，请确认用户身份",
        40007 => "封面素材 media_id 无效，请重新上传封面",
        40008 => "消息类型无效，请检查请求参数",
        40009 => "图片尺寸超限，请检查图片大小",
        40012 => "缩略图尺寸超限，请检查封面尺寸",
        40013 => "AppID 无效，请确认公众号配置",
        40014 => "access_token 无效，请重新连接或刷新凭证",
        40029 | 40163 => "临时 code 已失效，请重新授权",
        40030 | 40032 | 42004 => "refresh_token 无效或已过期，请重新授权",
        40031 => "openid 列表无效，请重新授权",
        40036 => "模板 ID 长度无效，请检查参数",
        40037 => "模板 ID 无效，请检查参数",
        40039 => "URL 长度超限，请缩短链接",
        40066 => "URL 无效，请确认链接格式",
        40113 => "图片格式不支持",
        40097 => "接收者屏蔽了消息，请在微信客户端检查隐私设置",
        40164 => "请在微信公众平台添加IP白名单,改变IP白名单可能需要等待10分钟以上才生效",
        40180 => "临时 token 无效，请重新授权",
        41001 => "缺少 access_token，请重新连接验证",
        41002 => "缺少 AppID，请检查请求参数",
        41003 => "缺少 refresh_token，请重新授权",
        41004 => "缺少 AppSecret 或 AppKey，请检查配置",
        41006 => "缺少 media_id 参数，请确认上传封面",
        41008 => "缺少 code 参数，请重新授权",
        41009 => "缺少 openid 参数，请确认用户信息",
        41010 => "缺少 url 参数，请检查请求",
        42001 => "access_token 已过期，请重新连接验证",
        42003 => "code 已过期，请重新授权",
        42009 => "临时 token 已过期，请重新授权",
        43003 => "需要使用 HTTPS 协议",
        43004 => "需要关注关系才能调用",
        43005 => "需要互为好友才能调用",
        44002 => "请求体为空，请检查提交的数据",
        45003 => "标题长度超出限制，请缩短标题",
        45004 => "摘要内容超过限制，请缩短预览页首段或清空摘要",
        45005 => "URL 长度超出限制，请缩短链接",
        45009 | 45011 => "调用频率超出限制，请稍后重试",
        45013 => "模板参数过多，请精简模板配置",
        45014 => "模板消息体过大，请缩减内容",
        47001 => "数据格式错误，请检查 JSON 结构",
        48001 => "公众号未获得接口权限，请确认授权范围",
        _ => return None,
    })
}

fn normalize_string(input: Option<String>) -> Option<String> {
    input.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn create_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("codey-wechat-integration")
        .build()
        .map_err(|err| err.to_string())
}

async fn upload_thumb_media(
    client: &reqwest::Client,
    access_token: &str,
    file_path: &Path,
) -> Result<String, WeChatError> {
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| WeChatError::InvalidInput("无法识别封面文件名".to_string()))?;

    let data = async_fs::read(file_path).await?;
    if data.is_empty() {
        return Err(WeChatError::InvalidInput("封面文件为空".to_string()));
    }

    let mime = mime_guess::from_path(file_path).first_or_octet_stream();
    let response = upload_material_request(
        client,
        access_token,
        data,
        file_name,
        mime.as_ref(),
        "thumb",
    )
    .await?;

    if let Some(code) = response.errcode {
        if code != 0 {
            return Err(WeChatError::Api {
                code,
                message: response
                    .errmsg
                    .unwrap_or_else(|| "上传封面失败".to_string()),
            });
        }
    }

    let media_id = response
        .media_id
        .ok_or(WeChatError::MissingField("media_id"))?;

    Ok(media_id)
}

fn settings_path(app_handle: &AppHandle) -> Result<PathBuf, WeChatError> {
    app_handle
        .path()
        .app_local_data_dir()
        .map(|base| base.join("settings.json"))
        .map_err(|_| WeChatError::MissingConfig)
}

fn cache_directory(app_handle: &AppHandle) -> Result<PathBuf, WeChatError> {
    app_handle
        .path()
        .app_local_data_dir()
        .map(|base| base.join(IMAGE_CACHE_DIR))
        .map_err(|_| WeChatError::MissingConfig)
}

fn load_wechat_config(app_handle: &AppHandle) -> Result<Option<WeChatConfig>, WeChatError> {
    let path = settings_path(app_handle)?;
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)?;
    if contents.trim().is_empty() {
        return Ok(None);
    }

    let mut json: serde_json::Value = serde_json::from_str(&contents)?;
    let wechat_value = json
        .get_mut("wechat")
        .cloned()
        .or_else(|| json.pointer("/wechat").cloned());

    let Some(data) = wechat_value else {
        return Ok(None);
    };

    let stored: StoredWeChatSettings = serde_json::from_value(data)?;

    if stored.app_id.trim().is_empty() || stored.app_secret.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(WeChatConfig {
        app_id: stored.app_id.trim().to_string(),
        app_secret: stored.app_secret.trim().to_string(),
        default_thumb_media_id: normalize_string(stored.default_thumb_media_id),
    }))
}

async fn fetch_access_token(
    client: &reqwest::Client,
    config: &WeChatConfig,
) -> Result<String, WeChatError> {
    let response = client
        .get(TOKEN_ENDPOINT)
        .query(&[
            ("grant_type", "client_credential"),
            ("appid", config.app_id.as_str()),
            ("secret", config.app_secret.as_str()),
        ])
        .send()
        .await?
        .error_for_status()?;

    let parsed: AccessTokenResponse = response.json().await?;

    if let Some(errcode) = parsed.errcode {
        if errcode != 0 {
            return Err(WeChatError::Api {
                code: errcode,
                message: parsed
                    .errmsg
                    .unwrap_or_else(|| "获取 access_token 失败".to_string()),
            });
        }
    }

    let token = parsed
        .access_token
        .ok_or(WeChatError::MissingField("access_token"))?;

    Ok(token)
}

async fn send_draft_add_request(
    client: &reqwest::Client,
    access_token: &str,
    payload: &DraftAddRequest,
) -> Result<DraftResponse, WeChatError> {
    let response = client
        .post(DRAFT_ADD_ENDPOINT)
        .query(&[("access_token", access_token)])
        .json(payload)
        .send()
        .await?
        .error_for_status()?;

    let parsed: DraftResponse = response.json().await?;

    if let Some(code) = parsed.errcode {
        if code != 0 {
            return Err(WeChatError::Api {
                code,
                message: parsed.errmsg.unwrap_or_else(|| "创建草稿失败".to_string()),
            });
        }
    }

    Ok(parsed)
}

async fn send_draft_update_request(
    client: &reqwest::Client,
    access_token: &str,
    payload: &DraftUpdateRequest,
) -> Result<DraftResponse, WeChatError> {
    let response = client
        .post(DRAFT_UPDATE_ENDPOINT)
        .query(&[("access_token", access_token)])
        .json(payload)
        .send()
        .await?
        .error_for_status()?;

    let parsed: DraftResponse = response.json().await?;

    if let Some(code) = parsed.errcode {
        if code != 0 {
            return Err(WeChatError::Api {
                code,
                message: parsed.errmsg.unwrap_or_else(|| "更新草稿失败".to_string()),
            });
        }
    }

    Ok(parsed)
}

fn resolve_thumb_media_id(request_thumb: Option<String>, config: &WeChatConfig) -> Option<String> {
    normalize_string(request_thumb).or_else(|| config.default_thumb_media_id.clone())
}

#[tauri::command]
pub async fn publish_wechat_draft(
    app_handle: AppHandle,
    args: PublishWeChatDraftArgs,
) -> Result<PublishWeChatDraftResult, String> {
    let PublishWeChatDraftArgs {
        title,
        content_html,
        digest,
        thumb_media_id,
        source_path,
        author,
        media_id,
        item_id,
    } = args;

    if title.trim().is_empty() {
        return Err("标题不能为空".to_string());
    }
    if content_html.trim().is_empty() {
        return Err("内容不能为空".to_string());
    }

    let config = match load_wechat_config(&app_handle) {
        Ok(Some(value)) => value,
        Ok(None) => {
            return Err("未配置微信公众号信息".to_string());
        }
        Err(err) => {
            error!("读取微信配置失败: {err}");
            return Err(friendly_error_message(&err));
        }
    };

    let thumb_media_id = match resolve_thumb_media_id(thumb_media_id, &config) {
        Some(value) => value,
        None => return Err("缺少封面素材 thumb_media_id".to_string()),
    };

    let client = create_client()?;

    let token = match fetch_access_token(&client, &config).await {
        Ok(token) => token,
        Err(err) => {
            error!("获取 access_token 失败: {err}");
            return Err(friendly_error_message(&err));
        }
    };

    debug!("成功获取 access_token，有效长度: {}", token.len());

    let base_dir = source_path
        .as_deref()
        .map(PathBuf::from)
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));

    let mut image_cache = match ImageCache::load(&app_handle) {
        Ok(cache) => cache,
        Err(err) => {
            error!("加载微信图片缓存失败: {err}");
            return Err(friendly_error_message(&err));
        }
    };

    let (processed_html, replaced) = match process_content_images(
        &content_html,
        base_dir.as_deref(),
        &client,
        &token,
        &mut image_cache,
    )
    .await
    {
        Ok(result) => result,
        Err(err) => {
            error!("处理正文图片失败: {err}");
            return Err(friendly_error_message(&err));
        }
    };

    if let Err(err) = image_cache.save() {
        error!("保存微信图片缓存失败: {err}");
    }

    if replaced > 0 {
        debug!("成功上传并替换 {replaced} 张正文图片");
    } else {
        debug!("正文中未发现需要处理的图片");
    }

    let digest = normalize_string(digest);
    let author = normalize_string(author);

    let mut current_media_id = normalize_string(media_id);
    let mut current_item_id = item_id;

    let article = DraftArticlePayload {
        title: title.trim().to_string(),
        content: processed_html,
        thumb_media_id,
        digest,
        author,
        show_cover_pic: 1,
    };

    let response = if let Some(ref existing_id) = current_media_id.clone() {
        let payload = DraftUpdateRequest {
            media_id: existing_id.clone(),
            index: Some(0),
            articles: article.clone(),
        };
        match send_draft_update_request(&client, &token, &payload).await {
            Ok(mut resp) => {
                if resp.media_id.is_none() {
                    resp.media_id = Some(existing_id.clone());
                }
                if resp.item_id.is_none() {
                    resp.item_id = current_item_id;
                }
                resp
            }
            Err(err) => {
                error!("更新公众号草稿失败: {err}");
                return Err(friendly_error_message(&err));
            }
        }
    } else {
        let payload = DraftAddRequest {
            articles: vec![article],
        };
        match send_draft_add_request(&client, &token, &payload).await {
            Ok(resp) => resp,
            Err(err) => {
                error!("创建公众号草稿失败: {err}");
                return Err(friendly_error_message(&err));
            }
        }
    };

    if current_media_id.is_none() {
        current_media_id = response.media_id.clone();
    }
    if current_item_id.is_none() {
        current_item_id = response.item_id;
    }

    let final_media_id = current_media_id
        .or_else(|| response.media_id.clone())
        .ok_or_else(|| "未从微信接口获得 media_id".to_string())?;

    Ok(PublishWeChatDraftResult {
        media_id: final_media_id,
        item_id: current_item_id.or(response.item_id),
    })
}

#[tauri::command]
pub async fn verify_wechat_credentials(
    app_handle: AppHandle,
) -> Result<VerifyWeChatResponse, String> {
    let config = match load_wechat_config(&app_handle) {
        Ok(Some(cfg)) => cfg,
        Ok(None) => {
            return Err("未配置微信公众号信息".to_string());
        }
        Err(err) => {
            error!("读取微信配置失败: {err}");
            return Err(friendly_error_message(&err));
        }
    };

    let client = create_client()?;

    match fetch_access_token(&client, &config).await {
        Ok(_) => Ok(VerifyWeChatResponse {
            connected: true,
            message: None,
        }),
        Err(err) => {
            error!("微信凭证验证失败: {err}");
            Err(friendly_error_message(&err))
        }
    }
}

#[tauri::command]
pub async fn upload_wechat_thumb(
    app_handle: AppHandle,
    path: String,
) -> Result<UploadWeChatThumbResult, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.is_file() {
        return Err("封面文件不存在或不可访问".to_string());
    }

    let config = match load_wechat_config(&app_handle) {
        Ok(Some(cfg)) => cfg,
        Ok(None) => {
            return Err("未配置微信公众号信息".to_string());
        }
        Err(err) => {
            error!("读取微信配置失败: {err}");
            return Err(friendly_error_message(&err));
        }
    };

    let client = create_client()?;

    let token = match fetch_access_token(&client, &config).await {
        Ok(token) => token,
        Err(err) => {
            error!("获取 access_token 失败: {err}");
            return Err(friendly_error_message(&err));
        }
    };

    let media_id = match upload_thumb_media(&client, &token, file_path.as_path()).await {
        Ok(id) => id,
        Err(err) => {
            error!("上传封面素材失败: {err}");
            return Err(friendly_error_message(&err));
        }
    };

    Ok(UploadWeChatThumbResult { media_id })
}
