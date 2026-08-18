import type { FileUpdateChange } from "./types";

export type DiffLineKind = "insert" | "delete" | "context" | "hunk-separator";

export type DiffLine = {
    kind: DiffLineKind;
    /**
     * Single displayed line number column (generally prefers the "new" line number).
     * For separator / metadata rows this may be null.
     */
    lineNumber: number | null;
    text: string;
};

export type ParsedDiff = {
    originalText: string;
    modifiedText: string;
    additions: number;
    deletions: number;
    isBinary: boolean;
    hasHunks: boolean;
    lines: DiffLine[];
};

const BINARY_DIFF_PATTERNS = [/^Binary files/i, /^GIT binary patch/i];
const NULL_CHAR_PATTERN = /\0/;
const DIFF_METADATA_PREFIXES = [
    "+++",
    "---",
    "diff --git",
    "@@",
    "index ",
    "\\ No newline",
    "new file mode",
    "deleted file mode",
    "old mode",
    "new mode",
    "similarity index",
    "rename from",
    "rename to",
];

const EMPTY_PARSED: ParsedDiff = {
    originalText: "",
    modifiedText: "",
    additions: 0,
    deletions: 0,
    isBinary: false,
    hasHunks: false,
    lines: [],
};

export function normalizeDiffNewlines(input: string | null | undefined): string {
    return (input ?? "").replace(/\r\n/g, "\n");
}

export function isBinaryDiff(diff: string | null | undefined): boolean {
    const safeDiff = normalizeDiffNewlines(diff);
    return BINARY_DIFF_PATTERNS.some((pattern) => pattern.test(safeDiff)) || NULL_CHAR_PATTERN.test(safeDiff);
}

function countLines(text: string): number {
    if (!text) return 0;
    const parts = text.split("\n");
    if (parts.length === 0) return 0;
    return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

export type TurnDiffFileSummary = {
    path: string;
    additions: number;
    deletions: number;
    isBinary: boolean;
    /**
     * Unified diff content for this file.
     *
     * Note: Depending on the upstream source, this may or may not include a
     * `diff --git` header. The client should treat it as an opaque per-file
     * unified diff chunk.
     */
    diff: string;
};

export function calculateDiffStats(diff: string | null | undefined): { additions: number; deletions: number } {
    return calculateAddRemoveFromDiff(diff);
}

export function firstChangeLineIndex(lines: DiffLine[] | undefined | null): number | null {
    if (!lines || lines.length === 0) return null;
    for (const line of lines) {
        if (line.kind === "insert" || line.kind === "delete") {
            const ln = typeof line.lineNumber === "number" ? line.lineNumber : null;
            if (ln === null) return 0;
            return Math.max(0, ln - 1);
        }
    }
    return null;
}

export function parseTurnUnifiedDiff(unifiedDiff: string | null | undefined): TurnDiffFileSummary[] {
    const results: TurnDiffFileSummary[] = [];
    const diff = normalizeDiffNewlines(unifiedDiff);
    if (!diff) {
        return results;
    }

    const files = splitTurnUnifiedDiffIntoFiles(diff);

    for (const fileChunk of files) {
        const path = extractPathFromUnifiedDiffChunk(fileChunk);
        if (!path) continue;

        const { additions, deletions } = calculateAddRemoveFromDiff(fileChunk);
        results.push({
            path,
            additions,
            deletions,
            isBinary: isBinaryDiff(fileChunk),
            diff: fileChunk,
        });
    }

    return results;
}

function splitTurnUnifiedDiffIntoFiles(unifiedDiff: string): string[] {
    const trimmed = (unifiedDiff ?? "").trim();
    if (!trimmed) return [];

    // Prefer splitting on `diff --git` when present (typical git-style diffs).
    if (/^diff --git /m.test(trimmed)) {
        return trimmed
            .split(/^diff --git /m)
            .filter((chunk) => chunk.trim().length > 0)
            .map((chunk) => `diff --git ${chunk}`.trimEnd());
    }

    // Fallback: split on `---` file headers (diffy-style unified diffs).
    const lines = trimmed.split("\n");
    const startIndexes: number[] = [];

    for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].startsWith("--- ")) continue;
        // A proper unified diff file section should have a matching `+++` line right after.
        if (i + 1 < lines.length && lines[i + 1].startsWith("+++ ")) {
            startIndexes.push(i);
        }
    }

    if (startIndexes.length === 0) {
        // Unknown format; treat as a single chunk.
        return [trimmed];
    }

    const chunks: string[] = [];
    for (let idx = 0; idx < startIndexes.length; idx += 1) {
        const start = startIndexes[idx];
        const end = idx + 1 < startIndexes.length ? startIndexes[idx + 1] : lines.length;
        chunks.push(lines.slice(start, end).join("\n").trimEnd());
    }
    return chunks;
}

function extractPathFromUnifiedDiffChunk(fileChunk: string): string | null {
    const lines = normalizeDiffNewlines(fileChunk).split("\n");

    // Prefer `+++` (new file) as the display path.
    for (const line of lines) {
        if (!line.startsWith("+++ ")) continue;
        const trimmed = line.slice(4).trim();
        if (!trimmed || trimmed === "/dev/null") return null;
        return trimmed.startsWith("b/") ? trimmed.slice(2) : trimmed;
    }

    // Fallback: try to parse `diff --git a/x b/y` header if present.
    for (const line of lines) {
        if (!line.startsWith("diff --git ")) continue;
        const rest = line.slice("diff --git ".length).trim();
        const parts = rest.split(/\s+/);
        const bPath = parts[1] ?? null;
        if (!bPath) return null;
        return bPath.startsWith("b/") ? bPath.slice(2) : bPath;
    }

    return null;
}

