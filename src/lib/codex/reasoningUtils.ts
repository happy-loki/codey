export interface ParsedReasoningSummary {
    header: string | null;
    body: string;
}

function normalizeParts(parts?: string[] | null): string {
    if (!parts || parts.length === 0) {
        return "";
    }
    return parts.join("").trim();
}

const HEADER_REGEX = /^\s*\*\*(.+?)\*\*(.*)$/s;

export function parseReasoningSummary(parts?: string[] | null): ParsedReasoningSummary {
    const combined = normalizeParts(parts);
    if (!combined) {
        return { header: null, body: "" };
    }

    // If the text looks like an in‑progress Markdown header (starts with `**`
    // but does not yet have a matching closing `**`), treat it as "header only"
    // and report an empty body. This prevents us from prematurely treating
    // partial header text as the reasoning body and creating a reasoning card
    // before any real content has streamed in.
    const trimmed = combined.trimStart();
    if (trimmed.startsWith("**")) {
        const secondMarker = trimmed.indexOf("**", 2);
        if (secondMarker === -1) {
            return { header: null, body: "" };
        }
    }

    const match = combined.match(HEADER_REGEX);
    if (match) {
        const header = match[1]?.trim() || null;
        const body = match[2]?.trim() || "";
        if (header) {
            return { header, body };
        }
    }

    return { header: null, body: combined };
}
