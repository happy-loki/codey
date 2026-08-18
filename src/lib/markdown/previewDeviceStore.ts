import { derived } from "svelte/store";

import {
  defaultStyleConfig,
  markdownWidthOptions,
  setStyleOption,
  styleConfig,
  type StyleConfig,
} from "./styleStore";

export type PreviewDevice = "pc" | "mobile";

const MOBILE_WIDTH = markdownWidthOptions[0]?.value ?? "w-[578px]";
const DESKTOP_WIDTH = markdownWidthOptions[1]?.value ?? "w-full";

function resolveWidth(config: StyleConfig | null | undefined): string {
  if (!config) return defaultStyleConfig.width ?? DESKTOP_WIDTH;
  return config.width ?? defaultStyleConfig.width ?? DESKTOP_WIDTH;
}

function widthToDevice(width: string): PreviewDevice {
  return width === MOBILE_WIDTH ? "mobile" : "pc";
}

const deviceStore = derived(styleConfig, ($config) => {
  const width = resolveWidth($config);
  return widthToDevice(width);
});

let currentDevice: PreviewDevice = widthToDevice(resolveWidth(defaultStyleConfig));

deviceStore.subscribe((value) => {
  currentDevice = value;
});

export const previewDevice = {
  subscribe: deviceStore.subscribe,
};

export function setPreviewDevice(device: PreviewDevice) {
  const targetWidth = device === "mobile" ? MOBILE_WIDTH : DESKTOP_WIDTH;
  setStyleOption("width", targetWidth as StyleConfig["width"]);
}

export function togglePreviewDevice() {
  const nextDevice: PreviewDevice = currentDevice === "pc" ? "mobile" : "pc";
  setPreviewDevice(nextDevice);
}
