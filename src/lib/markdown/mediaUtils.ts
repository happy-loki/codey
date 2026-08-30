import { convertFileSrc } from "@tauri-apps/api/core";

export interface MediaPathContext {
    /** Directory used to resolve relative media references. */
    baseDir?: string | null;
    /** Optional source file. Its parent directory is used when baseDir is absent. */
    filePath?: string | null;
}

/**
 * Convert a Markdown/HTML media URL into a URL that the Tauri webview can load.
 * Remote/data/blob resources are preserved; local paths are resolved against the
 * supplied workspace or source-file directory and routed through assetProtocol.
 */
export function resolveMediaUrl(
    value: string,
    context: MediaPathContext | string | null | undefined = {}
): string | null {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) return null;

    const { path, suffix } = splitUrlSuffix(trimmed);
    if (isRemoteResource(trimmed)) return trimmed;
    if (isBlockedResource(trimmed)) return null;

    const resolvedPath = resolveLocalPath(path, context);
    if (!resolvedPath) {
        // Let the document's normal URL resolution handle relative references when
        // no workspace/source path is available (for example in a browser preview).
        const decodedPath = decodeUriComponentSafe(path);
        return isRelativePath(decodedPath) ? trimmed : null;
    }

    const assetUrl = safeConvertFileSrc(resolvedPath);
    return assetUrl ? `${assetUrl}${suffix}` : null;
}

/**
 * Resolve a local file reference without converting it to an asset URL.
 * This is used by ChatView's editor-link handler for ordinary Markdown links.
 */
export function resolveLocalPath(
    value: string,
    context: MediaPathContext | string | null | undefined = {}
): string | null {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || isRemoteResource(trimmed) || isBlockedResource(trimmed)) {
        return null;
    }

    const { path } = splitUrlSuffix(trimmed);
    let localPath = normalizeLocalPath(
        stripFileProtocol(decodeUriComponentSafe(path))
    );
    if (hasUnsupportedScheme(localPath)) return null;
    if (/^\/[a-zA-Z]:\//.test(localPath)) {
        localPath = localPath.slice(1);
    }
    if (!localPath) return null;

    const pathContext: MediaPathContext =
        typeof context === "string" ? { baseDir: context } : context ?? {};
    const baseDir = resolveBaseDir(pathContext);

    if (!isAbsolutePath(localPath)) {
        if (!baseDir) return null;
        return joinPath(baseDir, localPath);
    }

    return localPath;
}

/** Resolve each URL in a standard CSS/HTML srcset attribute. */
export function resolveMediaSrcset(
    value: string,
    context: MediaPathContext | string | null | undefined = {}
): string | null {
    if (!value || typeof value !== "string") return null;
    // A data URL contains a comma of its own. Callers can use it in `src`, but
    // treating it as a srcset entry without a complete srcset parser is unsafe.
    if (/^\s*data:/i.test(value)) return null;

    const entries = value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    if (entries.length === 0) return null;

    const rewritten = entries.flatMap((entry) => {
        const parts = entry.split(/\s+/).filter(Boolean);
        const url = parts.shift() ?? "";
        const resolved = resolveMediaUrl(url, context);
        if (!resolved) return [];
        return [parts.length > 0 ? `${resolved} ${parts.join(" ")}` : resolved];
    });

    return rewritten.length > 0 ? rewritten.join(", ") : null;
}

export function resolveMediaBaseDir(
    context: MediaPathContext = {}
): string | null {
    return resolveBaseDir(context);
}

function isRemoteResource(value: string): boolean {
    return (
        /^(?:https?:|blob:|asset:|tauri:)/i.test(value) ||
        isSafeDataResource(value)
    );
}

function isSafeDataResource(value: string): boolean {
    return /^data:(?:image\/(?:png|jpeg|gif|webp|avif|apng|jxl|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon|tiff)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/(?:ogg|vnd\.apple\.mpegurl))(?:;[^,]*)?,/i.test(
        value
    );
}

function isBlockedResource(value: string): boolean {
    return /^(?:javascript:|vbscript:|about:|mailto:|tel:|vscode(?:-insiders)?:)/i.test(
        value
    );
}

function hasUnsupportedScheme(value: string): boolean {
    return (
        /^[a-z][a-z0-9+.-]*:/i.test(value) &&
        !/^(?:file:|[a-z]:(?:[\\/]|%2f|%5c))/i.test(value)
    );
}

