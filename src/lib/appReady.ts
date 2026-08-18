import { derived, writable } from "svelte/store";

const settingsReady = writable(false);
const iframeWaiters = writable(0);

const iframeReady = derived(iframeWaiters, (pending) => pending === 0);

export const readinessState = derived(
    [settingsReady, iframeReady],
    ([$settingsReady, $iframeReady]) => ({
        settingsReady: $settingsReady,
        iframeReady: $iframeReady,
        ready: $settingsReady && $iframeReady
    })
);

export function markSettingsReady() {
    settingsReady.set(true);
}

export function requestIframeReady() {
    iframeWaiters.update((value) => value + 1);
}

export function markIframeReady() {
    iframeWaiters.update((value) => (value > 0 ? value - 1 : 0));
}
