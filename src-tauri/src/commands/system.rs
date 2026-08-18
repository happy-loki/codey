use font_kit::source::SystemSource;
use gif::{Encoder, Frame, Repeat};
use log::warn;
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::Options as UsvgOptions;
use serde::Deserialize;
use std::env;
use std::fs::File;
use std::io::Write;
use std::process::Command;
use std::sync::Arc;
use tokio::task;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifFrameInput {
    pub svg: String,
    pub delay_ms: u32,
}

#[tauri::command]
pub fn open_in_default(path: &str) {
    if env::consts::OS == "windows" {
        if let Err(err) = Command::new("powershell").args(["&", path]).spawn() {
            warn!("Failed to open path via powershell: {}", err);
        }
    }
}

#[tauri::command]
pub fn open_terminal(path: &str) {
    if env::consts::OS == "windows" {
        let _ = Command::new("cmd").args(["/C", "wt", "-d", path]).spawn();
    } else {
        let arg = format!("--working-directory={}", path);
        let _ = Command::new("gnome-terminal").arg(arg).spawn();
    }
}

#[tauri::command]
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".into());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", trimmed])
            .spawn()
            .map_err(|err| format!("Failed to reveal in Finder: {}", err))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", trimmed])
            .spawn()
            .map_err(|err| format!("Failed to reveal in Explorer: {}", err))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let target = std::path::Path::new(trimmed)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(trimmed);
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|err| format!("Failed to open file manager: {}", err))?;
        return Ok(());
    }
}

#[tauri::command]
pub async fn export_animation_gif(
    path: String,
    width: u32,
    height: u32,
    frames: Vec<GifFrameInput>,
    should_loop: Option<bool>,
) -> Result<(), String> {
    if frames.is_empty() {
        return Err("没有可导出的帧".into());
    }
    if width == 0 || height == 0 {
        return Err("GIF 尺寸无效".into());
    }
    let should_loop = should_loop.unwrap_or(true);
    let job =
        task::spawn_blocking(move || render_gif_to_path(path, width, height, frames, should_loop));
    match job.await {
        Ok(inner) => inner,
        Err(err) => Err(format!("GIF 导出任务失败: {}", err)),
    }
}

#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<String>, String> {
    let source = SystemSource::new();
    let mut families = source
        .all_families()
        .map_err(|e| format!("Failed to enumerate fonts: {}", e))?;
    families.retain(|name| !name.trim().is_empty());
    families.sort_unstable_by(|a, b| {
        let a_lower = a.to_lowercase();
        let b_lower = b.to_lowercase();
        match a_lower.cmp(&b_lower) {
            std::cmp::Ordering::Equal => a.cmp(b),
            other => other,
        }
    });
    families.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    Ok(families)
}

fn render_gif_to_path(
    path: String,
    width: u32,
    height: u32,
    frames: Vec<GifFrameInput>,
    should_loop: bool,
) -> Result<(), String> {
    let gif_width = u16::try_from(width).map_err(|_| "GIF 宽度超出限制")?;
    let gif_height = u16::try_from(height).map_err(|_| "GIF 高度超出限制")?;

    let mut opts = UsvgOptions::default();
    if let Some(db) = Arc::get_mut(&mut opts.fontdb) {
        db.load_system_fonts();
    }
    let opts = Arc::new(opts);

    let rendered_frames: Vec<(usize, Vec<u8>, u16)> = frames
        .into_iter()
        .enumerate()
        .map(|(index, frame)| {
            let opts_clone = Arc::clone(&opts);
            let svg = frame.svg.clone();
            let delay_ms = frame.delay_ms;
            std::thread::spawn(move || {
                let pixels = render_svg_frame(&svg, width, height, &opts_clone)
                    .map_err(|err| format!("帧 {} 渲染失败: {}", index + 1, err))?;
                let delay = (delay_ms.max(20) / 10) as u16;
                Ok::<_, String>((index, pixels, delay.max(1)))
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Result<Vec<_>, String>>()?;

    let mut file =
        File::create(&path).map_err(|err| format!("无法创建导出文件 {}: {}", path, err))?;
    let mut encoder = Encoder::new(&mut file, gif_width, gif_height, &[])
        .map_err(|err| format!("无法初始化 GIF 编码器: {}", err))?;
    if should_loop {
        encoder
            .set_repeat(Repeat::Infinite)
            .map_err(|err| format!("无法设置 GIF 循环: {}", err))?;
    }

    for (index, mut pixels, delay) in rendered_frames {
        let mut gif_frame =
            Frame::from_rgba_speed(gif_width, gif_height, pixels.as_mut_slice(), 10);
        gif_frame.delay = delay;
        encoder
            .write_frame(&gif_frame)
            .map_err(|err| format!("写入 GIF 帧 {} 失败: {}", index + 1, err))?;
    }

    drop(encoder);
    file.flush()
        .map_err(|err| format!("写入 GIF 文件失败: {}", err))?;
    Ok(())
}

fn render_svg_frame(
    svg: &str,
    width: u32,
    height: u32,
    opts: &UsvgOptions,
) -> Result<Vec<u8>, String> {
    let tree =
        resvg::usvg::Tree::from_str(svg, opts).map_err(|err| format!("SVG 解析失败: {}", err))?;
    let mut pixmap = Pixmap::new(width, height).ok_or_else(|| "无法创建像素缓冲".to_string())?;

    let svg_size = tree.size();
    let scale_x = width as f32 / svg_size.width();
    let scale_y = height as f32 / svg_size.height();
    let scale = scale_x.min(scale_y);

    let scaled_width = svg_size.width() * scale;
    let scaled_height = svg_size.height() * scale;
    let offset_x = (width as f32 - scaled_width) / 2.0;
    let offset_y = (height as f32 - scaled_height) / 2.0;

    let transform = Transform::from_row(scale, 0.0, 0.0, scale, offset_x, offset_y);
    let mut canvas = pixmap.as_mut();
    resvg::render(&tree, transform, &mut canvas);
    Ok(pixmap.take())
}