function splitUrlSuffix(value: string): { path: string; suffix: string } {
    // The question mark in a Windows extended-length prefix (`\\\\?\\` or
    // `//?/`) is part of the path, not the beginning of a query string. Marked
    // may percent-encode one or both leading backslashes, so recognize those
    // forms as well.
    const normalizedPrefix = value.slice(0, 8).replace(/\\/g, "/");
    const extendedPrefix =
        normalizedPrefix.startsWith("//?/") ||
        normalizedPrefix.startsWith("/?/") ||
        /^(?:%5c|%2f){0,2}\?(?:%5c|%2f)/i.test(value);
    let index = -1;
    for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        if (character !== "?" && character !== "#") continue;
        if (character === "?" && extendedPrefix) {
            const prefixQuestionIndex = value.search(/\?/);
            if (offset === prefixQuestionIndex) continue;
        }
        index = offset;
        break;
    }
    if (index < 0) return { path: value, suffix: "" };
    return { path: value.slice(0, index), suffix: value.slice(index) };
}

function stripFileProtocol(value: string): string {
    if (!/^file:/i.test(value)) return value;

    try {
        const url = new URL(value);
        let pathname = decodeURIComponent(url.pathname || "");
        if (url.hostname && url.hostname.toLowerCase() !== "localhost") {
            pathname = `//${url.hostname}${pathname}`;
        }
        if (/^\/[a-zA-Z]:/.test(pathname)) {
            pathname = pathname.slice(1);
        }
        return pathname.replace(/\\/g, "/");
    } catch {
        return value.replace(/^file:/i, "");
    }
}

function resolveBaseDir(context: MediaPathContext): string | null {
    const explicitBase = context.baseDir
        ? normalizeLocalPath(stripFileProtocol(context.baseDir.trim()))
        : "";
    if (explicitBase && isAbsolutePath(explicitBase)) {
        return trimTrailingSeparators(normalizeSeparators(explicitBase));
    }

    const sourceFile = context.filePath
        ? normalizeLocalPath(stripFileProtocol(context.filePath.trim()))
        : "";
    if (!sourceFile || !isAbsolutePath(sourceFile)) return null;

    const normalized = normalizeLocalPath(sourceFile);
    const lastSeparator = normalized.lastIndexOf("/");
    if (lastSeparator < 0) return normalized;

    const parent = normalized.slice(0, lastSeparator);
    if (/^[a-zA-Z]:$/.test(parent)) return `${parent}/`;
    return parent || (normalized.startsWith("/") ? "/" : null);
}

function safeConvertFileSrc(pathname: string): string | null {
    const normalizedPath = normalizeLocalPath(decodeUriComponentSafe(pathname));
    try {
        // convertFileSrc is only available inside the Tauri webview. Checking the
        // bridge first keeps Vite/browser rendering free of noisy exceptions.
        if (
            typeof window !== "undefined" &&
            (window as any).__TAURI_INTERNALS__
        ) {
            const converted = convertFileSrc(normalizedPath);
            if (converted && !looksLikeInvalidAssetUrl(converted))
                return converted;
        }
    } catch {
        // Fall through to the asset URL fallback below.
    }

    return buildAssetUrl(normalizedPath);
}

function looksLikeInvalidAssetUrl(value: string): boolean {
    return (
        value.includes("\\") ||
        /%5[cC]/.test(value) ||
        /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(value)
    );
}

function buildAssetUrl(pathname: string): string {
    const normalized = normalizeSeparators(pathname);
    const withLeadingSlash = normalized.startsWith("/")
        ? normalized
        : `/${normalized}`;
    const encodedPath = encodeURI(withLeadingSlash)
        .replace(/#/g, "%23")
        .replace(/\?/g, "%3F");
    return `https://asset.localhost${encodedPath}`;
}

function joinPath(baseDir: string, relative: string): string {
    const normalizedBase = normalizeLocalPath(baseDir);
    const normalizedRelative = normalizeSeparators(relative);
    const { root, rest } = splitPathRoot(normalizedBase);
    const baseParts = splitSegments(rest);
    const relativeParts = splitSegments(normalizedRelative);

    for (const part of relativeParts) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (baseParts.length > 0) baseParts.pop();
            continue;
        }
        baseParts.push(part);
    }

    const joined = baseParts.join("/");
    if (!joined) return root || normalizedBase;
    return root ? `${root}${joined}` : joined;
}

