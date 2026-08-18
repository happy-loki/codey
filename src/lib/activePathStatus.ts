import { writable } from "svelte/store";

export type ActivePathStatusLevel = "neutral" | "info" | "success" | "warning" | "error";

export type ActivePathStatusObject = {
    message: string;
    level?: ActivePathStatusLevel;
};

export type ActivePathStatusPayload = string | ActivePathStatusObject | null | undefined;

export type ResolvedActivePathStatus = {
    message: string;
    level: ActivePathStatusLevel;
};

const defaultStatus: ResolvedActivePathStatus = { message: "", level: "neutral" };

export const activePathStatus = writable<ActivePathStatusPayload>("");

export function setActivePathStatus(payload: ActivePathStatusPayload): void {
    activePathStatus.set(payload ?? "");
}

export function clearActivePathStatus(): void {
    activePathStatus.set("");
}

export function resolveActivePathStatus(payload: ActivePathStatusPayload): ResolvedActivePathStatus {
    if (payload && typeof payload === "object") {
        const message = String(payload.message ?? "").trim();
        if (!message) {
            return defaultStatus;
        }
        const provided = normalizeLevel(payload.level);
        const inferred = provided === "neutral" ? inferLevelFromMessage(message) : provided;
        return {
            message,
            level: inferred,
        };
    }
    if (typeof payload === "string") {
        const message = payload.trim();
        if (!message) {
            return defaultStatus;
        }
        return {
            message,
            level: inferLevelFromMessage(message),
        };
    }
    return defaultStatus;
}

function normalizeLevel(level: ActivePathStatusLevel | null | undefined): ActivePathStatusLevel {
    switch (level) {
        case "info":
        case "success":
        case "warning":
        case "error":
            return level;
        default:
            return "neutral";
    }
}

const infoKeywords = ["loading", "saving", "sync", "同步", "加载", "保存中", "处理中"];
const successKeywords = ["ready", "saved", "就绪", "已保存", "成功", "完成"];
const warningKeywords = ["unsaved", "dirty", "未保存", "冲突", "注意"];
const errorKeywords = ["error", "failed", "失败", "错误", "不可用"];

function inferLevelFromMessage(message: string): ActivePathStatusLevel {
    const lower = message.toLowerCase();
    if (!lower) return "neutral";
    if (errorKeywords.some((kw) => lower.includes(kw))) {
        return "error";
    }
    if (warningKeywords.some((kw) => lower.includes(kw))) {
        return "warning";
    }
    if (infoKeywords.some((kw) => lower.includes(kw))) {
        return "info";
    }
    if (successKeywords.some((kw) => lower.includes(kw))) {
        return "success";
    }
    return "neutral";
}