function calculateAddRemoveFromDiff(diff: string | null | undefined): { additions: number; deletions: number } {
    const safeDiff = normalizeDiffNewlines(diff);
    if (!safeDiff) {
        return { additions: 0, deletions: 0 };
    }

    const lines = safeDiff.split("\n");
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    let sawHunk = false;

    const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

    for (const raw of lines) {
        if (raw.startsWith("@@")) {
            const match = raw.match(HUNK_HEADER_RE);
            inHunk = Boolean(match);
            sawHunk = sawHunk || inHunk;
            continue;
        }

        if (sawHunk && !inHunk) {
            continue;
        }

        if (!sawHunk && DIFF_METADATA_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
            continue;
        }

        if (raw.startsWith("+")) {
            additions += 1;
            continue;
        }

        if (raw.startsWith("-")) {
            deletions += 1;
        }
    }

    return { additions, deletions };
}

export function parseUnifiedDiff(diff: string | null | undefined): ParsedDiff {
    const safeDiff = normalizeDiffNewlines(diff);
    const isBinary = isBinaryDiff(safeDiff);
    if (!safeDiff || isBinary) {
        return {
            ...EMPTY_PARSED,
            originalText: safeDiff,
            modifiedText: safeDiff,
            isBinary,
            hasHunks: false,
        };
    }

    const lines = safeDiff.split("\n");
    const counts = calculateAddRemoveFromDiff(safeDiff);
    const originalLines: string[] = [];
    const modifiedLines: string[] = [];
    const renderedLines: DiffLine[] = [];

    let inHunk = false;
    let hasHunks = false;
    let currentOldLine = 0;
    let currentNewLine = 0;
    let seenAnyHunk = false;

    const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

    for (const raw of lines) {
        if (raw.startsWith("@@")) {
            const match = raw.match(HUNK_HEADER_RE);
            if (match) {
                if (seenAnyHunk) {
                    renderedLines.push({
                        kind: "hunk-separator",
                        lineNumber: null,
                        text: "⋮",
                    });
                }
                seenAnyHunk = true;
                inHunk = true;
                hasHunks = true;

                currentOldLine = parseInt(match[1], 10) || 0;
                currentNewLine = parseInt(match[2], 10) || 0;

                if (originalLines.length > 0 || modifiedLines.length > 0) {
                    originalLines.push("");
                    modifiedLines.push("");
                }
                continue;
            }
        }

        if (!inHunk) {
            continue;
        }

        // Inserted line
        if (raw.startsWith("+")) {
            const text = raw.slice(1);
            modifiedLines.push(text);
            renderedLines.push({
                kind: "insert",
                lineNumber: currentNewLine || null,
                text,
            });
            if (currentNewLine) currentNewLine += 1;
            continue;
        }

        // Deleted line
        if (raw.startsWith("-")) {
            const text = raw.slice(1);
            originalLines.push(text);
            renderedLines.push({
                kind: "delete",
                lineNumber: currentOldLine || null,
                text,
            });
            if (currentOldLine) currentOldLine += 1;
            continue;
        }

        // Diff metadata ("No newline at end of file")
        if (raw.startsWith("\\ No newline")) {
            continue;
        }

        // Context line (unchanged)
        const content = raw.startsWith(" ") ? raw.slice(1) : raw;
        originalLines.push(content);
        modifiedLines.push(content);
        renderedLines.push({
            kind: "context",
            lineNumber: currentNewLine || currentOldLine || null,
            text: content,
        });
        if (currentOldLine) currentOldLine += 1;
        if (currentNewLine) currentNewLine += 1;
    }

    return {
        originalText: originalLines.join("\n"),
        modifiedText: modifiedLines.join("\n"),
        additions: counts.additions,
        deletions: counts.deletions,
        isBinary,
        hasHunks,
        lines: renderedLines,
    };
}

export function buildDiffPayload(change: FileUpdateChange | null | undefined): ParsedDiff {
    if (!change) return { ...EMPTY_PARSED };

    const normalized = normalizeDiffNewlines(change.diff);
    const binary = isBinaryDiff(normalized);

    if (!change.kind || binary) {
        return {
            ...EMPTY_PARSED,
            originalText: normalized,
            modifiedText: normalized,
            isBinary: binary,
            hasHunks: !binary && Boolean(normalized.trim()),
        };
    }

    if (change.kind.type === "add") {
        const lineCount = countLines(normalized);
        const sourceLines = normalized.split("\n");
        const lines: DiffLine[] = [];
        for (let i = 0; i < lineCount; i += 1) {
            const text = sourceLines[i] ?? "";
            if (!text && i === lineCount - 1) continue;
            lines.push({
                kind: "insert",
                lineNumber: i + 1,
                text,
            });
        }
        return {
            originalText: "",
            modifiedText: normalized,
            additions: lineCount,
            deletions: 0,
            isBinary: binary,
            hasHunks: !binary && lineCount > 0,
            lines,
        };
    }

    if (change.kind.type === "delete") {
        const lineCount = countLines(normalized);
        const sourceLines = normalized.split("\n");
        const lines: DiffLine[] = [];
        for (let i = 0; i < lineCount; i += 1) {
            const text = sourceLines[i] ?? "";
            if (!text && i === lineCount - 1) continue;
            lines.push({
                kind: "delete",
                lineNumber: i + 1,
                text,
            });
        }
        return {
            originalText: normalized,
            modifiedText: "",
            additions: 0,
            deletions: lineCount,
            isBinary: binary,
            hasHunks: !binary && lineCount > 0,
            lines,
        };
    }

    const parsed = parseUnifiedDiff(normalized);
    return parsed;
}
