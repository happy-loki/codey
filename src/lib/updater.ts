import { get, writable } from "svelte/store";
import { check } from "@tauri-apps/plugin-updater";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { addNotification, NotifType, Action, updateNotification } from "./Notifications/notifications";
import { updatesDisabled } from "./env";
import { t } from "./i18n";
import { getReleaseNotesSummary } from "./releaseNotes";

type UpdatePhase =
    | "idle"
    | "checking"
    | "available"
    | "upToDate"
    | "downloading"
    | "ready"
    | "restarting"
    | "error"
    | "disabled";

export type UpdateState = {
    phase: UpdatePhase;
    version?: string;
    notes?: string;
    error?: string;
    lastChecked?: string;
    progress?: number;
};

const initialState: UpdateState = { phase: updatesDisabled ? "disabled" : "idle" };

export const updaterState = writable<UpdateState>(initialState);

export type UpdatePreferences = {
    autoCheck: boolean;
    autoInstall: boolean;
};

const defaultPreferences: UpdatePreferences = {
    autoCheck: updatesDisabled ? false : true,
    autoInstall: updatesDisabled ? false : true
};

export const updaterPreferences = writable<UpdatePreferences>({ ...defaultPreferences });

export function setUpdatePreferences(next: Partial<UpdatePreferences> | UpdatePreferences) {
    const current = get(updaterPreferences);
    const merged: UpdatePreferences = {
        ...defaultPreferences,
        ...current,
        ...(next as Partial<UpdatePreferences>)
    };
    if (updatesDisabled) {
        merged.autoCheck = false;
        merged.autoInstall = false;
    } else {
        const enabled = Boolean(merged.autoCheck || merged.autoInstall);
        merged.autoCheck = enabled;
        merged.autoInstall = enabled;
    }
    updaterPreferences.set(merged);
}

export type UpdateAnnouncement = {
    version: string;
    notes?: string;
    storedAt?: number;
};

const UPDATE_ANNOUNCEMENT_KEY = "codey:updateAnnouncement";

function safeGetLocalStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSetLocalStorage(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {}
}

function safeRemoveLocalStorage(key: string) {
    try {
        localStorage.removeItem(key);
    } catch {}
}

function parseAnnouncement(raw: string | null): UpdateAnnouncement | null {
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.version !== "string") {
            return null;
        }
        const announcement: UpdateAnnouncement = {
            version: parsed.version,
            notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
            storedAt: typeof parsed.storedAt === "number" ? parsed.storedAt : undefined
        };
        return announcement;
    } catch {
        return null;
    }
}

export function rememberInstalledUpdate(version?: string, notes?: string) {
    if (!version) {
        return;
    }
    const trimmedNotes = typeof notes === "string" ? notes.trim() : "";
    const fallbackNotes = getReleaseNotesSummary(version, "en") ?? "";
    const payload: UpdateAnnouncement = {
        version,
        notes: trimmedNotes || fallbackNotes,
        storedAt: Date.now()
    };
    try {
        safeSetLocalStorage(UPDATE_ANNOUNCEMENT_KEY, JSON.stringify(payload));
    } catch {}
}

export function getPendingUpdateAnnouncement(): UpdateAnnouncement | null {
    return parseAnnouncement(safeGetLocalStorage(UPDATE_ANNOUNCEMENT_KEY));
}

export function clearPendingUpdateAnnouncement() {
    safeRemoveLocalStorage(UPDATE_ANNOUNCEMENT_KEY);
}

let availableVersion: string | undefined;
let availableNotes: string | undefined;
let pendingNotificationId: number | null = null;
let pendingUpdate: Update | null = null;
let downloadContentLength: number | undefined;
let downloadedBytes = 0;
let showDownloadProgressNotification = true;
let downloadedUpdateReady = false;

