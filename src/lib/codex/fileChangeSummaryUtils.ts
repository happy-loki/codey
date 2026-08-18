import type { ThreadItem, FileUpdateChange } from "./types";
import type { TurnDiffFileSummary } from "./diffUtils";
import { buildDiffPayload } from "./diffUtils";

export type FileChangeSummaryEntry = {
    id: string;
    path: string;
    label: string;
    typeClass: string;
    additions: number;
    deletions: number;
    changes: FileUpdateChange[];
};

type FileChangeAggregate = {
    path: string;
    additions: number;
    deletions: number;
    lastKind: FileUpdateChange["kind"] | undefined;
    changes: FileUpdateChange[];
};

function buildSummaryFromChanges(changes: FileUpdateChange[]): FileChangeSummaryEntry[] {
    const map = new Map<string, FileChangeAggregate>();

    for (const change of changes) {
        const kind = change.kind;
        const displayPath =
            kind && kind.type === "update" && kind.move_path ? kind.move_path : change.path;

        if (!displayPath) continue;

        const parsed = buildDiffPayload(change);
        const additions = parsed.additions || 0;
        const deletions = parsed.deletions || 0;

        const existing = map.get(displayPath);

        if (!existing) {
            map.set(displayPath, {
                path: displayPath,
                additions,
                deletions,
                lastKind: kind,
                changes: [change],
            });
        } else {
            existing.additions += additions;
            existing.deletions += deletions;
            // Use the last seen kind to represent the final state for this file
            existing.lastKind = kind;
            existing.changes.push(change);
        }
    }

    const result: FileChangeSummaryEntry[] = Array.from(map.values()).map((aggregate) => {
        const summaryKind = aggregate.lastKind;
        const label = getChangeKindLabel(summaryKind);
        const typeClass = getChangeKindClass(summaryKind);

        return {
            id: aggregate.path,
            path: aggregate.path,
            label,
            typeClass,
            additions: aggregate.additions,
            deletions: aggregate.deletions,
            changes: aggregate.changes,
        };
    });

    // Stable sort by path for nicer display
    result.sort((a, b) => a.path.localeCompare(b.path));

    return result;
}

export function buildFileChangeSummaryFromChanges(
    changes: FileUpdateChange[]
): FileChangeSummaryEntry[] {
    return buildSummaryFromChanges(changes);
}

export function buildFileChangeSummary(
    items: Extract<ThreadItem, { type: "fileChange" }>[]
): FileChangeSummaryEntry[] {
    return buildSummaryFromChanges(items.flatMap((item) => item.changes || []));
}

export function buildFileChangeSummaryFromTurnDiff(
    files: TurnDiffFileSummary[]
): FileChangeSummaryEntry[] {
    const result: FileChangeSummaryEntry[] = files.map((file) => {
        // Use a synthetic "update" change so we can reuse FileDiffViewer / MultiFileDiffView.
        const change: FileUpdateChange = {
            path: file.path,
            // Treat all as updates; kind is only used for labeling.
            // TurnDiff does not carry add/delete metadata directly.
            kind: { type: "update", move_path: null } as any,
            diff: file.diff,
        };
        const label = getChangeKindLabel(change.kind);
        const typeClass = getChangeKindClass(change.kind);
        const parsed = buildDiffPayload(change);

        return {
            id: file.path,
            path: file.path,
            label,
            typeClass,
            additions: parsed.additions,
            deletions: parsed.deletions,
            changes: [change],
        };
    });

    result.sort((a, b) => a.path.localeCompare(b.path));
    return result;
}

function getChangeKindLabel(kind: FileUpdateChange["kind"] | undefined) {
    if (!kind) return "UPDATED";
    if (kind.type === "add") return "NEW";
    if (kind.type === "delete") return "DELETED";
    if (kind.type === "update" && kind.move_path) return "RENAMED";
    return "UPDATED";
}

function getChangeKindClass(kind: FileUpdateChange["kind"] | undefined) {
    if (!kind) return "change-update";
    if (kind.type === "add") return "change-add";
    if (kind.type === "delete") return "change-delete";
    if (kind.type === "update" && kind.move_path) return "change-rename";
    return "change-update";
}

