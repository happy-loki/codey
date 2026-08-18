import { writable, get, type Writable } from "svelte/store";

export type ScrollSource = "editor" | "preview";

interface ScrollEvent {
  source: ScrollSource;
  ratio: number;
  token: number;
}

export const syncScrollEnabled: Writable<boolean> = writable(true);
export const syncScrollActive: Writable<boolean> = writable(false);

const scrollChannel = writable<ScrollEvent | null>(null);

let tokenCounter = 0;

export function setSyncScrollActive(active: boolean): void {
  syncScrollActive.set(active);
}

export function setSyncScrollEnabled(enabled: boolean): void {
  syncScrollEnabled.set(enabled);
}

export function emitScroll(source: ScrollSource, ratio: number): void {
  if (!get(syncScrollEnabled) || !get(syncScrollActive)) {
    return;
  }

  const clamped = clampRatio(ratio);
  scrollChannel.set({
    source,
    ratio: clamped,
    token: ++tokenCounter
  });
}

export function subscribeScroll(
  target: ScrollSource,
  handler: (ratio: number) => void
): () => void {
  return scrollChannel.subscribe((event) => {
    if (!event || event.source === target) {
      return;
    }
    handler(event.ratio);
  });
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

