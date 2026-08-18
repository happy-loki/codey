import { writable } from "svelte/store";

export type ActiveFileInfo = {
    filename: string;
    path: string;
    fileType: string;
    language: string;
};

// 当前激活编辑器的 buffer 文本
export const activeDoc = writable<string>("");

// 当前激活编辑器的文件信息
export const activeInfo = writable<ActiveFileInfo | null>(null);
