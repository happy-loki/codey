import { writable } from "svelte/store";

export enum NotifType {
    Message,
    Warning,
    Error,
    Success
}
class Notification {
    id;
    type: string;
    title: string;
    message: string;
    read: boolean;
    actions;
    persistKey?: string;
    constructor(title, type, read = false, message = "", actions = [], persistKey?: string) {
        this.title = title;
        this.message = message;
        this.type = getType(type);
        this.read = read;
        this.actions = actions;
        this.persistKey = persistKey;
    }
}
class ToastNotification extends Notification {
    constructor(title, type, message = "", actions = [], persistKey?: string) {
        super(title, type, false, message, actions, persistKey);
    }
}
export class Action {
    label: string;
    action: () => void | null;
    constructor(label, action: () => void | null = null) {
        this.label = label;
        this.action = action;
    }
}

const actions = [
    new Action(" Test Message", () => {
        addNotification(NotifType.Message, "Message notification success");
    }),
    new Action("Test Warning", () => {
        addNotification(NotifType.Warning, "Warning notification success");
    }),
    new Action("Test Error", () => {
        addNotification(NotifType.Error, "Failure or something idk");
    })
]

let id = 0;
export const unreadnotifications = writable(false);
export const notifications = writable([]);
export const toasts = writable([]);
let notificationlist: Notification[] = [];
let toastlist: ToastNotification[] = [];

const READ_STORAGE_PREFIX = "arthas:notifications:read:";

function getReadStorageKey(key: string) {
    return `${READ_STORAGE_PREFIX}${key}`;
}

function hasPersistedRead(key: string): boolean {
    try {
        return localStorage.getItem(getReadStorageKey(key)) === "true";
    } catch {
        return false;
    }
}

function persistReadState(key: string, read: boolean) {
    try {
        const storageKey = getReadStorageKey(key);
        if (read) {
            localStorage.setItem(storageKey, "true");
        } else {
            localStorage.removeItem(storageKey);
        }
    } catch {
        // Ignore storage errors (e.g., storage disabled)
    }
}

export function addNotification(type: NotifType, title: string, actions: Action[] = [], message = "", persistKey?: string): number | null {
    if (persistKey && hasPersistedRead(persistKey)) {
        return null;
    }
    const notifId = id;
    const notification = new Notification(title, type, false, message, actions, persistKey);
    const toast = new ToastNotification(title, type, message, actions, persistKey);
    notification.id = notifId;
    toast.id = notifId;
    notificationlist = [...notificationlist, notification];
    toastlist = [...toastlist, toast];
    notifications.set(notificationlist);
    toasts.set(toastlist);
    updateNotificationStatus();
    id++;
    return notifId;
}

export function updateNotification(idToUpdate: number, options: { title?: string; message?: string; type?: NotifType; actions?: Action[]; append?: boolean } = {}) {
    const { title, message, type, actions, append = false } = options;
    const typeValue = type !== undefined ? getType(type) : undefined;
    let updated = false;

    for (const entry of notificationlist) {
        if (entry.id !== idToUpdate) continue;
        updated = true;
        if (title !== undefined) {
            entry.title = title;
        }
        if (typeValue !== undefined) {
            entry.type = typeValue;
        }
        if (actions !== undefined) {
            entry.actions = actions;
        }
        if (message !== undefined) {
            entry.message = append && entry.message
                ? `${entry.message}\n${message}`
                : message;
        }
    }

    for (const entry of toastlist) {
        if (entry.id !== idToUpdate) continue;
        if (title !== undefined) {
            entry.title = title;
        }
        if (typeValue !== undefined) {
            entry.type = typeValue;
        }
        if (actions !== undefined) {
            entry.actions = actions;
        }
        if (message !== undefined) {
            entry.message = append && entry.message
                ? `${entry.message}\n${message}`
                : message;
        }
    }

    if (updated) {
        notifications.set([...notificationlist]);
        toasts.set([...toastlist]);
    }
}

export function markAllRead() {
    for (const notification of notificationlist) {
        updateReadStatus(notification.id, true);
    }
}

export function updateReadStatus(id, read) {
    let updated = false;
    for (const notification of notificationlist) {
        if (notification.id === id) {
            notification.read = read;
            if (notification.persistKey) {
                persistReadState(notification.persistKey, read);
            }
            updated = true;
            break;
        }
    }
    if (updated) {
        notifications.set([...notificationlist]);
    }
    updateNotificationStatus();
}

export function clearNotifications() {
    notificationlist = [];
    toastlist = [];
    notifications.set(notificationlist);
    toasts.set(toastlist);
    updateNotificationStatus();
}

export function closeNotification(id) {
    notificationlist = notificationlist.filter(n => n.id !== id);
    notifications.set(notificationlist);
    updateNotificationStatus();
}

export function closeToast(id) {
    toastlist = toastlist.filter(n => n.id !== id);
    toasts.set(toastlist);
}

function getType(type: NotifType) {
    switch (type) {
        case NotifType.Message:
            return "Message";
        case NotifType.Warning:
            return "Warning";
        case NotifType.Error:
            return "Error";
        case NotifType.Success:
            return "Success";
        default:
            return "Message";
    }
}

function updateNotificationStatus() {
    let unread = false;
    for (const notification of notificationlist) {
        if (!notification.read) {
            unread = true;
            break;
        }
    }
    unreadnotifications.set(unread);
}
