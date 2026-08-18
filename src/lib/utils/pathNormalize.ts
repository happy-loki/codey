export function normalizeFsPath(raw: string | null | undefined): string {
    if (typeof raw !== "string") return "";
    let value = raw.trim();
    if (!value) return "";

    value = stripUriLikePrefix(value);
    value = value.replace(/\\/g, "/");
    value = convertWslLikePath(value);
    return value;
}

export function canonicalPathKey(raw: string | null | undefined): string {
    const normalized = normalizeFsPath(raw);
    if (!normalized) return "";
    return normalized.replace(/\/+/g, "/").toLowerCase();
}

function stripUriLikePrefix(value: string): string {
    if (!value) return "";
    const lower = value.toLowerCase();
    if (lower.startsWith("file://") || lower.startsWith("vscode-file://")) {
        try {
            const url = new URL(value);
            let path = url.pathname || "";
            if (url.protocol === "file:" && url.host && url.host !== "localhost") {
                path = `//${url.host}${path}`;
            }
            if (/^\/[a-zA-Z]:/.test(path)) {
                path = path.slice(1);
            }
            return decodeUriComponentSafe(path) || value;
        } catch (_) {
            return decodeUriComponentSafe(value.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//, ""));
        }
    }
    if (/^file:/i.test(lower)) {
        return value.replace(/^file:/i, "");
    }
    return value;
}

function decodeUriComponentSafe(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch (_) {
        return text;
    }
}

function convertWslLikePath(path: string): string {
    if (!path) return "";
    const wslMatch = path.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (wslMatch) {
        return `${wslMatch[1]}:/${wslMatch[2]}`;
    }
    return path;
}
