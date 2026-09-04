/**
 * Conservative block boundaries for streamed Markdown.
 *
 * The scanner deliberately freezes only content separated by a blank line and
 * leaves structural blocks (lists, quotes, tables and open fences) in the tail.
 * A false negative costs a small re-parse; a false positive would change the
 * meaning of the final Markdown document.
 */
export interface MarkdownStreamBlock {
    id: string;
    source: string;
    complete: boolean;
}

const FENCE_START = /^ {0,3}(`{3,}|~{3,})/;
const LIST_START = /^ {0,3}(?:[-+*]|\d+[.)])\s+/;
const BLOCKQUOTE_START = /^ {0,3}>/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

interface SourceLine {
    start: number;
    end: number;
    text: string;
}

function readLines(source: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let start = 0;
    for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
        const value = match[0];
        if (!value && start >= source.length) break;
        const end = start + value.length;
        lines.push({
            start,
            end,
            text: value.endsWith("\n")
                ? value.slice(0, -1).replace(/\r$/, "")
                : value,
        });
        start = end;
        if (end >= source.length) break;
    }
    return lines;
}

function isBlank(line: SourceLine): boolean {
    return line.text.trim().length === 0;
}

function fenceMarker(
    line: string
): { character: string; length: number } | null {
    const match = line.match(FENCE_START);
    if (!match) return null;
    return { character: match[1][0], length: match[1].length };
}

function closesFence(
    line: string,
    marker: { character: string; length: number }
): boolean {
    const escaped = marker.character === "`" ? "`" : "~";
    const pattern = new RegExp(`^ {0,3}${escaped}{${marker.length},}\\s*$`);
    return pattern.test(line);
}

function looksStructural(
    lines: SourceLine[],
    start: number,
    end: number
): boolean {
    const nonBlank = lines.slice(start, end).filter((line) => !isBlank(line));
    if (nonBlank.length === 0) return false;

    if (
        nonBlank.some(
            (line) =>
                LIST_START.test(line.text) || BLOCKQUOTE_START.test(line.text)
        )
    ) {
        return true;
    }

    // A two-line table needs to remain together while its rows are arriving.
    if (nonBlank.length >= 2 && TABLE_SEPARATOR.test(nonBlank[1].text))
        return true;

    return false;
}

function hasOpenInlineSyntax(source: string): boolean {
    // These constructs can legally continue after a line break. Keeping the
    // block in the tail is cheaper than freezing a different parse tree.
    let backtickRuns = 0;
    let escaped = false;
    for (const character of source) {
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === "\\") {
            escaped = true;
            continue;
        }
        if (character === "`") backtickRuns += 1;
    }
    if (backtickRuns % 2 !== 0) return true;

    const lastLine =
        source
            .split(/\r?\n/)
            .reverse()
            .find((line) => line.trim().length > 0) ?? "";
    if (/(?:!?)\[[^\]]*$/.test(lastLine)) return true;
    if (/\]\([^)]*$/.test(lastLine)) return true;
    if (/<[A-Za-z][^>]*$/.test(lastLine)) return true;
    return false;
}

/**
 * Split streamed Markdown into stable blocks and one active tail.
 *
 * IDs are source offsets, so appending input keeps existing keyed blocks stable.
 * `complete` is false for the final block unless the source ends with a blank
 * separator or a closed fenced code block.
 */
export function splitMarkdownStream(
    source: string | null | undefined,
    sourceOffset = 0
): MarkdownStreamBlock[] {
    const text = source ?? "";
    if (!text) return [];

    const lines = readLines(text);
    if (lines.length === 0) return [];

    const blocks: MarkdownStreamBlock[] = [];
    let blockStart = 0;
    let fence: { character: string; length: number } | null = null;
    let fenceEnd = -1;

    const push = (startLine: number, endLine: number, complete: boolean) => {
        if (endLine <= startLine) return;
        const start = lines[startLine].start;
        const end = lines[endLine - 1].end;
        const blockSource = text.slice(start, end);
        if (!blockSource.trim()) return;
        blocks.push({
            id: String(sourceOffset + start),
            source: blockSource,
            complete,
        });
    };

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (fence) {
            if (closesFence(line.text, fence)) {
                fence = null;
                fenceEnd = index;
            }
            continue;
        }

        const marker = fenceMarker(line.text);
        if (marker) {
            fence = marker;
            fenceEnd = -1;
            continue;
        }

        if (!isBlank(line)) continue;

        const separatorEnd = index + 1;
        const structural = looksStructural(lines, blockStart, index);
        const blockSource = text.slice(lines[blockStart].start, line.end);

        if (structural) {
            const next = lines
                .slice(separatorEnd)
                .find((candidate) => !isBlank(candidate));
            const continues = Boolean(
                next &&
                    (LIST_START.test(next.text) ||
                        BLOCKQUOTE_START.test(next.text) ||
                        /^ {4,}/.test(next.text))
            );
            if (!continues && !hasOpenInlineSyntax(blockSource)) {
                push(blockStart, separatorEnd, true);
                blockStart = separatorEnd;
            }
            continue;
        }

        // Keep structural blocks in the active tail. Plain paragraphs and
        // headings can be frozen once a blank line has closed them.
        if (!structural && !hasOpenInlineSyntax(blockSource)) {
            push(blockStart, separatorEnd, true);
            blockStart = separatorEnd;
        }
    }

    if (fenceEnd >= blockStart && !fence) {
        // A closed fence is independently stable even when no trailing blank
        // line was emitted by the server.
        push(blockStart, fenceEnd + 1, true);
        blockStart = fenceEnd + 1;
    }

    if (blockStart < lines.length) {
        const complete = !fence && lines[lines.length - 1].text.trim() === "";
        push(blockStart, lines.length, complete);
    }

    return blocks;
}