function splitPathRoot(value: string): { root: string; rest: string } {
    const driveMatch = value.match(/^([a-zA-Z]:)\/(.*)$/);
    if (driveMatch)
        return { root: `${driveMatch[1]}/`, rest: driveMatch[2] || "" };
    if (/^[a-zA-Z]:$/.test(value)) return { root: `${value}/`, rest: "" };

    if (value.startsWith("//")) {
        const parts = value.slice(2).split("/").filter(Boolean);
        if (parts.length >= 2) {
            return {
                root: `//${parts[0]}/${parts[1]}/`,
                rest: parts.slice(2).join("/"),
            };
        }
        return { root: "//", rest: parts.join("/") };
    }

    if (value.startsWith("/")) return { root: "/", rest: value.slice(1) };
    return { root: "", rest: value };
}

function normalizeSeparators(value: string): string {
    return value.replace(/\\/g, "/");
}

/**
 * Normalize paths before handing them to Tauri's asset protocol. Windows can
 * expose extended-length paths (`\\\\?\\D:\\...`) and shell output may carry
 * dot segments; both forms are valid on disk but are rejected by the protocol
 * unless converted to a plain, traversal-free path first.
 */
function normalizeLocalPath(value: string): string {
    let normalized = normalizeSeparators(value.trim());

    if (/^\/\/\?\/UNC\//i.test(normalized)) {
        normalized = `//${normalized.slice("//?/UNC/".length)}`;
    } else if (/^\/\/\?\//.test(normalized)) {
        normalized = normalized.slice("//?/".length);
    } else if (/^\/\?\/UNC\//i.test(normalized)) {
        normalized = `//${normalized.slice("/?/UNC/".length)}`;
    } else if (/^\/\?\//.test(normalized)) {
        normalized = normalized.slice("/?/".length);
    } else if (/^\?\/UNC\//i.test(normalized)) {
        normalized = `//${normalized.slice("?/UNC/".length)}`;
    } else if (/^\?\//.test(normalized)) {
        normalized = normalized.slice("?/".length);
    }

    // Some shell/renderer paths retain a relative-looking prefix before a
    // Windows drive (`./D:/...` or `/D:/...`). Treat the drive path as absolute
    // before resolving it against the workspace directory.
    normalized = normalized.replace(/^(?:\.\/|\/+)(?=[a-zA-Z]:\/)/, "");

    // A malformed or partially escaped extended prefix can leave a single
    // leading slash before the drive letter after separator normalization.
    normalized = normalized.replace(/^\/[a-zA-Z]:\//, (match) =>
        match.slice(1)
    );

    // A producer can accidentally prepend the same absolute Windows path twice
    // (`D:/repo/D:/repo/file`). A second drive marker cannot be a valid filename
    // component, so keep the latter absolute path.
    const driveMatches = Array.from(normalized.matchAll(/[a-zA-Z]:\//g));
    if (driveMatches.length > 1 && /^[a-zA-Z]:\//.test(normalized)) {
        const secondDriveIndex = driveMatches[1].index ?? -1;
        if (
            secondDriveIndex > 0 &&
            /\/$/.test(normalized.slice(0, secondDriveIndex))
        ) {
            normalized = normalized.slice(secondDriveIndex);
        }
    }

    const { root, rest } = splitPathRoot(normalized);
    const parts: string[] = [];
    for (const part of rest.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (parts.length > 0 && parts[parts.length - 1] !== "..") {
                parts.pop();
            } else if (!root) {
                parts.push(part);
            }
            continue;
        }
        parts.push(part);
    }

    const joined = parts.join("/");
    if (!joined) return root || normalized;
    return root ? `${root}${joined}` : joined;
}

function trimTrailingSeparators(value: string): string {
    const trimmed = normalizeSeparators(value).replace(/\/+$/, "");
    if (/^[a-zA-Z]:$/.test(trimmed)) return `${trimmed}/`;
    if (!trimmed && value.startsWith("/")) return "/";
    return trimmed;
}

function splitSegments(value: string): string[] {
    return value.split(/\/+/).filter(Boolean);
}

function isWindowsPath(value: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function isAbsolutePath(value: string): boolean {
    return isWindowsPath(value) || value.startsWith("/");
}

function isRelativePath(value: string): boolean {
    return (
        !value.startsWith("/") &&
        !isWindowsPath(value) &&
        !/^[a-z][a-z0-9+.-]*:/i.test(value)
    );
}

function decodeUriComponentSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
