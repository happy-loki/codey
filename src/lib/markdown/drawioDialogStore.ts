import { writable } from "svelte/store";

export type DrawioDialogMode = "insert" | "edit";

export type DrawioDialogState = {
  open: boolean;
  mode: DrawioDialogMode;
  initialXml: string | null;
  requestId: number;
};

export type DrawioResult = {
  xmlData: string;
  base64: string;
};

type PendingResolver = ((value: DrawioResult | null) => void) | null;

const DEFAULT_STATE: DrawioDialogState = {
  open: false,
  mode: "insert",
  initialXml: null,
  requestId: 0,
};

export const drawioDialogState = writable<DrawioDialogState>(DEFAULT_STATE);

let resolver: PendingResolver = null;

export function openDrawioDialog(
  mode: DrawioDialogMode,
  options: { initialXml?: string | null } = {},
): Promise<DrawioResult | null> {
  if (resolver) {
    // 如果上一次对话框尚未关闭，直接拒绝新的请求，避免状态错乱
    return Promise.reject(new Error("draw 对话框仍在打开，请先完成当前操作"));
  }
  const requestId = Date.now();
  resolver = null;
  drawioDialogState.set({
    open: true,
    mode,
    initialXml: options.initialXml ?? null,
    requestId,
  });
  return new Promise<DrawioResult | null>((resolve) => {
    resolver = resolve;
  });
}

export function resolveDrawioDialog(result: DrawioResult | null): void {
  if (resolver) {
    resolver(result);
  }
  resolver = null;
  drawioDialogState.set(DEFAULT_STATE);
}
