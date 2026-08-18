import { invoke } from "@tauri-apps/api/core";

export async function syncHostBridgeTabs(
  paths: string[], 
  active: string | null, 
  reason: string,
  cursorLine?: number,
  cursorColumn?: number
) {
  const hasFiles = Array.isArray(paths) && paths.length > 0;
  const hasActive = typeof active === 'string' && active.length > 0;
  // 如果没有任何文件型 Tab，且没有活动文件，静默跳过同步（例如打开 Settings、Welcome 等非文件页）
  if (!hasFiles && !hasActive) {
    return;
  }

  try {
    await invoke('hostbridge_update_tabs', { 
      paths, 
      active,
      cursorLine: cursorLine ?? null,
      cursorColumn: cursorColumn ?? null,
    });
  } catch (err) {
    console.warn('[HostBridge/UI] sync failed', reason, err);
  }
}
