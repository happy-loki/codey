const LAST_VERSION_KEY = "arthas:lastVersion";
const PENDING_VERSION_KEY = "arthas:pendingUpdateVersion";
const PENDING_NOTES_KEY = "arthas:pendingUpdateNotes";

export type PendingChangelog = {
    version: string;
    notes?: string;
};

function safeGet(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSet(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* noop */
    }
}

function safeRemove(key: string) {
    try {
        localStorage.removeItem(key);
    } catch {
        /* noop */
    }
}

export function getLastSeenVersion(): string | null {
    return safeGet(LAST_VERSION_KEY);
}

export function setLastSeenVersion(version: string) {
    safeSet(LAST_VERSION_KEY, version);
}

export function setPendingChangelog(entry: PendingChangelog | null) {
    if (!entry || !entry.version) {
        safeRemove(PENDING_VERSION_KEY);
        safeRemove(PENDING_NOTES_KEY);
        return;
    }
    safeSet(PENDING_VERSION_KEY, entry.version);
    if (entry.notes && entry.notes.trim().length > 0) {
        safeSet(PENDING_NOTES_KEY, entry.notes);
    } else {
        safeRemove(PENDING_NOTES_KEY);
    }
}

export function getPendingChangelog(): PendingChangelog | null {
    const version = safeGet(PENDING_VERSION_KEY);
    if (!version) {
        return null;
    }
    const notes = safeGet(PENDING_NOTES_KEY) ?? undefined;
    return { version, notes };
}
