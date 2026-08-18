import {  path as p } from "@tauri-apps/api";
import { sep as sepFunc } from "@tauri-apps/api/path";
const sep = sepFunc();
import { exists } from '@tauri-apps/plugin-fs';
import { openInputModal, openRenameModal } from "../App.svelte";
import { openSearchPopup } from "../lib/searchPopupStore";
import { closeAllTabs, closeOtherTabs, closeTabsToLeft, closeTabsToRight } from "../lib/EditorTabList.svelte";
import { saveFile, openFile, openFolderDialog, openInExplorer, renameFile, createFolder, createFile, revealInTreeView, createTimestampedNewFile } from "../lib/File";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
// import { info, warn } from "tauri-plugin-log-api";
import { info, warn } from '@tauri-apps/plugin-log';
import { fitTerminal } from "../lib/Terminal.svelte";
import { getActiveInstance, writeActive } from "../lib/terminalRegistry";
import { requestAddTerminal } from "../lib/terminalBus";
import { exit } from '@tauri-apps/plugin-process';
import { get } from "svelte/store";
import { t } from "../lib/i18n";
import { addAttachment } from "../lib/codex/composerStore";
import type { UserInput } from "../lib/codex/types";

export const commands = {
    "addEditorTab": {
        "keybind": "Control+N",
        "command": async () => {
            await createTimestampedNewFile();
        }
    },
    "openFile": {
        "keybind": "Control+O",
        "command": async () => {
            await openFile();
        }
    },
    "openFolder": {
        "keybind": "Control+K",
        "command": async () => {
            await openFolderDialog();
        }
    },
    "saveFile": {
        "keybind": "Control+S",
        "command": async () => {
            await saveFile();
        }
    },
    "saveFileAs": {
        "keybind": "Control+Shift+S",
        "command": async () => {
            await saveFile(true);
        }
    },
    "undo": {
        "keybind": "Control+Z",
        "disabled": "true",
        "command": async () => {
            //
        }
    },
    "redo": {
        "keybind": "Control+Shift+Z",
        "disabled": "true",
        "command": async () => {
            //
        }
    },
    "cut": {
        "keybind": "Control+X",
        "disabled": "true",
        "command": async () => {
            //
        }
    },
    "copy": {
        "keybind": "Control+C",
        "disabled": "true",
        "command": async () => {
            //
        }
    },
    "paste": {
        "keybind": "Control+V",
        "disabled": "true",
        "command": async () => {
            //
        }
    },
    "pasteFromHistory": {
        "keybind": "Control+Shift+V",
        "disabled": "true",
        "command": () => {
            //
        }
    },
    "delete": {
        "keybind": "Delete",
        "command": async () => {
            return;
        }
    },
    "find": {
        "keybind": "Control+F",
        "disabled": "true",
        "command": () => {
            //
        }
    },
     "searchInWorkspace": {
         "keybind": "Control+Shift+F",
         "command": async () => {
             // 仅打开统一的 SearchPopup，由其内部负责在终端执行搜索
             openSearchPopup();
         }
     },
    "suppressBrowserFind": {
        "keybind": "Control+F",
        "command": async () => {
            // No-op：阻止 WebView2 弹出 Ctrl+F 查找条；未来可在此挂接全局查找。
        }
    },
    "suppressBrowserFindPrevious": {
        "keybind": "Control+Shift+G",
        "command": async () => {
            // No-op：阻止 WebView2 的“查找上一个”快捷键。
        }
    },
     "replace": {
         "keybind": "Control+H",
         "disabled": "true",
         "command": () => {
             //
        }
    },
    "openCommandPallete": {
        "keybind": "Control+Shift+P",
        "disabled": "true",
        "command": () => {
            //
        }
    },
    "zoomIn": {
        "keybind": "Control +",
        "disabled": "true",
        "command": () => {
            //
        }
    },
    "zoomOut": {
        "keybind": "Control -",
        "disabled": "true",
        "command": () => {
            //
        }
    },
    "fullscreen": {
        "keybind": "F11",
        //"disabled": "true",
        "command": async () => {
            const win = getCurrentWebviewWindow();
            try {
                const isFullscreen = await win.isFullscreen();
                await win.setFullscreen(!isFullscreen);
            } catch (err) {
                warn(`Failed to toggle fullscreen: ${err}`, {file: "commands.ts", line: 128});
            }
            fitTerminal();
        }
    },
    "runFile": {
        "keybind": "F5",
        "disabled": "true",
        "command": () => {
            //
        }
    },
    "debugFile": {
        "keybind": "Control+F5",
        "disabled": "true",
        "command": () => {
            //
        }
    },
    "stopFile": {
        "keybind": "Shift+F5",
        "disabled": "true",
        "command": () => {
            //
        }
    },
    "openNewWindow": {
        "keybind": "Control+Shift+N",
        "disabled": "true",
        "command": () => {
            //
        }
    },
    "minimizeWindow": {
        "keybind": "",
        "command": () => {
            getCurrentWebviewWindow().minimize()
        }
    },
    "maximizeWindow": {
        "keybind": "",
        "command": async () => {
            const win = getCurrentWebviewWindow();
            try {
                if (await win.isFullscreen()) {
                    return;
                }
                if (await win.isMaximized()) {
                    await win.unmaximize();
                }
                else {
                    await win.maximize();
                }
            } catch (err) {
                warn(`Failed to toggle maximize state: ${err}`, {file: "commands.ts", line: 178});
            }
            fitTerminal();
        }
    },
    "closeWindow": {
        "keybind": "Alt+F4",
        "command": async () => {
            await exit();
        }
    },
    "closeTab": {
        // Use Control/Command+W cross-platform for closing the active tab.
        "keybind": "Control+W",
        "command": async () => {
            const { closeActiveTab } = await import("../lib/EditorTabList.svelte");
            await closeActiveTab();
        }
    },
    "closeAllTabs": {
        "keybind": "",
        "command": () => {
            closeAllTabs();
        }
    },
    "closeOtherTabs": {
        "keybind": "",
        "command": async (tabid: number) => {
            if (typeof tabid !== "number") {
                return;
            }
            await closeOtherTabs(tabid);
        }
    },
    "closeTabsToLeft": {
        "keybind": "",
        "command": async (tabid: number) => {
            if (typeof tabid !== "number") {
                return;
            }
            await closeTabsToLeft(tabid);
        }
    },
    "closeTabsToRight": {
        "keybind": "",
        "command": async (tabid: number) => {
            if (typeof tabid !== "number") {
                return;
            }
            await closeTabsToRight(tabid);
        }
    },
    "renameFile": {
        "keybind": "F2",
        "command": async (filename, oldpath) => {
            if (!await exists(oldpath)) {
                warn(`Unable to rename file. ${oldpath} does not exist.`, {file: "commands.ts", line: 193});
                return;
            }
            openRenameModal(`Rename ${filename}`,
                `Give a new name to ${filename}`, 
                [
                    {name: "Rename", action: async (name) => {await renameFile(name, oldpath)}},
                    {name: "Cancel", cancel: true, style: "danger", action: () => {}}
                ],
                oldpath
            )
        }
    },
    "createFolder": {
        "keybind": "",
        "command": (path) => {
            const translate = get(t);
            const basePath = typeof path === "string" ? path : "";
            const descriptionKey = basePath ? "dialogs.createFolder.descriptionWithPath" : "dialogs.createFolder.description";
            const description = translate(descriptionKey, { path: basePath });
            openInputModal(
                translate("dialogs.createFolder.title"),
                description,
                [
                    { name: translate("dialogs.createFolder.confirm"), action: async (name) => { await createFolder(`${basePath}${sep}${name}`); } },
                    { name: translate("dialogs.createFolder.cancel"), cancel: true, action: () => {} }
                ],
                { label: translate("dialogs.createFolder.label"), placeholder: translate("dialogs.createFolder.placeholder") },
                basePath
            )
        }
    },
    "createFile": {
        "keybind": "",
        "command": (path) => {
            const translate = get(t);
            const basePath = typeof path === "string" ? path : "";
            const descriptionKey = basePath ? "dialogs.createFile.descriptionWithPath" : "dialogs.createFile.description";
            const description = translate(descriptionKey, { path: basePath });
            openInputModal(
                translate("dialogs.createFile.title"),
                description,
                [
                    { name: translate("dialogs.createFile.confirm"), action: (name) => { createFile(`${basePath}${sep}${name}`); } },
                    { name: translate("dialogs.createFile.cancel"), cancel: true, action: () => {} }
                ],
                { label: translate("dialogs.createFile.label"), placeholder: translate("dialogs.createFile.placeholder") },
                basePath
            )
        }
    },
    "openInExplorer": {
        "keybind": "",
        "command": async (path) => {
            if (!await exists(path)) return;
            openInExplorer(path);
        }
    },
    "revealInExplorerView": {
        "keybind": "",
        "command": async (path?: string) => {
            if (typeof path !== "string" || path.trim() === "") {
                return;
            }
            await revealInTreeView(path);
        }
    },
    "addToAIChat": {
        "keybind": "",
        "command": async (
            selectedText: string,
            filePath: string,
            language: string,
            startLine: number,
            endLine: number
        ) => {
            const safeLanguage = (language || "").trim();
            const normalizedLanguage = safeLanguage || "text";
            const labelPath = (filePath || "").trim();
            const filename =
                labelPath.split(/[\\/]/).filter(Boolean).pop() || labelPath || "snippet";
            const rangeLabel =
                startLine && endLine && startLine !== endLine
                    ? `${startLine}:${endLine}`
                    : startLine
                    ? `${startLine}`
                    : "";

            const label = rangeLabel ? `${filename} ${rangeLabel}` : filename;

            const fencedLines: string[] = [];
            fencedLines.push(`File: ${filePath || filename}${rangeLabel ? ` (lines ${rangeLabel})` : ""}`);
            fencedLines.push("```" + normalizedLanguage);
            fencedLines.push(selectedText ?? "");
            fencedLines.push("```");

            const input: UserInput = {
                type: "text",
                text: fencedLines.join("\n"),
            } as UserInput;

            addAttachment({
                id: (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
                kind: "snippet",
                label,
                input,
                iconKind: "file",
                iconFilename: filename,
            });
        }
    }
}

export function registerCommand(name: string, keybind: string, command: () => void) {
    if (commands[name]) {
        info(`Command "${name}" already exists, skipping...`, {file: "commands.ts", line: 214});
        return;
    }
    commands[name] = { "keybind": keybind, "command": command }
}

let keybinds = []
export function getKeybinds() {
    for (const value of Object.values(commands)) {
        if (!keybinds.includes(value)) {
            keybinds = [...keybinds, value];
        }
    }
    return keybinds;
}
