import { writable } from "svelte/store";
import { Menu, type MenuItemOptions, type PredefinedMenuItemOptions } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

export type MenuItem =
  | {
        type?: "item";
        id?: string;
        name: string;
        disabled?: boolean;
        shortcut?: string;
        accelerator?: string;
        action: () => void;
    }
  | { type: "separator"; id?: string };

type State = { open: boolean; x: number; y: number; items: MenuItem[] };

const initialState: State = { open: false, x: 0, y: 0, items: [] };

export const contextMenuState = writable<State>(initialState);

const supportsNativeMenu = (() => {
    try {
        return typeof window !== "undefined" && isTauri();
    } catch {
        return false;
    }
})();

async function tryOpenNativeMenu(items: MenuItem[], x: number, y: number): Promise<boolean> {
    if (!supportsNativeMenu || !items.length) {
        return false;
    }

    try {
        const normalized = await Promise.all(items.map((item, index) => toNativeMenuItem(item, index)));
        const menu = await Menu.new({ items: normalized });
        const position = new LogicalPosition(x, y);
        const window = getCurrentWindow();
        await menu.popup(position, window);
        try {
            await menu.close();
        } catch {
            /* noop */
        }
        return true;
    } catch (error) {
        console.warn("Failed to open native context menu", error);
        return false;
    }
}

function toNativeMenuItem(item: MenuItem, index: number): MenuItemOptions | PredefinedMenuItemOptions {
    if (item.type === "separator") {
        return { item: "Separator" } satisfies PredefinedMenuItemOptions;
    }

    const action = () => {
        try {
            item.action();
        } catch (error) {
            console.error("Context menu action failed", error);
        }
    };

    const opts: MenuItemOptions = {
        id: item.id ?? `context-menu-item-${index}`,
        text: item.name,
        enabled: !item.disabled,
        action,
    };
    if (item.accelerator) {
        opts.accelerator = item.accelerator;
    }
    return opts;
}

export async function openContextMenu(items: MenuItem[], x: number, y: number) {
    const usedNative = await tryOpenNativeMenu(items, x, y);
    if (usedNative) {
        contextMenuState.set(initialState);
        return;
    }
    contextMenuState.set({ open: true, x, y, items });
}

export function closeContextMenu() {
    contextMenuState.update((state) => ({ ...state, open: false }));
}
