import type { PluginSummary, SkillMetadata } from "./types";

export type ComposerMentionKind = "skill" | "plugin";

/** Metadata kept for a selected @ resource while it is in the composer. */
export interface ComposerMention {
    kind: ComposerMentionKind;
    name: string;
    path: string;
    token: string;
}

export interface MentionCandidate {
    id: string;
    kind: ComposerMentionKind;
    name: string;
    displayName: string;
    description: string;
    path: string;
    insertText: string;
    source: string;
    searchTerms: string[];
}

export interface MentionToken {
    start: number;
    end: number;
    query: string;
}

const MAX_MENTION_CANDIDATES = 30;

function trimmedString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Find the @ token around the textarea cursor. File paths are intentionally not
 * consulted here: only an @-prefixed word can open the resource picker.
 */
export function findMentionToken(
    value: string,
    cursor: number
): MentionToken | null {
    const position = Math.max(
        0,
        Math.min(value.length, Number.isFinite(cursor) ? cursor : value.length)
    );
    const before = value.slice(0, position);
    const match = before.match(/(?:^|[\s([{])@([^\s]*)$/u);
    if (!match) return null;

    const prefixLength = match[0].startsWith("@") ? 0 : 1;
    const start = position - match[0].length + prefixLength;
    if (start < 0 || value[start] !== "@") return null;

    // Include a suffix when the cursor was moved into an existing token so a
    // completion replaces the whole token rather than splicing into its middle.
    let end = position;
    while (end < value.length && !/[\s,.;!?()[\]{}<>]/u.test(value[end])) {
        end += 1;
    }

    return {
        start,
        end,
        query: value.slice(start + 1, position),
    };
}

/** Turn a resource name into the ASCII-ish token accepted by Codex's @ parser. */
export function mentionTokenName(name: string): string {
    const token = (name || "")
        .trim()
        .replace(/\s+/gu, "-")
        .replace(/[^A-Za-z0-9_:-]/gu, "-")
        .replace(/-{2,}/gu, "-")
        .replace(/^-+|-+$/gu, "");
    return token || "resource";
}

function skillDescription(skill: SkillMetadata): string {
    return (
        trimmedString(skill.interface?.shortDescription) ||
        trimmedString(skill.shortDescription) ||
        trimmedString(skill.description) ||
        ""
    );
}

function pluginDescription(plugin: PluginSummary): string {
    return (
        trimmedString(plugin.interface?.shortDescription) ||
        trimmedString(plugin.interface?.longDescription) ||
        (Array.isArray(plugin.keywords) ? plugin.keywords : [])
            .map((keyword) => trimmedString(keyword))
            .filter(Boolean)
            .join(" ") ||
        "Plugin"
    );
}

function pluginSource(plugin: PluginSummary): string {
    const source = plugin.source;
    if (!source || typeof source !== "object") return "remote catalog";
    if (source.type === "local")
        return trimmedString(source.path) || "local plugin";
    if (source.type === "git") {
        const url = trimmedString(source.url);
        const suffix = trimmedString(source.refName)
            ? ` @ ${source.refName}`
            : "";
        const subdir = trimmedString(source.path) ? ` / ${source.path}` : "";
        return `${url || "git plugin"}${subdir}${suffix}`;
    }
    return "remote catalog";
}

function titleCaseMentionName(name: string): string {
    let result = "";
    let capitalizeNext = true;
    for (const character of name) {
        if (character === "-" || character === "_") {
            capitalizeNext = true;
            result += character;
            continue;
        }
        if (capitalizeNext && /[A-Za-z]/u.test(character)) {
            result += character.toLocaleUpperCase();
            capitalizeNext = false;
        } else {
            result += character;
            capitalizeNext = false;
        }
    }
    return result;
}

function pluginMentionTokenName(
    pluginName: string,
    displayName: string
): string {
    const nameSegments: Array<{ value: string; separator: string | null }> = [];
    let current = "";
    for (const character of pluginName) {
        if (character === "-" || character === "_") {
            if (current) {
                nameSegments.push({ value: current, separator: character });
                current = "";
            }
        } else {
            current += character;
        }
    }
    if (current) nameSegments.push({ value: current, separator: null });

    const displaySegments = displayName.split(/[^A-Za-z0-9]+/u).filter(Boolean);
    if (
        nameSegments.length === displaySegments.length &&
        nameSegments.every(
            (segment, index) =>
                segment.value.toLocaleLowerCase() ===
                displaySegments[index].toLocaleLowerCase()
        )
    ) {
        return nameSegments
            .map(
                (segment, index) =>
                    `${displaySegments[index]}${segment.separator || ""}`
            )
            .join("");
    }

    return titleCaseMentionName(pluginName);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const text = trimmedString(value);
        if (!text) continue;
        const key = text.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(text);
    }
    return result;
}

/** Build the local @ catalog from the official app-server responses. */
export function buildMentionCandidates(
    skills: SkillMetadata[] = [],
    plugins: PluginSummary[] = []
): MentionCandidate[] {
    const candidates: MentionCandidate[] = [];
    const seen = new Set<string>();

    for (const skill of Array.isArray(skills) ? skills : []) {
        const skillName = trimmedString(skill?.name);
        const path = trimmedString(skill?.path);
        if (!skill?.enabled || !path || !skillName) continue;
        const id = `skill:${path}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const displayName =
            trimmedString(skill.interface?.displayName) || skillName;
        const tokenName = mentionTokenName(skillName);
        candidates.push({
            id,
            kind: "skill",
            name: skillName,
            displayName,
            description: skillDescription(skill),
            path,
            insertText: `@${tokenName}`,
            source: path,
            searchTerms: uniqueStrings([
                skillName,
                displayName,
                skill.description,
                skill.shortDescription,
            ]),
        });
    }

    for (const plugin of Array.isArray(plugins) ? plugins : []) {
        // A marketplace entry is not necessarily usable in the current thread.
        // Only installed and enabled plugins are valid structured mentions.
        if (
            !plugin?.installed ||
            !plugin.enabled ||
            plugin.availability === "DISABLED_BY_ADMIN"
        ) {
            continue;
        }
        const pluginId = trimmedString(plugin.id);
        const pluginName = trimmedString(plugin.name);
        if (!pluginId || !pluginName) continue;
        const path = `plugin://${pluginId}`;
        const id = `plugin:${path}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const displayName =
            trimmedString(plugin.interface?.displayName) || pluginName;
        const description = pluginDescription(plugin);
        candidates.push({
            id,
            kind: "plugin",
            // The protocol uses the human-facing plugin name while the path
            // carries the unique marketplace-qualified id.
            name: displayName,
            displayName,
            description,
            path,
            insertText: `@${pluginMentionTokenName(plugin.name, displayName)}`,
            source: pluginSource(plugin),
            searchTerms: uniqueStrings([
                pluginName,
                plugin.id,
                displayName,
                description,
                ...(Array.isArray(plugin.keywords) ? plugin.keywords : []),
            ]),
        });
    }

    return candidates.sort((a, b) => {
        const kindOrder = a.kind === b.kind ? 0 : a.kind === "plugin" ? -1 : 1;
        return (
            kindOrder ||
            a.displayName.localeCompare(b.displayName) ||
            a.id.localeCompare(b.id)
        );
    });
}

function fuzzyScore(value: string, query: string): number | null {
    const haystack = value.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    if (!needle) return 0;
    if (haystack === needle) return 0;
    if (haystack.startsWith(needle)) return 10;
    const includedAt = haystack.indexOf(needle);
    if (includedAt >= 0) return 20 + includedAt;

    let cursor = 0;
    let gaps = 0;
    for (const character of needle) {
        const foundAt = haystack.indexOf(character, cursor);
        if (foundAt < 0) return null;
        gaps += foundAt - cursor;
        cursor = foundAt + 1;
    }
    return 50 + gaps;
}

export function filterMentionCandidates(
    candidates: MentionCandidate[],
    query: string
): MentionCandidate[] {
    const normalizedQuery = (query || "").trim();
    return candidates
        .map((candidate, index) => {
            const scores = candidate.searchTerms
                .map((term) => fuzzyScore(term, normalizedQuery))
                .filter((score): score is number => score !== null);
            if (scores.length === 0) return null;
            return {
                candidate,
                score: Math.min(...scores),
                index,
            };
        })
        .filter(
            (
                entry
            ): entry is {
                candidate: MentionCandidate;
                score: number;
                index: number;
            } => !!entry
        )
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .slice(0, MAX_MENTION_CANDIDATES)
        .map((entry) => entry.candidate);
}

/** Keep only selected bindings whose visible token still exists in the draft. */
export function mentionsPresentInText(
    value: string,
    bindings: ComposerMention[]
): ComposerMention[] {
    const hasToken = (token: string): boolean => {
        if (!token) return false;
        let searchStart = 0;
        while (searchStart < value.length) {
            const start = value.indexOf(token, searchStart);
            if (start < 0) return false;
            const end = start + token.length;
            const before = start > 0 ? value[start - 1] : "";
            const after = end < value.length ? value[end] : "";
            const validBefore = !before || /[\s([{]/u.test(before);
            const validAfter = !after || /[\s\]})>,.!?;:]/u.test(after);
            if (validBefore && validAfter) return true;
            searchStart = start + 1;
        }
        return false;
    };

    const seen = new Set<string>();
    return bindings.filter((binding) => {
        if (!hasToken(binding.token)) return false;
        const key = `${binding.kind}:${binding.path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
