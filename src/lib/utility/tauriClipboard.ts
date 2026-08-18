export function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

export async function readTextFromClipboardTauriOnly(): Promise<string> {
    if (!isTauriRuntime()) return "";
    try {
        const clip = await import("@tauri-apps/plugin-clipboard-manager");
        return (await clip.readText()) || "";
    } catch {
        return "";
    }
}

export async function writeTextToClipboardTauriOnly(text: string): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    try {
        const clip = await import("@tauri-apps/plugin-clipboard-manager");
        await clip.writeText(text);
        return true;
    } catch {
        return false;
    }
}