function getDownloadDetails(
    translate: (key: string, params?: Record<string, string | number>) => string,
    progress?: number
) {
    if (typeof progress === "number") {
        return translate("notifications.update.downloadingWithProgress", {
            progress: Math.round(progress)
        });
    }
    return translate("notifications.update.downloading");
}

function setNotification(
    phase: UpdatePhase,
    message: string,
    type: NotifType,
    actions: Action[] = [],
    details = ""
) {
    if (pendingNotificationId !== null) {
        updateNotification(pendingNotificationId, {
            title: message,
            message: details,
            type,
            actions
        });
        return;
    }
    pendingNotificationId = addNotification(type, message, actions, details);
}

export async function checkForUpdates(options: { silent?: boolean } = {}) {
    const { silent = false } = options;
    if (updatesDisabled) {
        pendingNotificationId = null;
        updaterState.set({ ...initialState });
        return;
    }
    updaterState.set({ ...initialState, phase: "checking" });
    pendingNotificationId = null;
    const translate = get(t);
    try {
        if (pendingUpdate) {
            try {
                await pendingUpdate.close();
            } catch (closeError) {
                console.warn("Failed to dispose previous update resource", closeError);
            }
            pendingUpdate = null;
        }

        const update = await check();
        const lastChecked = new Date().toISOString();
        if (update) {
            pendingUpdate = update;
            availableVersion = update.version;
            availableNotes = update.body ?? "";
            updaterState.set({
                phase: "available",
                version: availableVersion,
                notes: availableNotes,
                lastChecked
            });
            const prefs = get(updaterPreferences);
            if (prefs.autoInstall) {
                queueMicrotask(() => {
                    void downloadPendingUpdate({ showProgressNotification: false, suppressErrors: true });
                });
            } else {
                const actions = [
                    new Action(translate("notifications.actions.downloadNow"), () => {
                        void downloadPendingUpdate({ showProgressNotification: true });
                    })
                ];
                const title = availableVersion
                    ? translate("notifications.update.availableTitle", { version: availableVersion })
                    : translate("notifications.update.availableUnknownTitle");
                const details = availableNotes?.trim()
                    ? availableNotes
                    : translate("notifications.update.availableFallbackMessage");
                setNotification(
                    "available",
                    title,
                    NotifType.Message,
                    actions,
                    details
                );
            }
        } else {
            availableVersion = undefined;
            availableNotes = undefined;
            updaterState.set({
                phase: "upToDate",
                lastChecked
            });
            if (!silent) {
                addNotification(NotifType.Message, translate("notifications.update.upToDate"));
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updaterState.set({ phase: "error", error: message });
        if (!silent) {
            addNotification(NotifType.Error, translate("notifications.update.checkFailed"), [], message);
        }
    }
}

export async function downloadPendingUpdate(
    options: { showProgressNotification?: boolean; suppressErrors?: boolean } = {}
) {
    if (updatesDisabled) {
        return;
    }
    const translate = get(t);
    showDownloadProgressNotification = options.showProgressNotification ?? true;
    const suppressErrors = options.suppressErrors ?? false;
    updaterState.update((current) => ({
        ...current,
        phase: "downloading",
        progress: undefined
    }));
    downloadedUpdateReady = false;
    if (showDownloadProgressNotification) {
        setNotification(
            "downloading",
            translate("notifications.update.downloadingTitle"),
            NotifType.Message,
            [],
            getDownloadDetails(translate)
        );
    }
    try {
        if (!pendingUpdate) {
            throw new Error("No update is available to install");
        }

        downloadContentLength = undefined;
        downloadedBytes = 0;

        await pendingUpdate.download((event: DownloadEvent) => {
            if (event.event === "Started") {
                downloadContentLength = event.data.contentLength;
                downloadedBytes = 0;
                updaterState.update((current) => ({
                    ...current,
                    phase: "downloading",
                    progress: downloadContentLength ? 0 : undefined
                }));
                if (showDownloadProgressNotification) {
                    setNotification(
                        "downloading",
                        translate("notifications.update.downloadingTitle"),
                        NotifType.Message,
                        [],
                        getDownloadDetails(translate, downloadContentLength ? 0 : undefined)
                    );
                }
            } else if (event.event === "Progress") {
                downloadedBytes += event.data.chunkLength;
                if (downloadContentLength && downloadContentLength > 0) {
                    const percent = Math.min((downloadedBytes / downloadContentLength) * 100, 100);
                    updaterState.update((current) => ({
                        ...current,
                        phase: "downloading",
                        progress: percent
                    }));
                    if (showDownloadProgressNotification) {
                        setNotification(
                            "downloading",
                            translate("notifications.update.downloadingTitle"),
                            NotifType.Message,
                            [],
                            getDownloadDetails(translate, percent)
                        );
                    }
                } else {
                    updaterState.update((current) => ({
                        ...current,
                        phase: "downloading",
                        progress: undefined
                    }));
                    if (showDownloadProgressNotification) {
                        setNotification(
                            "downloading",
                            translate("notifications.update.downloadingTitle"),
                            NotifType.Message,
                            [],
                            getDownloadDetails(translate)
                        );
                    }
                }
            } else if (event.event === "Finished") {
                updaterState.update((current) => ({
                    ...current,
                    phase: "downloading",
                    progress: 100
                }));
                if (showDownloadProgressNotification) {
                    setNotification(
                        "downloading",
                        translate("notifications.update.downloadingTitle"),
                        NotifType.Message,
                        [],
                        getDownloadDetails(translate, 100)
                    );
                }
            }
        });

        downloadedUpdateReady = true;
        updaterState.update((current) => ({
            ...current,
            phase: "ready"
        }));
        rememberInstalledUpdate(availableVersion, availableNotes);
        const actions = [
            new Action(translate("notifications.actions.restartNow"), () => {
                void restartToApplyUpdate();
            })
        ];
        const title = availableVersion
            ? translate("notifications.update.readyTitle", { version: availableVersion })
            : translate("notifications.update.availableUnknownTitle");
        setNotification(
            "ready",
            title,
            NotifType.Message,
            actions,
            translate("notifications.update.restartReminder")
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (suppressErrors) {
            console.warn("Background update download failed", message);
            updaterState.set({
                phase: "idle",
                lastChecked: new Date().toISOString()
            });
            pendingNotificationId = null;
            return;
        }
        updaterState.set({
            phase: "error",
            version: availableVersion,
            error: message
        });
        addNotification(NotifType.Error, translate("notifications.update.installFailed"), [], message);
    } finally {
        showDownloadProgressNotification = true;
    }
}

export async function restartToApplyUpdate() {
    if (updatesDisabled) {
        updaterState.set(initialState);
        return;
    }
    const translate = get(t);
    rememberInstalledUpdate(availableVersion, availableNotes);
    updaterState.update((current) => ({
        ...current,
        phase: "restarting"
    }));
    try {
        if (!pendingUpdate || !downloadedUpdateReady) {
            throw new Error("No downloaded update is ready to install");
        }
        await pendingUpdate.install();
        try {
            await pendingUpdate.close();
        } catch (closeError) {
            console.warn("Failed to dispose update resource", closeError);
        }
        pendingUpdate = null;
        downloadedUpdateReady = false;
        await relaunch();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updaterState.set({
            phase: "error",
            version: availableVersion,
            error: message
        });
        addNotification(NotifType.Error, translate("notifications.update.restartFailed"), [], message);
    }
}

export function resetUpdater() {
    pendingNotificationId = null;
    pendingUpdate = null;
    downloadContentLength = undefined;
    downloadedBytes = 0;
    downloadedUpdateReady = false;
    updaterState.set(initialState);
}

export function getUpdatePreferences(): UpdatePreferences {
    return get(updaterPreferences);
}
