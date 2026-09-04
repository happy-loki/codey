<script lang="ts">
    import type { Turn, ThreadItem, FileUpdateChange, TokenUsageBreakdown, CommandAction } from "./types";
    import ThreadItemCard from "./ThreadItemCard.svelte";
    import TurnStatusIndicator from "./TurnStatusIndicator.svelte";
    import { createVirtualizer } from "@tanstack/svelte-virtual";
    import { get } from "svelte/store";
	    import MultiFileDiffView from "./MultiFileDiffView.svelte";
	    import {
	        Bot,
	        Brain,
	        ClipboardList,
	        ExternalLink,
	        FileEdit,
	        FileSearch,
	        FileText,
	        FoldVertical,
	        FolderTree,
	        GitBranch,
	        Globe2,
	        Image,
	        ListTodo,
	        MessageSquare,
	        PauseCircle,
	        Search,
	        SquareTerminal,
	        Wrench,
	    } from "lucide-svelte";
	    import type { TurnDiffFileSummary } from "./diffUtils";
	    import {
	        buildFileChangeSummaryFromTurnDiff,
	        type FileChangeSummaryEntry,
	    } from "./fileChangeSummaryUtils";
	    import { openViewAllChangesTab } from "./viewAllChangesHost";
    import ProcessingPlaceholder from "./ProcessingPlaceholder.svelte";
    import type { CostBreakdown } from "./pricing";

    /**
     * 以 ThreadItem 为粒度的扁平化 + 虚拟列表组件。
     * 这里只关心“按顺序把所有行展示出来”，不做折叠。
     * 每个 turn 展开为：
     *   - 一行简单的 Turn 头部（status 行）
     *   - 若干 ThreadItem 行（userMessage、process items、final agent、todoList）
     */

    import { createEventDispatcher } from "svelte";

    export let turns: Turn[] = [];
    export let scrollElement: HTMLDivElement | null = null;
    // 折叠状态：key 为 groupId，value 为是否展开（默认展开）
    export let groupExpanded: Record<string, boolean> = {};
    // 当前正在执行的步骤 itemId（用于高亮对应菱形）
    export let currentItemId: string | null = null;
    // 每个 turn 的 diff 摘要（来自 ChatView 的 turnDiffs）
    export let turnDiffs: Record<
        string,
        {
            unifiedDiff: string;
            files: TurnDiffFileSummary[];
        }
    > = {};
    // 是否在列表底部附加一个 processing footer（ProcessingPlaceholder）
    export let hasProcessingFooter: boolean = false;
    export let processingHeader: string | null = null;
    export let processingPinned: boolean = false;
    export let processingElapsedSeconds: number | null = null;
    // Latest turn id that has an undo snapshot available (may be null).
    export let undoTurnId: string | null = null;
    export let turnTokenStats: Record<
        string,
        { usage: TokenUsageBreakdown; cost: CostBreakdown | null; model: string | null }
    > = {};
    // If set, we treat the matching item card as "streaming" to avoid heavy rendering work.
    // (The parent ChatView owns the streaming state; we only decorate the card.)
    export let streamingItemId: string | null = null;
    // Workspace directory used to resolve relative media references in chat Markdown.
    export let mediaBaseDir: string | null = null;

    type StatusRow = {
        kind: "status";
        key: string;
        turnId: string;
        turnIndex: number;
        status: Turn["status"] | null | undefined;
        isFinished: boolean;
        stepsGroupId: string | null;
        stepsCount: number;
    };

    type ItemRow = {
        kind: "item";
        key: string;
        turnId: string;
        turnIndex: number;
        itemIndex: number;
        item: ThreadItem;
        sourceItemId: string | null;
        groupId: string | null;
        isGroupHeader: boolean;
        groupSize: number;
        isGroupTail: boolean;
        isReviewPrompt: boolean;
    };

    type FileSummaryRow = {
        kind: "fileSummary";
        key: string;
        turnId: string;
        turnIndex: number;
        summary: FileChangeSummaryEntry[];
        totals: { added: number; deleted: number };
        changes: FileUpdateChange[];
    };

    type UsageRow = {
        kind: "usage";
        key: string;
        turnId: string;
        usage: TokenUsageBreakdown;
        cost: CostBreakdown | null;
        model: string | null;
        durationMs: number | null;
    };

    type FlatRow = StatusRow | ItemRow | FileSummaryRow | UsageRow;

    let allRows: FlatRow[] = [];
    let flatRows: FlatRow[] = [];
    const fileSummaryRowCache = new Map<string, { unifiedDiff: string; row: FileSummaryRow | null }>();
    const turnRowCache = new Map<string, { signature: string; rows: FlatRow[] }>();
    const commandActionCache = new Map<
        string,
        { fingerprint: string; actions: ParsedCommandAction[] }
    >();
    const itemObjectIdentity = new WeakMap<object, number>();
    let nextItemObjectIdentity = 1;

    function getItemObjectIdentity(item: ThreadItem): number {
        const object = item as object;
        const existing = itemObjectIdentity.get(object);
        if (existing) return existing;
        const identity = nextItemObjectIdentity++;
        itemObjectIdentity.set(object, identity);
        return identity;
    }

    function getTurnStructureSignature(turn: Turn, turnIndex: number): string {
        const items = turn.items ?? [];
        const tokenStats = turnTokenStats[turn.id];
        const diff = turnDiffs[turn.id];
        return [
            turn.id,
            turnIndex,
            turn.status ?? "",
            diff?.unifiedDiff ?? "",
            tokenStats
                ? JSON.stringify({ usage: tokenStats.usage, cost: tokenStats.cost, model: tokenStats.model })
                : "",
            items
                .map((item) => {
                    const textPresence =
                        item.type === "agentMessage"
                            ? item.text?.trim().length > 0
                            : item.type === "reasoning"
                              ? hasReasoningContent(item)
                              : false;
                    const contentLength =
                        item.type === "agentMessage" || item.type === "plan"
                            ? item.text?.length ?? 0
                            : item.type === "reasoning"
                              ? [
                                    ...(item.content ?? []),
                                    ...((item.summary ?? []) as string[]),
                                ].reduce((total, value) => total + (value?.length ?? 0), 0)
                              : item.type === "todoList"
                                ? (item.items ?? []).reduce(
                                      (total, task) => total + (task.text?.length ?? 0),
                                      0
                                  )
                                : 0;
                    return [
                        getItemObjectIdentity(item),
                        item.id,
                        item.type,
                        (item as any).status ?? "",
                        textPresence ? "text" : "empty",
                        contentLength,
                        item.type === "commandExecution" ? (item.command ?? "") : "",
                        item.type === "commandExecution" ? (item.cwd ?? "") : "",
                    ].join("\u0001");
                })
                .join("\u0002"),
        ].join("\u0003");
    }

    function hasReasoningContent(item: Extract<ThreadItem, { type: "reasoning" }>) {
        const hasContent = item.content?.some((text) => text?.trim().length > 0);
        const summaryBody = (item as any).reasoningSummaryBody;
        const hasSummaryBody = typeof summaryBody === "string" && summaryBody.trim().length > 0;
        return Boolean(hasContent || hasSummaryBody);
    }

    function shouldHideItem(item: ThreadItem) {
        if (item.type === "reasoning") {
            return !hasReasoningContent(item as any);
        }
        return false;
    }

    function tokenizeShellCommand(command: string): string[] {
        const tokens: string[] = [];
        let current = "";
        let quote: '"' | "'" | null = null;

        for (let i = 0; i < command.length; i += 1) {
            const char = command[i];
            if (quote) {
                if (char === quote) {
                    quote = null;
                } else {
                    current += char;
                }
                continue;
            }

            if (char === '"' || char === "'") {
                quote = char;
                continue;
            }

            if (/\s/.test(char)) {
                if (current) {
                    tokens.push(current);
                    current = "";
                }
                continue;
            }

            current += char;
        }

        if (current) tokens.push(current);
        return tokens;
    }

    function getExecutableName(executable: string | null | undefined): string {
        if (!executable) return "";
        return executable.split(/[/\\]/).pop()?.toLowerCase() || executable.toLowerCase();
    }

    function isPowerShellExecutable(executable: string | null | undefined): boolean {
        const name = getExecutableName(executable);
        return name === "powershell" || name === "powershell.exe" || name === "pwsh" || name === "pwsh.exe";
    }

    function isCmdExecutable(executable: string | null | undefined): boolean {
        const name = getExecutableName(executable);
        return name === "cmd" || name === "cmd.exe";
    }

    function isPosixShellExecutable(executable: string | null | undefined): boolean {
        const name = getExecutableName(executable);
        return ["bash", "bash.exe", "zsh", "zsh.exe", "sh", "sh.exe"].includes(name);
    }

    function extractShellWrappedCommand(command: string): string {
        const tokens = tokenizeShellCommand(command);
        if (tokens.length < 2) return command.trim();

        if (isPosixShellExecutable(tokens[0])) {
            const commandIndex = tokens.findIndex((token) =>
                ["-c", "-lc"].includes(token.toLowerCase())
            );
            if (commandIndex >= 0 && commandIndex < tokens.length - 1) {
                return tokens.slice(commandIndex + 1).join(" ").trim();
            }
        }

        if (isPowerShellExecutable(tokens[0])) {
            const commandIndex = tokens.findIndex((token) =>
                ["-command", "-c", "/c"].includes(token.toLowerCase())
            );
            if (commandIndex >= 0 && commandIndex < tokens.length - 1) {
                return tokens.slice(commandIndex + 1).join(" ").trim();
            }
        }

        if (isCmdExecutable(tokens[0])) {
            const commandIndex = tokens.findIndex((token) => token.toLowerCase() === "/c");
            if (commandIndex >= 0 && commandIndex < tokens.length - 1) {
                return tokens.slice(commandIndex + 1).join(" ").trim();
            }
        }

        return command.trim();
    }

    type LineRange = {
        startLine: number | null;
        endLine: number | null;
    };

    type ReadCommandAction = Extract<CommandAction, { type: "read" }>;
    type ParsedReadCommandAction = ReadCommandAction & LineRange;
    type ParsedCommandAction =
        | ParsedReadCommandAction
        | Extract<CommandAction, { type: "listFiles" }>
        | Extract<CommandAction, { type: "search" }>
        | Extract<CommandAction, { type: "unknown" }>;

    type ShellSegment = {
        text: string;
        connectorAfter: "|" | "&&" | "||" | ";" | null;
    };

    function findOptionValue(tokens: string[], names: string[]): string | null {
        const normalized = names.map((name) => name.toLowerCase());
        for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i].toLowerCase();
            if (normalized.includes(token) && i < tokens.length - 1) {
                return tokens[i + 1] || null;
            }
            const equalIndex = token.indexOf("=");
            if (equalIndex > 0 && normalized.includes(token.slice(0, equalIndex))) {
                return tokens[i].slice(equalIndex + 1) || null;
            }
            const colonIndex = token.indexOf(":");
            if (colonIndex > 0 && normalized.includes(token.slice(0, colonIndex))) {
                return tokens[i].slice(colonIndex + 1) || null;
            }
        }
        return null;
    }

    function getPositionalArgs(tokens: string[], optionsWithValues: string[] = []): string[] {
        const result: string[] = [];
        const valueOptions = new Set(optionsWithValues.map((option) => option.toLowerCase()));
        let afterDoubleDash = false;

        for (let i = 1; i < tokens.length; i += 1) {
            const token = tokens[i];
            if (!token) continue;
            if (afterDoubleDash) {
                result.push(token);
                continue;
            }
            if (token === "--") {
                afterDoubleDash = true;
                continue;
            }
            if (token.startsWith("-")) {
                const lower = token.toLowerCase();
                if (valueOptions.has(lower) && !token.includes("=")) {
                    i += 1;
                }
                continue;
            }
            result.push(token);
        }
        return result;
    }

    function getFirstPositionalArg(tokens: string[], optionsWithValues: string[] = []): string | null {
        return getPositionalArgs(tokens, optionsWithValues)[0] ?? null;
    }

    function normalizeCommandActionPath(path: string | null | undefined): string | null {
        if (!path) return null;
        const trimmed = path.trim();
        if (!trimmed || /^-\w+/.test(trimmed) || /^\d+$/.test(trimmed)) return null;

        // A shell variable is not a concrete file path. In particular, PowerShell
        // scripts commonly use `Get-Content $f` inside a loop; rendering `$f` as a
        // read card creates a misleading pseudo-file (and can attach line ranges to it).
        // Keep the original command card when the variable cannot be resolved safely.
        if (
            /^(?:\$(?:\{[^}]+\}|[A-Za-z_][\w:.-]*(?:\[[^\]]+\])?|_)|%[^%]+%|![^!]+!|\$\()/.test(
                trimmed
            )
        ) {
            return null;
        }
        return trimmed;
    }

    function splitCommaPaths(value: string | null): string[] {
        if (!value) return [];
        return value
            .split(",")
            .map((part) => normalizeCommandActionPath(part))
            .filter((part): part is string => Boolean(part));
    }

    function splitShellSegments(command: string): ShellSegment[] {
        const segments: ShellSegment[] = [];
        let current = "";
        let quote: '"' | "'" | null = null;
        let escaped = false;

        const push = (connectorAfter: ShellSegment["connectorAfter"]) => {
            const text = current.trim();
            if (text) {
                segments.push({ text, connectorAfter });
            } else if (segments.length > 0) {
                segments[segments.length - 1].connectorAfter = connectorAfter;
            }
            current = "";
        };

        for (let i = 0; i < command.length; i += 1) {
            const char = command[i];

            if (escaped) {
                current += char;
                escaped = false;
                continue;
            }

            if (quote) {
                if (char === "\\" && quote === '"') {
                    current += char;
                    escaped = true;
                    continue;
                }
                current += char;
                if (char === quote) {
                    quote = null;
                }
                continue;
            }

            if (char === '"' || char === "'") {
                quote = char;
                current += char;
                continue;
            }

            if (char === "|") {
                if (command[i + 1] === "|") {
                    push("||");
                    i += 1;
                } else {
                    push("|");
                }
                continue;
            }

            if (char === "&" && command[i + 1] === "&") {
                push("&&");
                i += 1;
                continue;
            }

            if (char === ";") {
                push(";");
                continue;
            }

            current += char;
        }

        push(null);
        return segments;
    }

    function parsePositiveLineNumber(value: string | null | undefined): number | null {
        if (!value) return null;
        const normalized = value.trim().replace(/^['"]|['"]$/g, "");
        if (!/^\+?\d+$/.test(normalized)) return null;
        const number = Number(normalized.replace(/^\+/, ""));
        if (!Number.isFinite(number) || number < 1) return null;
        return Math.floor(number);
    }

    function parseNonNegativeInteger(value: string | null | undefined): number | null {
        if (!value) return null;
        const normalized = value.trim().replace(/^['"]|['"]$/g, "");
        if (!/^\d+$/.test(normalized)) return null;
        const number = Number(normalized);
        if (!Number.isFinite(number) || number < 0) return null;
        return Math.floor(number);
    }

    function normalizeLineRange(startLine: number | null, endLine: number | null): LineRange | null {
        if (startLine === null && endLine === null) return null;
        const start = startLine ?? 1;
        const end = endLine === null ? null : Math.max(start, endLine);
        return { startLine: start, endLine: end };
    }

    function mergeLineRanges(primary: LineRange | null, fallback: LineRange | null): LineRange | null {
        if (primary && (primary.startLine !== null || primary.endLine !== null)) return primary;
        return fallback;
    }

    function parseSedRangeToken(token: string | null | undefined): LineRange | null {
        if (!token) return null;
        const script = token.trim().replace(/^['"]|['"]$/g, "");
        const direct = script.match(/^(\d+)(?:,(\d+|\$|\+?\d+))?p$/);
        if (direct) {
            const start = parsePositiveLineNumber(direct[1]);
            let end: number | null = null;
            if (direct[2] && direct[2] !== "$") {
                if (direct[2].startsWith("+") && start !== null) {
                    const count = parsePositiveLineNumber(direct[2]);
                    end = count === null ? null : start + count;
                } else {
                    end = parsePositiveLineNumber(direct[2]);
                }
            }
            return normalizeLineRange(start, end);
        }

        const guarded = script.match(/(?:^|[^\w])(\d+)\s*,\s*(\d+)\s*(?:p|\{)/);
        if (guarded) {
            return normalizeLineRange(
                parsePositiveLineNumber(guarded[1]),
                parsePositiveLineNumber(guarded[2])
            );
        }

        return null;
    }

    function parseSedLineRange(tokens: string[]): LineRange | null {
        if (!tokens.some((token) => token.toLowerCase() === "-n")) return null;
        for (let i = 1; i < tokens.length; i += 1) {
            const token = tokens[i];
            if (!token) continue;
            if (["-e", "--expression"].includes(token.toLowerCase())) {
                const range = parseSedRangeToken(tokens[i + 1]);
                if (range) return range;
                i += 1;
                continue;
            }
            const range = parseSedRangeToken(token);
            if (range) return range;
        }
        return null;
    }

    function getSedReadPath(tokens: string[]): string | null {
        if (!parseSedLineRange(tokens)) return null;
        const operands = getPositionalArgs(tokens, ["-e", "--expression", "-f", "--file"]);
        const rangeIndex = operands.findIndex((operand) => Boolean(parseSedRangeToken(operand)));
        if (rangeIndex >= 0) {
            return normalizeCommandActionPath(operands[rangeIndex + 1]) ?? null;
        }
        return normalizeCommandActionPath(operands[0]);
    }

    function parseHeadLineRange(tokens: string[]): LineRange | null {
        for (let i = 1; i < tokens.length; i += 1) {
            const token = tokens[i];
            const lower = token.toLowerCase();
            let count: number | null = null;
            if (lower === "-n" || lower === "--lines") {
                count = parsePositiveLineNumber(tokens[i + 1]);
            } else if (lower.startsWith("-n")) {
                count = parsePositiveLineNumber(token.slice(2));
            } else if (lower.startsWith("--lines=")) {
                count = parsePositiveLineNumber(token.slice("--lines=".length));
            } else if (/^-\d+$/.test(token)) {
                count = parsePositiveLineNumber(token.slice(1));
            }
            if (count !== null) {
                return { startLine: 1, endLine: count };
            }
        }
        return null;
    }

    function parseTailLineRange(tokens: string[]): LineRange | null {
        for (let i = 1; i < tokens.length; i += 1) {
            const token = tokens[i];
            const lower = token.toLowerCase();
            let value: string | null = null;
            if (lower === "-n" || lower === "--lines") {
                value = tokens[i + 1] ?? null;
            } else if (lower.startsWith("-n")) {
                value = token.slice(2);
            } else if (lower.startsWith("--lines=")) {
                value = token.slice("--lines=".length);
            }
            if (value?.startsWith("+")) {
                return normalizeLineRange(parsePositiveLineNumber(value), null);
            }
        }
        return null;
    }

    function parseBatLineRange(tokens: string[]): LineRange | null {
        const value = findOptionValue(tokens, ["--line-range", "-r"]);
        if (!value) return null;
        const normalized = value.trim();
        const colon = normalized.match(/^(\d+)?:(\d+)?$/);
        if (colon) {
            return normalizeLineRange(
                parsePositiveLineNumber(colon[1] ?? null),
                parsePositiveLineNumber(colon[2] ?? null)
            );
        }
        const dash = normalized.match(/^(\d+)-(\d+)$/);
        if (dash) {
            return normalizeLineRange(parsePositiveLineNumber(dash[1]), parsePositiveLineNumber(dash[2]));
        }
        const single = parsePositiveLineNumber(normalized);
        return single === null ? null : { startLine: single, endLine: single };
    }

    function parseAwkLineRange(tokens: string[]): LineRange | null {
        const operands = getPositionalArgs(tokens, ["-F", "-v", "-f", "--field-separator", "--assign", "--file"]);
        const script = operands[0] ?? "";
        const between = script.match(/NR\s*>=\s*(\d+)[\s\S]*NR\s*<=\s*(\d+)/);
        if (between) {
            return normalizeLineRange(parsePositiveLineNumber(between[1]), parsePositiveLineNumber(between[2]));
        }
        const equality = script.match(/NR\s*==\s*(\d+)/);
        if (equality) {
            const line = parsePositiveLineNumber(equality[1]);
            return line === null ? null : { startLine: line, endLine: line };
        }
        const lowerBound = script.match(/NR\s*>=\s*(\d+)/);
        if (lowerBound) {
            return normalizeLineRange(parsePositiveLineNumber(lowerBound[1]), null);
        }
        return null;
    }

    function parseSelectObjectLineRange(tokens: string[]): LineRange | null {
        const skip = parsePositiveLineNumber(findOptionValue(tokens, ["-skip"]));
        const first = parsePositiveLineNumber(findOptionValue(tokens, ["-first"]));
        const index = findOptionValue(tokens, ["-index"]);

        if (index) {
            const range = index.match(/^(\d+)\.\.(\d+)$/);
            if (range) {
                const startIndex = parseNonNegativeInteger(range[1]);
                const endIndex = parseNonNegativeInteger(range[2]);
                return normalizeLineRange(
                    startIndex === null ? null : startIndex + 1,
                    endIndex === null ? null : endIndex + 1
                );
            }
            const single = parseNonNegativeInteger(index);
            if (single !== null) {
                return { startLine: single + 1, endLine: single + 1 };
            }
        }

        if (skip !== null || first !== null) {
            const start = (skip ?? 0) + 1;
            return {
                startLine: start,
                endLine: first === null ? null : start + first - 1,
            };
        }

        return null;
    }

    function getAwkReadPath(tokens: string[]): string | null {
        const hasScriptFile = tokens.some((token) => {
            const lower = token.toLowerCase();
            return lower === "-f" || lower === "--file" || lower.startsWith("--file=");
        });
        const operands = getPositionalArgs(tokens, ["-F", "-v", "-f", "--field-separator", "--assign", "--file"]);
        if (hasScriptFile) {
            return normalizeCommandActionPath(operands[0]);
        }
        return normalizeCommandActionPath(operands[1] ?? null);
    }

    function parsePowerShellGetContentLineRange(tokens: string[]): LineRange | null {
        const total = parsePositiveLineNumber(
            findOptionValue(tokens, ["-totalcount", "-head", "-first"])
        );
        if (total !== null) {
            return { startLine: 1, endLine: total };
        }
        return null;
    }

    function getReadPathFromTokens(tokens: string[], executable: string): string | null {
        if (["get-content", "gc", "type", "cat"].includes(executable)) {
            const path =
                findOptionValue(tokens, ["-path", "-literalpath"]) ||
                getFirstPositionalArg(tokens, [
                    "-path",
                    "-literalpath",
                    "-encoding",
                    "-tail",
                    "-head",
                    "-totalcount",
                    "-first",
                    "-last",
                    "-readcount",
                    "-delimiter",
                    "-stream",
                    "-exclude",
                    "-include",
                    "-filter",
                ]);
            return normalizeCommandActionPath(path);
        }
        if (executable === "head") {
            return normalizeCommandActionPath(
                getFirstPositionalArg(tokens, ["-n", "--lines", "-c", "--bytes"])
            );
        }
        if (executable === "tail") {
            return normalizeCommandActionPath(
                getFirstPositionalArg(tokens, ["-n", "--lines", "-c", "--bytes"])
            );
        }
        if (executable === "less") {
            return normalizeCommandActionPath(
                getFirstPositionalArg(tokens, [
                    "-p",
                    "-P",
                    "-x",
                    "-y",
                    "-z",
                    "-j",
                    "--pattern",
                    "--prompt",
                    "--tabs",
                    "--shift",
                    "--jump-target",
                ])
            );
        }
        if (["bat", "batcat"].includes(executable)) {
            return normalizeCommandActionPath(
                getFirstPositionalArg(tokens, [
                    "--theme",
                    "--language",
                    "--style",
                    "--terminal-width",
                    "--tabs",
                    "--line-range",
                    "-r",
                    "--map-syntax",
                ])
            );
        }
        if (executable === "more" || executable === "nl") {
            return normalizeCommandActionPath(
                getFirstPositionalArg(tokens, ["-s", "-w", "-v", "-i", "-b"])
            );
        }
        if (executable === "awk") {
            return getAwkReadPath(tokens);
        }
        if (executable === "sed") {
            return getSedReadPath(tokens);
        }
        return null;
    }

    function getListPathFromTokens(tokens: string[], executable: string): string | null {
        const explicitPath = findOptionValue(tokens, ["-path", "-literalpath"]);
        if (explicitPath) return normalizeCommandActionPath(explicitPath);

        const optionsWithValues =
            executable === "ls" || executable === "dir" || executable === "get-childitem" || executable === "gci"
                ? [
                      "-path",
                      "-literalpath",
                      "-filter",
                      "-include",
                      "-exclude",
                      "-depth",
                      "-I",
                      "-w",
                      "--block-size",
                      "--format",
                      "--time-style",
                      "--color",
                      "--quoting-style",
                  ]
                : executable === "eza" || executable === "exa"
                    ? [
                          "-I",
                          "--ignore-glob",
                          "--color",
                          "--sort",
                          "--time-style",
                          "--time",
                      ]
                    : executable === "tree"
                        ? ["-L", "-P", "-I", "--charset", "--filelimit", "--sort"]
                        : executable === "du"
                            ? ["-d", "--max-depth", "-B", "--block-size", "--exclude", "--time-style"]
                            : [];

        return normalizeCommandActionPath(getFirstPositionalArg(tokens, optionsWithValues));
    }

    function parseLineRangeFromReadTokens(tokens: string[], executable: string): LineRange | null {
        if (["head"].includes(executable)) return parseHeadLineRange(tokens);
        if (["tail"].includes(executable)) return parseTailLineRange(tokens);
        if (["sed"].includes(executable)) return parseSedLineRange(tokens);
        if (["bat", "batcat"].includes(executable)) return parseBatLineRange(tokens);
        if (["awk"].includes(executable)) return parseAwkLineRange(tokens);
        if (["get-content", "gc"].includes(executable)) return parsePowerShellGetContentLineRange(tokens);
        return null;
    }

    function parsePipelineFormatterLineRange(tokens: string[], executable: string): LineRange | null {
        if (executable === "sed") return parseSedLineRange(tokens);
        if (executable === "head") return parseHeadLineRange(tokens);
        if (["select-object", "select"].includes(executable)) return parseSelectObjectLineRange(tokens);
        return null;
    }

    function findPipelineLineRange(segments: ShellSegment[], segmentIndex: number): LineRange | null {
        for (let i = segmentIndex + 1; i < segments.length; i += 1) {
            if (segments[i - 1]?.connectorAfter !== "|") return null;
            const tokens = tokenizeShellCommand(segments[i].text);
            const executable = getExecutableName(tokens[0]);
            const range = parsePipelineFormatterLineRange(tokens, executable);
            if (range) return range;
        }
        return null;
    }

    const isWindowsHost =
        typeof navigator !== "undefined" &&
        (/\bWindows\b/i.test(navigator.userAgent || "") ||
            /\bWin/i.test(navigator.platform || ""));

    function isWindowsPathContext(path: string | null | undefined): boolean {
        return Boolean(path && (/^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]{2}/.test(path)));
    }

    function convertSlashDrivePath(path: string, cwd?: string | null): string {
        if (!isWindowsHost && !isWindowsPathContext(cwd)) {
            return path;
        }
        const wsl = path.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
        if (wsl) {
            return `${wsl[1].toUpperCase()}:/${wsl[2]}`;
        }
        const msys = path.match(/^\/([a-zA-Z])\/(.*)$/);
        if (msys) {
            return `${msys[1].toUpperCase()}:/${msys[2]}`;
        }
        return path;
    }

    function parseFileUriPath(path: string): string | null {
        if (!/^file:/i.test(path)) return null;
        try {
            const url = new URL(path);
            let pathname = decodeURIComponent(url.pathname || "");
            if (url.host && url.host !== "localhost") {
                pathname = `//${url.host}${pathname}`;
            }
            if (/^\/[a-zA-Z]:/.test(pathname)) {
                pathname = pathname.slice(1);
            }
            return pathname;
        } catch {
            return path.replace(/^file:\/\//i, "");
        }
    }

    function isAbsoluteCommandPath(path: string): boolean {
        return (
            /^[a-zA-Z]:[\\/]/.test(path) ||
            /^[\\/]{2}/.test(path) ||
            path.startsWith("/") ||
            path.startsWith("~")
        );
    }

    function normalizeEmbeddedWindowsAbsolutePath(path: string): string {
        let normalized = path.trim();

        // Shells sometimes preserve a relative-looking prefix before an absolute
        // drive path (for example `.\\D:\\repo\\file`). It must not be joined to cwd.
        normalized = normalized.replace(/^(?:\.[\\/]|[\\/])(?=[a-zA-Z]:[\\/])/, "");

        // Guard against paths that were already joined once by a producer:
        // `D:\\repo\\D:\\repo\\file` should resolve to the second drive path.
        const driveMatches = Array.from(normalized.matchAll(/[a-zA-Z]:[\\/]/g));
        if (driveMatches.length > 1) {
            const secondDriveIndex = driveMatches[1].index ?? -1;
            if (secondDriveIndex > 0 && /[\\/]$/.test(normalized.slice(0, secondDriveIndex))) {
                normalized = normalized.slice(secondDriveIndex);
            }
        }

        return normalized;
    }

    function normalizeJoinedPath(path: string): string {
        if (/^[\\/]{2}/.test(path)) return path;
        const slashPath = path.replace(/\\/g, "/");
        const drive = slashPath.match(/^([a-zA-Z]:)\/?(.*)$/);
        const absolute = slashPath.startsWith("/");
        const prefix = drive ? `${drive[1]}/` : absolute ? "/" : "";
        const rest = drive ? drive[2] || "" : absolute ? slashPath.slice(1) : slashPath;
        const parts: string[] = [];

        for (const part of rest.split("/")) {
            if (!part || part === ".") continue;
            if (part === "..") {
                if (parts.length > 0 && parts[parts.length - 1] !== "..") {
                    parts.pop();
                } else if (!prefix) {
                    parts.push(part);
                }
                continue;
            }
            parts.push(part);
        }

        return `${prefix}${parts.join("/")}`;
    }

    function resolveCommandActionPath(path: string | null | undefined, cwd: string | null | undefined): string | null {
        const normalized = normalizeCommandActionPath(path);
        if (!normalized) return null;
        const fileUriPath = parseFileUriPath(normalized);
        const pathValue = convertSlashDrivePath(
            normalizeEmbeddedWindowsAbsolutePath(fileUriPath ?? normalized),
            cwd
        );
        if (isAbsoluteCommandPath(pathValue) || !cwd) {
            return normalizeJoinedPath(pathValue);
        }
        const base = convertSlashDrivePath(cwd.trim(), cwd).replace(/[\\/]+$/, "");
        const relative = pathValue.replace(/^[.][\\/]/, "");
        return normalizeJoinedPath(`${base}/${relative}`);
    }

    function getCdTarget(tokens: string[]): string | null {
        if (getExecutableName(tokens[0]) !== "cd") return null;
        const operands = getPositionalArgs(tokens, ["-L", "-P"]);
        return normalizeCommandActionPath(operands[operands.length - 1] ?? null);
    }

    function getPathName(path: string): string {
        return path.split(/[/\\]/).filter(Boolean).pop() || path;
    }

    function createParsedReadAction(
        command: string,
        path: string | null,
        item: Extract<ThreadItem, { type: "commandExecution" }>,
        range: LineRange | null,
        cwdOverride?: string | null
    ): ParsedReadCommandAction | null {
        const resolvedPath = resolveCommandActionPath(path, cwdOverride ?? item.cwd);
        if (!resolvedPath) return null;
        return {
            type: "read",
            command,
            name: getPathName(path || resolvedPath),
            path: resolvedPath,
            startLine: range?.startLine ?? null,
            endLine: range?.endLine ?? null,
        };
    }

    function pathComparable(value: string | null | undefined): string {
        return (value || "").replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
    }

    function pathLooksLikeSameFile(candidate: string | null, expected: string | null | undefined): boolean {
        if (!candidate || !expected) return true;
        const candidateKey = pathComparable(candidate);
        const expectedKey = pathComparable(expected);
        if (!candidateKey || !expectedKey) return true;
        return (
            candidateKey === expectedKey ||
            candidateKey.endsWith(`/${expectedKey}`) ||
            expectedKey.endsWith(`/${candidateKey}`) ||
            ((!candidateKey.includes("/") || !expectedKey.includes("/")) &&
                getPathName(candidateKey) === getPathName(expectedKey))
        );
    }

    function inferReadLineRangeFromCommand(
        command: string,
        expectedPath: string | null | undefined
    ): LineRange | null {
        const displayCommand = extractShellWrappedCommand(command || "");
        if (!displayCommand) return null;

        const segments = splitShellSegments(displayCommand);
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
            const segment = segments[segmentIndex];
            const tokens = tokenizeShellCommand(segment.text);
            const executable = getExecutableName(tokens[0]);
            if (!["get-content", "gc", "cat", "type", "more", "less", "head", "tail", "nl", "bat", "batcat", "awk", "sed"].includes(executable)) {
                continue;
            }

            const path = getReadPathFromTokens(tokens, executable);
            if (!pathLooksLikeSameFile(path, expectedPath)) continue;

            const range = mergeLineRanges(
                parseLineRangeFromReadTokens(tokens, executable),
                findPipelineLineRange(segments, segmentIndex)
            );
            if (range) return range;
        }

        return null;
    }

    const RIPGREP_OPTIONS_WITH_VALUES = new Set([
        "-A",
        "-B",
        "-C",
        "-E",
        "-M",
        "-e",
        "-f",
        "-g",
        "-m",
        "-t",
        "-T",
        "--after-context",
        "--before-context",
        "--colors",
        "--context",
        "--context-separator",
        "--crlf",
        "--dfa-size-limit",
        "--encoding",
        "--engine",
        "--field-context-separator",
        "--field-match-separator",
        "--file",
        "--glob",
        "--glob-case-insensitive",
        "--heading",
        "--iglob",
        "--json-path",
        "--max-columns",
        "--max-count",
        "--max-depth",
        "--max-filesize",
        "--multiline-dotall",
        "--path-separator",
        "--pre",
        "--regex-size-limit",
        "--regexp",
        "--replace",
        "--sort",
        "--sort-files",
        "--sortr",
        "--threads",
        "--trim",
        "--type",
        "--type-add",
        "--type-clear",
        "--type-not",
    ]);

    function collectRipgrepPositionals(tokens: string[]): string[] {
        const positionals: string[] = [];
        for (let i = 1; i < tokens.length; i += 1) {
            const token = tokens[i];
            if (!token) continue;
            if (token === "--") {
                positionals.push(...tokens.slice(i + 1));
                break;
            }
            if (token.startsWith("--") && token.includes("=")) {
                continue;
            }
            if (RIPGREP_OPTIONS_WITH_VALUES.has(token)) {
                i += 1;
                continue;
            }
            if (token.startsWith("-")) {
                continue;
            }
            positionals.push(token);
        }
        return positionals;
    }

    function getRipgrepPattern(tokens: string[], positionals: string[]): string | null {
        const pattern = findOptionValue(tokens, ["-e", "--regexp"]);
        return pattern || positionals[0] || null;
    }

    function parseCommandActionsFromShellUncached(
        item: Extract<ThreadItem, { type: "commandExecution" }>
    ): ParsedCommandAction[] {
        const explicitActions = (item.commandActions ?? [])
            .filter((action) => action.type !== "unknown")
            .map((action) => enrichCommandActionFromShell(action, item))
            .filter((action) => action.type !== "read" || Boolean(normalizeCommandActionPath(action.path)));
        if (explicitActions.length > 0) {
            return explicitActions;
        }

        const displayCommand = extractShellWrappedCommand(item.command || "");
        if (!displayCommand) return [];

        const actions: ParsedCommandAction[] = [];
        const segments = splitShellSegments(displayCommand);
        let effectiveCwd: string | null | undefined = item.cwd;

        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
            const segment = segments[segmentIndex];
            const tokens = tokenizeShellCommand(segment.text);
            const executable = getExecutableName(tokens[0]);
            if (!executable) continue;

            const cdTarget = getCdTarget(tokens);
            if (cdTarget) {
                effectiveCwd = resolveCommandActionPath(cdTarget, effectiveCwd) ?? effectiveCwd;
                continue;
            }

            if (["get-content", "gc", "cat", "type", "more", "less", "head", "tail", "nl", "bat", "batcat", "awk", "sed"].includes(executable)) {
                const path = getReadPathFromTokens(tokens, executable);
                const lineRange = mergeLineRanges(
                    parseLineRangeFromReadTokens(tokens, executable),
                    findPipelineLineRange(segments, segmentIndex)
                );
                const readAction = createParsedReadAction(
                    segment.text,
                    path,
                    item,
                    lineRange,
                    effectiveCwd
                );
                if (readAction) {
                    actions.push(readAction);
                }
                continue;
            }

            if (["get-childitem", "gci", "dir", "ls", "eza", "exa", "tree", "du", "fd", "find"].includes(executable)) {
                const rawPath = getListPathFromTokens(tokens, executable);
                const paths = splitCommaPaths(rawPath);
                const targets = paths.length ? paths : [null];
                for (const path of targets) {
                    actions.push({
                        type: "listFiles",
                        command: segment.text,
                        path: path ? resolveCommandActionPath(path, effectiveCwd) ?? path : null,
                    });
                }
                continue;
            }

            if (["select-string", "sls", "grep", "egrep", "fgrep", "ag", "ack", "pt"].includes(executable)) {
                const query =
                    findOptionValue(tokens, ["-pattern", "-e", "--regexp"]) ||
                    getFirstPositionalArg(tokens);
                const path = normalizeCommandActionPath(
                    findOptionValue(tokens, ["-path", "-literalpath"])
                );
                actions.push({
                    type: "search",
                    command: segment.text,
                    path: path ? resolveCommandActionPath(path, effectiveCwd) ?? path : null,
                    query,
                });
                continue;
            }

            if (["rg", "ripgrep", "rga", "ripgrep-all"].includes(executable)) {
                const positionals = collectRipgrepPositionals(tokens);
                if (tokens.includes("--files")) {
                    const targets = positionals.length ? positionals : [null];
                    for (const path of targets) {
                        actions.push({
                            type: "listFiles",
                            command: segment.text,
                            path: path ? resolveCommandActionPath(path, effectiveCwd) ?? path : null,
                        });
                    }
                    continue;
                }

                const query = getRipgrepPattern(tokens, positionals);
                const pathStart = findOptionValue(tokens, ["-e", "--regexp"]) ? 0 : 1;
                const paths = positionals
                    .slice(pathStart)
                    .map(normalizeCommandActionPath)
                    .filter((path): path is string => Boolean(path));
                actions.push({
                    type: "search",
                    command: segment.text,
                    query,
                    path: paths.length
                        ? paths
                              .map((path) => resolveCommandActionPath(path, effectiveCwd) ?? path)
                              .join(", ")
                        : null,
                });
            }
        }

        return actions;
    }

    function parseCommandActionsFromShell(
        item: Extract<ThreadItem, { type: "commandExecution" }>
    ): ParsedCommandAction[] {
        const fingerprint = [
            item.command ?? "",
            item.cwd ?? "",
            JSON.stringify(item.commandActions ?? null),
        ].join("\u0000");
        const cached = commandActionCache.get(item.id);
        if (cached?.fingerprint === fingerprint) return cached.actions;

        const actions = parseCommandActionsFromShellUncached(item);
        commandActionCache.set(item.id, { fingerprint, actions });
        if (commandActionCache.size > 500) {
            const oldest = commandActionCache.keys().next().value;
            if (oldest) commandActionCache.delete(oldest);
        }
        return actions;
    }

    function enrichCommandActionFromShell(
        action: CommandAction,
        item: Extract<ThreadItem, { type: "commandExecution" }>
    ): ParsedCommandAction {
        if (action.type === "listFiles" || action.type === "search") {
            return {
                ...action,
                path: action.path ? resolveCommandActionPath(action.path, item.cwd) ?? action.path : null,
            };
        }
        if (action.type !== "read") return action;
        const command = action.command || item.command || "";
        const range = inferReadLineRangeFromCommand(command, action.path);
        return {
            ...action,
            path: resolveCommandActionPath(action.path, item.cwd) ?? action.path,
            startLine: range?.startLine ?? null,
            endLine: range?.endLine ?? null,
        };
    }

    type ProjectedFunctionToolCall = Extract<ThreadItem, { type: "functionToolCall" }>;

    function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
        const seen = new Set<string>();
        const result: string[] = [];
        values.forEach((value) => {
            const normalized = normalizeCommandActionPath(value);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            result.push(normalized);
        });
        return result;
    }

    function createReadFileToolCall(
        id: string,
        item: Extract<ThreadItem, { type: "commandExecution" }>,
        action: ParsedReadCommandAction,
        success: boolean | null
    ): ProjectedFunctionToolCall {
        const paths = uniqueNonEmpty([action.path]);
        const files = uniqueNonEmpty([action.name]);
        const firstPath = paths[0] ?? null;
        const firstFile = files[0] ?? (firstPath ? firstPath.split(/[/\\]/).pop() || firstPath : null);
        const range =
            typeof action.startLine === "number"
                ? {
                      start: action.startLine,
                      end: action.endLine ?? action.startLine,
                  }
                : null;

        return {
            type: "functionToolCall",
            id,
            toolName: "read_file",
            arguments: JSON.stringify({
                file_path: firstPath,
                name: firstFile,
                startLine: action.startLine,
                endLine: action.endLine,
                start_line: action.startLine,
                end_line: action.endLine,
                range,
                command: action.command,
                cwd: item.cwd,
            }),
            output: item.aggregatedOutput ?? "",
            success,
        };
    }

    function createFunctionToolCallForAction(
        id: string,
        item: Extract<ThreadItem, { type: "commandExecution" }>,
        action: Exclude<CommandAction, { type: "read" }>,
        success: boolean | null
    ): ProjectedFunctionToolCall | null {
        if (action.type === "unknown") return null;

        return {
            type: "functionToolCall",
            id,
            toolName: action.type === "listFiles" ? "list_dir" : "grep_files",
            arguments:
                action.type === "listFiles"
                    ? JSON.stringify({
                          path: normalizeCommandActionPath(action.path) ?? "current directory",
                      })
                    : JSON.stringify({
                          pattern: action.query,
                          query: action.query,
                          path: normalizeCommandActionPath(action.path),
                      }),
            output: item.aggregatedOutput ?? "",
            success,
        };
    }

    function projectCommandExecutionItem(item: ThreadItem): ThreadItem[] {
        if (item.type !== "commandExecution") return [item];

        const commandActions = parseCommandActionsFromShell(item);
        if (commandActions.length === 0) return [item];

        const success =
            item.status === "completed"
                ? item.exitCode == null
                    ? true
                    : item.exitCode === 0
                : item.status === "failed" || item.status === "declined"
                    ? false
                    : null;

        const projectedItems: ProjectedFunctionToolCall[] = [];

        const nextProjectedId = () => `${item.id}:command-action:${projectedItems.length}`;

        for (const action of commandActions) {
            if (action.type === "read") {
                projectedItems.push(createReadFileToolCall(nextProjectedId(), item, action, success));
                continue;
            }

            const projected = createFunctionToolCallForAction(nextProjectedId(), item, action, success);
            if (projected) {
                projectedItems.push(projected);
            }
        }

        if (projectedItems.length === 0) return [item];
        if (projectedItems.length === 1) {
            projectedItems[0].id = item.id;
        }
        return projectedItems;
    }

    const dispatch = createEventDispatcher<{
        toggleGroup: { groupId: string };
        undoTurn: { turnId: string };
        openThread: { threadId: string };
    }>();

    function emitToggleGroup(groupId: string | null) {
        if (!groupId) return;
        dispatch("toggleGroup", { groupId });
    }

    function emitUndoTurn(turnId: string) {
        if (!turnId) return;
        dispatch("undoTurn", { turnId });
    }

    function emitOpenThread(threadId: string) {
        if (!threadId) return;
        dispatch("openThread", { threadId });
    }

    function getTimelineIcon(item: ThreadItem) {
        switch (item.type) {
            case "agentMessage":
                return Bot;
            case "reasoning":
                return Brain;
            case "plan":
                return ClipboardList;
            case "contextCompaction":
                return FoldVertical;
            case "commandExecution":
                return SquareTerminal;
            case "fileChange":
                return FileEdit;
            case "mcpToolCall":
                return Wrench;
            case "collabAgentToolCall":
                return GitBranch;
            case "subAgentActivity":
                return GitBranch;
            case "sleep":
                return PauseCircle;
            case "dynamicToolCall":
                return Wrench;
            case "hookPrompt":
                return MessageSquare;
            case "webSearch":
                return Globe2;
            case "todoList":
                return ListTodo;
            case "imageView":
            case "imageGeneration":
                return Image;
            case "codeReview":
            case "enteredReviewMode":
            case "exitedReviewMode":
                return FileSearch;
            case "functionToolCall":
                switch ((item as any).toolName) {
                    case "grep_files":
                        return Search;
                    case "read_file":
                        return FileText;
                    case "list_dir":
                        return FolderTree;
                    case "request_user_input":
                        return MessageSquare;
                    default:
                        return Wrench;
                }
            default:
                return Bot;
        }
    }

    function getTimelineColor(item: ThreadItem): string {
        switch (item.type) {
            case "agentMessage":
                return "#8b5cf6";
            case "reasoning":
            case "plan":
                return "#f59e0b";
            case "contextCompaction":
                return "#64748b";
            case "commandExecution":
                return "#10b981";
            case "fileChange":
                return "#06b6d4";
            case "mcpToolCall":
                return "#6366f1";
            case "collabAgentToolCall":
                return "#0f766e";
            case "subAgentActivity":
                return "#0891b2";
            case "sleep":
                return "#64748b";
            case "dynamicToolCall":
                return "#7c3aed";
            case "hookPrompt":
                return "#d97706";
            case "webSearch":
                return "#ec4899";
            case "todoList":
                return "#14b8a6";
            case "imageView":
                return "#a855f7";
            case "imageGeneration":
            case "codeReview":
            case "enteredReviewMode":
            case "exitedReviewMode":
                return "#f97316";
            case "functionToolCall":
                switch ((item as any).toolName) {
                    case "read_file":
                        return "#06b6d4";
                    case "list_dir":
                        return "#14b8a6";
                    case "grep_files":
                        return "#3b82f6";
                    default:
                        return "#8b5cf6";
                }
            default:
                return "#8b5cf6";
        }
    }

    function findTimelineAnchor(rowEl: HTMLElement): HTMLElement | null {
        const selectors = [
            ".item-row-body .item-header",
            ".item-row-body .read-file-row",
            ".item-row-body .collab-row",
            ".item-row-body .tool-header",
            ".item-row-body .markdown-content > :first-child",
            ".item-row-body .simple-content p",
            ".item-row-body .review-mode-card",
            ".item-row-body .context-compaction-card",
            ".item-row-body .image-generation-header",
            ".item-row-body .protocol-event-card",
            ".item-row-body .thread-item-card",
        ];

        for (const selector of selectors) {
            const target = rowEl.querySelector<HTMLElement>(selector);
            if (target && target.getClientRects().length > 0) return target;
        }
        return null;
    }

    function getFirstTextLineRect(anchor: HTMLElement): DOMRect | null {
        const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);

        while (walker.nextNode()) {
            const textNode = walker.currentNode as Text;
            const text = textNode.textContent ?? "";
            const firstVisibleChar = text.search(/\S/);
            if (firstVisibleChar < 0) continue;

            const range = document.createRange();
            range.setStart(textNode, firstVisibleChar);
            range.setEnd(textNode, text.length);

            const rect = Array.from(range.getClientRects()).find(
                (candidate) => candidate.width > 0 && candidate.height > 0
            );
            range.detach();

            if (rect) return rect;
        }

        return null;
    }

    function getTimelineAnchorRect(anchor: HTMLElement): DOMRect {
        return getFirstTextLineRect(anchor) ?? anchor.getBoundingClientRect();
    }

    function alignTimelineNode(node: HTMLElement) {
        let frame: number | null = null;
        let resizeObserver: ResizeObserver | null = null;

        const update = () => {
            frame = null;
            const rowEl = node.closest<HTMLElement>(".item-row-group");
            if (!rowEl) return;

            const anchor = findTimelineAnchor(rowEl);
            if (!anchor) return;

            const rowRect = rowEl.getBoundingClientRect();
            const anchorRect = getTimelineAnchorRect(anchor);
            const top = anchorRect.top - rowRect.top + anchorRect.height / 2;
            if (Number.isFinite(top)) {
                node.style.setProperty("--fold-node-top", `${top}px`);
            }
        };

        const scheduleUpdate = () => {
            if (frame !== null) return;
            frame = requestAnimationFrame(update);
        };

        scheduleUpdate();

        if (typeof ResizeObserver !== "undefined") {
            const rowEl = node.closest<HTMLElement>(".item-row-group");
            resizeObserver = new ResizeObserver(scheduleUpdate);
            resizeObserver.observe(node);
            if (rowEl) resizeObserver.observe(rowEl);
            const bodyEl = rowEl?.querySelector<HTMLElement>(".item-row-body");
            if (bodyEl) resizeObserver.observe(bodyEl);
        }

        return {
            update: scheduleUpdate,
            destroy() {
                if (frame !== null) {
                    cancelAnimationFrame(frame);
                    frame = null;
                }
                resizeObserver?.disconnect();
            },
        };
    }

    function computeTotals(summary: FileChangeSummaryEntry[]) {
        return summary.reduce(
            (acc, entry) => ({
                added: acc.added + (entry.additions || 0),
                deleted: acc.deleted + (entry.deletions || 0),
            }),
            { added: 0, deleted: 0 }
        );
    }

    function getCachedFileSummaryRow(
        turn: Turn,
        turnIndex: number,
        turnDiff: { unifiedDiff: string; files: TurnDiffFileSummary[] } | null | undefined
    ): FileSummaryRow | null {
        if (!turnDiff || !Array.isArray(turnDiff.files) || turnDiff.files.length === 0) {
            return null;
        }

        const cached = fileSummaryRowCache.get(turn.id);
        if (cached?.unifiedDiff === turnDiff.unifiedDiff) {
            return cached.row ? { ...cached.row, turnIndex } : null;
        }

        const summary = buildFileChangeSummaryFromTurnDiff(turnDiff.files);
        if (summary.length === 0) {
            fileSummaryRowCache.set(turn.id, { unifiedDiff: turnDiff.unifiedDiff, row: null });
            return null;
        }

        const row: FileSummaryRow = {
            kind: "fileSummary",
            key: `${turn.id}:file-summary`,
            turnId: turn.id,
            turnIndex,
            summary,
            totals: computeTotals(summary),
            changes: summary.flatMap((entry) => entry.changes || []),
        };
        fileSummaryRowCache.set(turn.id, { unifiedDiff: turnDiff.unifiedDiff, row });
        return row;
    }

    const numberFmt = new Intl.NumberFormat("en-US");
    const formatTokens = (value: number) => {
        if (value == null || Number.isNaN(value)) return "0";
        const abs = Math.abs(value);
        if (abs >= 1000) {
            const v = value / 1000;
            // 保留 0-2 位小数，避免超长；去掉尾随 0
            const decimals = v >= 100 ? 0 : v >= 10 ? 1 : 2;
            return `${v.toFixed(decimals).replace(/\\.0+$/, "")}k`;
        }
        return numberFmt.format(value);
    };

    function formatDurationMs(durationMs: number | null | undefined): string | null {
        if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
            return null;
        }
        const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
        if (totalSeconds < 60) return `${totalSeconds}s`;
        if (totalSeconds < 3600) {
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
        }
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    function turnDurationMs(turn: Turn): number | null {
        if (typeof turn.durationMs === "number" && Number.isFinite(turn.durationMs)) {
            return turn.durationMs;
        }
        if (typeof turn.startedAt === "number" && typeof turn.completedAt === "number") {
            return Math.max(0, (turn.completedAt - turn.startedAt) * 1000);
        }
        return null;
    }

    // 扁平化：按 turn 顺序、再按 TurnView 的过滤规则展开（不做折叠，只控制“有哪些行”）
    $: allRows = (() => {
        const rows: FlatRow[] = [];

        turns.forEach((turn, tIndex) => {
            const items = turn.items ?? [];
            if (!items.length) return;

            const status: Turn["status"] | null | undefined = turn.status || "inProgress";
            const isFinished =
                status === "completed" || status === "failed" || status === "interrupted";
            const structureSignature = getTurnStructureSignature(turn, tIndex);
            const hasCommandExecution = items.some(
                (item) => item.type === "commandExecution"
            );
            const cachedTurn = turnRowCache.get(turn.id);
            // Active turns may mutate item objects in place while deltas stream.
            // Cache only terminal turns, whose projection is stable by contract.
            const canCacheTurn = isFinished && !hasCommandExecution;
            if (canCacheTurn && cachedTurn?.signature === structureSignature) {
                rows.push(...cachedTurn.rows);
                return;
            }

            const turnRowsStart = rows.length;

            // 1) userMessage：每个 turn 最多一个，始终在该 turn 的第一行
            //    对于 review turn（带有 enteredReviewMode / exitedReviewMode）：
            //    - Codex 会发两个 userMessage：
            //      a) 短的 label（例如 "current changes"，id 与 enteredReviewMode 相同）
            //      b) 真正的自然语言提示（例如 “Review the current code changes ...”，id 不同）
            //    VSCode 的做法是：
            //      - 不把 (a) 当作聊天气泡显示，只通过 enteredReviewMode 卡片 + header 呈现
            //      - 只把 (b) 渲染成蓝色的 review header。
            //    这里复刻同样的规则。
            const allUserMessages = items.filter((it) => it.type === "userMessage");
            const reviewModeItem = items.find(
                (it) => it.type === "enteredReviewMode" || it.type === "exitedReviewMode"
            );

            let userMessage: ThreadItem | undefined;
            let isReviewPrompt = false;

            if (reviewModeItem && allUserMessages.length > 0) {
                // 优先选择 id 与 reviewModeItem 不同的那条，作为真正的 review 提示
                userMessage =
                    allUserMessages.find((um) => um.id !== reviewModeItem.id) ??
                    allUserMessages[0];
                isReviewPrompt = true;
            } else {
                // 普通 turn：取第一条 userMessage，当作正常用户输入
                userMessage = allUserMessages[0];
                isReviewPrompt = false;
            }

            // 2) agentMessage：与 TurnView 相同的规则
            const agentMessages =
                items.filter(
                    (item) =>
                        item.type === "agentMessage" &&
                        item.text &&
                        item.text.trim().length > 0
                ) ?? [];

            const lastAgentMessage =
                isFinished && agentMessages.length > 0
                    ? agentMessages[agentMessages.length - 1]
                    : null;

            const todoItem = items.find((it) => it.type === "todoList") ?? null;

            const processRows: ItemRow[] = [];
            let fileSummaryRow: FileSummaryRow | null = null;

            // 3) process 区域：除了 userMessage / todoList / 不合规的 fileChange / 最终 agentMessage 之外的所有 item
            items.forEach((item, iIndex) => {
                // 所有 userMessage 都只在顶部渲染，不参与 process 区域，
                // 这样 review 场景下的“短 label”和“长提示”都不会再变成额外的用户气泡。
                if (item.type === "userMessage") return;

                if (item.type === "agentMessage") {
                    if (
                        lastAgentMessage &&
                        item.id === lastAgentMessage.id &&
                        isFinished
                    ) {
                        // 最终 agentMessage 在 turn 尾部单独渲染
                        return;
                    }
                    if (!item.text || !item.text.trim().length) {
                        return;
                    }
                }

                if (shouldHideItem(item)) {
                    return;
                }

                // fileChange：只保留 completed 的
                if (item.type === "fileChange" && item.status !== "completed") {
                    return;
                }

                // todoList：不在普通流程里渲染，由单独区域处理
                if (item.type === "todoList") {
                    return;
                }

                projectCommandExecutionItem(item).forEach((projectedItem, projectedIndex) => {
                    const baseId = projectedItem.id ?? item.id ?? `${tIndex}-${iIndex}`;
                    const needsTypeSuffix =
                        projectedItem.type === "enteredReviewMode" ||
                        projectedItem.type === "exitedReviewMode";
                    // Some Responses-compatible providers reuse or omit response item ids.
                    // The source position is part of the key so repeated searches/tools remain
                    // distinct rows instead of being reused by Svelte/the virtualizer.
                    const key = `${turn.id}:${iIndex}:${projectedIndex}:${baseId}${
                        needsTypeSuffix ? `:${projectedItem.type}` : ""
                    }`;
                    const baseRow: ItemRow = {
                        kind: "item",
                        key,
                        turnId: turn.id,
                        turnIndex: tIndex,
                        itemIndex: iIndex,
                        item: projectedItem,
                        sourceItemId: projectedItem.id === item.id ? null : item.id ?? null,
                        groupId: null,
                        isGroupHeader: false,
                        groupSize: 1,
                        isGroupTail: false,
                        isReviewPrompt: false,
                    };

                    processRows.push(baseRow);
                });
            });

            const stepsGroupId = processRows.length > 0 ? `${turn.id}:steps` : null;
            const processEntries = processRows;

            // userMessage 先渲染
            if (userMessage) {
                rows.push({
                    kind: "item",
                    key: `${turn.id}:${userMessage.id ?? `user-${tIndex}`}`,
                    turnId: turn.id,
                    turnIndex: tIndex,
                    itemIndex: items.indexOf(userMessage),
                    item: userMessage,
                    sourceItemId: null,
                    groupId: null,
                    isGroupHeader: false,
                    groupSize: 1,
                    isGroupTail: false,
                    isReviewPrompt,
                });
            }

            // 4) Turn 状态 + 折叠按钮（在用户气泡下方）
            rows.push({
                kind: "status",
                key: `${turn.id}:status`,
                turnId: turn.id,
                turnIndex: tIndex,
                status,
                isFinished,
                stepsGroupId,
                stepsCount: processRows.length,
            });

            // 将整个 process 区域视为一个组（与 TurnView 的“Hide steps”语义一致）
            if (processEntries.length > 0 && stepsGroupId) {
                let itemIdx = 0;
                const itemCount = processEntries.filter((entry) => entry.kind === "item").length;
                processEntries.forEach((entry) => {
                    if (entry.kind === "item") {
                        entry.groupId = stepsGroupId;
                        entry.isGroupHeader = itemIdx === 0;
                        entry.isGroupTail = itemIdx === itemCount - 1;
                        entry.groupSize = itemCount;
                        itemIdx += 1;
                    }
                    rows.push(entry);
                });
            }

            // 5) turn 末尾：最终 agentMessage（如果有）
            if (lastAgentMessage) {
                rows.push({
                    kind: "item",
                    key: `${turn.id}:final-${lastAgentMessage.id ?? `agent-${tIndex}`}`,
                    turnId: turn.id,
                    turnIndex: tIndex,
                    itemIndex: items.indexOf(lastAgentMessage),
                    item: lastAgentMessage,
                    sourceItemId: null,
                    groupId: null,
                    isGroupHeader: false,
                    groupSize: 1,
                    isGroupTail: false,
                    isReviewPrompt: false,
                });
            }

            // 5.5) fileChange summary：turn 已结束时，在末尾展示聚合的文件更改摘要。
            if (isFinished) {
                const turnDiff = turnDiffs[turn.id] ?? null;
                fileSummaryRow = getCachedFileSummaryRow(turn, tIndex, turnDiff);
            }

            if (fileSummaryRow) {
                rows.push(fileSummaryRow);
            }

            // 6) todoList：单独一行 Tasks 区
            if (todoItem) {
                rows.push({
                    kind: "item",
                    key: `${turn.id}:todo-${todoItem.id}`,
                    turnId: turn.id,
                    turnIndex: tIndex,
                    itemIndex: items.indexOf(todoItem),
                    item: todoItem,
                    sourceItemId: null,
                    groupId: null,
                    isGroupHeader: false,
                    groupSize: 1,
                    isGroupTail: false,
                    isReviewPrompt: false,
                });
            }

            // 7) token usage + cost (only show once the turn is finished)
            const tokenStats = turnTokenStats[turn.id] ?? null;
            const durationMs = turnDurationMs(turn);
            if (isFinished && tokenStats?.usage) {
                rows.push({
                    kind: "usage",
                    key: `${turn.id}:usage`,
                    turnId: turn.id,
                    usage: tokenStats.usage,
                    cost: tokenStats.cost,
                    model: tokenStats.model,
                    durationMs,
                });
            }

            if (canCacheTurn) {
                turnRowCache.set(turn.id, {
                    signature: structureSignature,
                    rows: rows.slice(turnRowsStart),
                });
            }
        });

        const liveTurnIds = new Set(turns.map((turn) => turn.id));
        for (const turnId of turnRowCache.keys()) {
            if (!liveTurnIds.has(turnId)) turnRowCache.delete(turnId);
        }

        return rows;
    })();

    // 不再根据折叠状态过滤 rows，避免虚拟项数量和索引在折叠/展开时大幅变化。
    // 统一由渲染分支决定每一行实际是否显示和占高。
    $: flatRows = allRows;

    // 基于扁平化后的 rows 构建虚拟器
    const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: 0,
        getScrollElement: () => scrollElement,
        estimateSize: () => 220, // 估计一个 ThreadItemCard 大致高度
        overscan: 8,
        indexAttribute: "data-index",
    });

    // `setOptions` updates the virtualizer's count, but the Svelte adapter only
    // invalidates its store when the virtualizer notifies. A count/key change
    // can otherwise leave the previous virtual-item snapshot rendered until a
    // resize or scroll event happens to notify it.
    let lastVirtualizerCount = -1;
    let lastVirtualizerBoundary = "";
    let lastVirtualizerScrollElement: HTMLDivElement | null = null;
    let virtualizerRevision = 0;
    let getRowKey = (index: number) =>
        index < flatRows.length ? flatRows[index]?.key ?? index : "processing-footer";

    // 每当 flatRows 变化时，同步虚拟器配置（数量 + key）
    $: {
        const instance = get(rowVirtualizer);
        const footerCount = hasProcessingFooter ? 1 : 0;
        // `scrollElement` is bound by ChatView after this component is created.
        // Include it in this reactive block so the virtualizer re-runs its
        // mount/update path when the element becomes available; otherwise the
        // first render can have data but no virtual rows until a later event.
        const currentScrollElement = scrollElement;
        const nextCount = flatRows.length + footerCount;
        const nextBoundary = `${flatRows[0]?.key ?? ""}\u0000${
            flatRows[flatRows.length - 1]?.key ?? ""
        }\u0000${footerCount}`;
        const structureChanged =
            nextCount !== lastVirtualizerCount ||
            nextBoundary !== lastVirtualizerBoundary ||
            currentScrollElement !== lastVirtualizerScrollElement;

        if (structureChanged) {
            // Change the resolver identity only for structural updates. This
            // tells virtual-core that item keys may have changed while keeping
            // the same resolver during text-only streaming updates.
            getRowKey = (index: number) =>
                index < flatRows.length ? flatRows[index]?.key ?? index : "processing-footer";
            virtualizerRevision += 1;
            lastVirtualizerCount = nextCount;
            lastVirtualizerBoundary = nextBoundary;
            lastVirtualizerScrollElement = currentScrollElement;
        }

        instance.setOptions({
            count: nextCount,
            getScrollElement: () => currentScrollElement,
            getItemKey: getRowKey,
        });
    }

    // 行测量 action：
    // - 挂载时测量一次
    // - 使用 ResizeObserver 在高度变化时重新测量
    //   这样折叠/展开组或内容变更时，virtualizer 能拿到最新尺寸，
    //   无需整列表重挂载，也不会出现空白/重叠。
    function measureRow(node: HTMLDivElement) {
        const instance = get(rowVirtualizer);
        instance.measureElement(node);

        let resizeObserver: ResizeObserver | null = null;

        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(() => {
                const inst = get(rowVirtualizer);
                inst.measureElement(node);
            });
            resizeObserver.observe(node);
        }

        return {
            destroy() {
                if (resizeObserver) {
                    resizeObserver.disconnect();
                    resizeObserver = null;
                }
            },
        };
    }

    // Keep the revision in the each-block dependency list. The virtualizer
    // store object is intentionally stable, so a structural option update may
    // otherwise leave the block holding the previous getVirtualItems snapshot.
    function getVirtualRows(_revision: number, instance: { getVirtualItems: () => any[] }) {
        return instance.getVirtualItems();
    }

    function getVirtualTotalSize(_revision: number, instance: { getTotalSize: () => number }) {
        return instance.getTotalSize();
    }

</script>

<div class="thread-item-flat-root">
    {#if flatRows.length === 0}
        <div class="empty-state">
            <p>No items to display</p>
        </div>
    {:else}
        <div
            class="virtual-canvas"
            data-virtualizer-revision={virtualizerRevision}
            style={`height: ${Math.round(getVirtualTotalSize(virtualizerRevision, $rowVirtualizer))}px;`}
        >
            {#each getVirtualRows(virtualizerRevision, $rowVirtualizer) as virtualRow (virtualRow.key)}
                <div
                    class="virtual-row"
                    class:collapsed-group-row={virtualRow.index < flatRows.length &&
                        flatRows[virtualRow.index]?.kind === "item" &&
                        flatRows[virtualRow.index].groupId &&
                        !(groupExpanded[flatRows[virtualRow.index].groupId] ?? true)}
                    data-index={virtualRow.index}
                    style={`transform: translateY(${virtualRow.start}px);`}
                    use:measureRow
                >
                    {#if virtualRow.index < flatRows.length}
                        {@const row = flatRows[virtualRow.index]}
                        {#if row.kind === "status"}
                            <div class="status-row">
                                <TurnStatusIndicator
                                    status={row.status || "inProgress"}
                                    currentItem={null}
                                />
                                {#if row.isFinished && row.stepsGroupId && row.stepsCount > 0}
                                    <button
                                        class="expand-toggle"
                                        class:expanded={(groupExpanded[row.stepsGroupId] ?? true)}
                                        type="button"
                                        on:click={() => emitToggleGroup(row.stepsGroupId)}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                        >
                                            {#if groupExpanded[row.stepsGroupId] ?? true}
                                                <path d="M18 15l-6-6-6 6" />
                                            {:else}
                                                <path d="M9 18l6-6-6-6" />
                                            {/if}
                                        </svg>
                                        <span>
                                            {(groupExpanded[row.stepsGroupId] ?? true)
                                                ? `Hide ${row.stepsCount} step${row.stepsCount > 1 ? "s" : ""}`
                                                : `Show ${row.stepsCount} step${row.stepsCount > 1 ? "s" : ""}`}
                                        </span>
                                    </button>
                                {/if}
                            </div>
                            {:else if row.kind === "fileSummary"}
                            {@const totals = row.totals}
                            <div class="file-change-summary">
                                <div class="summary-header">
                                    <div class="summary-title">
                                        {row.summary.length === 1
                                            ? "1 file changed"
                                            : `${row.summary.length} files changed`}
                                        <span class="summary-counts">
                                            <span class="summary-add">+{totals.added}</span>
                                            <span class="summary-del">-{totals.deleted}</span>
                                        </span>
                                    </div>
                                    <div class="summary-actions">
                                        <button
                                            class="summary-diff-button"
                                            type="button"
                                            on:click={() =>
                                                openViewAllChangesTab({
                                                    turnId: row.turnId,
                                                    title: "View all changes",
                                                    changes: row.changes,
                                                })}
                                            title="在 tab 中查看所有变更"
                                        >
                                            <ExternalLink size="14" />
                                            <span class="summary-diff-label">View all changes</span>
                                        </button>
                                        {#if undoTurnId === row.turnId}
                                            <button
                                                class="summary-diff-button"
                                                type="button"
                                                on:click={() => emitUndoTurn(row.turnId)}
                                                title="Undo this turn's changes"
                                            >
                                                <span class="summary-diff-label">Undo</span>
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                                <MultiFileDiffView
                                    changes={row.summary.flatMap((entry) => entry.changes || [])}
                                    tone="default"
                                    defaultExpanded={false}
                                    showStatusLabel={false}
                                />
                            </div>
                            {:else}
                            {#if row.kind === "usage"}
                                <div class="usage-row">
                                    <div class="turn-usage-chips">
                                        <span class="chip">
                                            in {formatTokens(row.usage.inputTokens)}
                                        </span>
                                        {#if row.usage.cachedInputTokens > 0}
                                            <span class="chip muted">
                                                cache {formatTokens(row.usage.cachedInputTokens)}
                                            </span>
                                        {/if}
                                        <span class="chip">
                                            out {formatTokens(row.usage.outputTokens + row.usage.reasoningOutputTokens)}
                                        </span>
                                        <span class="turn-total">
                                            turn total {formatTokens(row.usage.totalTokens)}
                                        </span>
                                        {#if formatDurationMs(row.durationMs)}
                                            <span class="chip muted">
                                                worked {formatDurationMs(row.durationMs)}
                                            </span>
                                        {/if}
                                    </div>
                                </div>
                            {:else if row.item.type === "todoList"}
                                <!-- TodoList 保持与旧 TurnView 相同的样式，始终展开 -->
                                <div class="todo-list">
                                    <div class="todo-header">
                                        <svg
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                        >
                                            <path d="M9 11l3 3L22 4" />
                                            <path
                                                d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
                                            />
                                        </svg>
                                        <span>Tasks</span>
                                    </div>
                                    <ul class="todo-items">
                                        {#each row.item.items || [] as task}
                                            <li class:completed={task.completed}>
                                                <input
                                                    type="checkbox"
                                                    checked={task.completed}
                                                    disabled
                                                />
                                                <span>{task.text}</span>
                                            </li>
                                        {/each}
                                    </ul>
                                </div>
                            {:else}
                                {#if row.groupId}
                                    {#if groupExpanded[row.groupId] ?? true}
                                        <!-- 展开状态：显示折叠线 + 菱形 + 内容 -->
                                        <div
                                            class="item-row item-row-group"
                                            class:group-first={row.isGroupHeader}
                                            class:group-last={row.isGroupTail}
                                            class:group-single={row.groupSize === 1}
                                        >
                                            <button
                                                type="button"
                                                class="fold-node"
                                                class:fold-node-active={currentItemId === (row.sourceItemId ?? row.item.id)}
                                                style={`--fold-node-color: ${getTimelineColor(row.item)}`}
                                                use:alignTimelineNode
                                            >
                                                <svelte:component
                                                    this={getTimelineIcon(row.item)}
                                                    size="1em"
                                                    class="fold-node-icon"
                                                />
                                            </button>
                                            <div class="item-row-body">
                                                <ThreadItemCard
                                                    item={row.item}
                                                    isStreaming={!!streamingItemId && streamingItemId === (row.sourceItemId ?? row.item.id)}
                                                    isReviewPrompt={row.isReviewPrompt}
                                                    {mediaBaseDir}
                                                    hideLeadingIcon
                                                    on:openThread={(e) => emitOpenThread(e.detail.threadId)}
                                                />
                                            </div>
                                        </div>
                                    {:else}
                                        <!-- 折叠状态：完全隐藏整个 steps 组的实际内容，
                                             保留哪些行属于该组的知识留给 flatRows/allRows，
                                             由虚拟列表 + measureRow 处理高度收缩。 -->
                                    {/if}
                                {:else}
                                    <!-- 普通非分组行 -->
                                    <div class="item-row">
                                        <div class="item-row-body">
                                            <ThreadItemCard
                                                item={row.item}
                                                isStreaming={!!streamingItemId && streamingItemId === (row.sourceItemId ?? row.item.id)}
                                                isReviewPrompt={row.isReviewPrompt}
                                                {mediaBaseDir}
                                                on:openThread={(e) => emitOpenThread(e.detail.threadId)}
                                            />
                                        </div>
                                    </div>
                                {/if}
                            {/if}
                        {/if}
                    {:else if hasProcessingFooter}
                        <ProcessingPlaceholder
                            header={processingHeader}
                            pinned={processingPinned}
                            elapsedSeconds={processingElapsedSeconds}
                        />
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .thread-item-flat-root {
        display: flex;
        flex-direction: column;
        /* 由父级（ChatView.items-container）负责滚动与 padding */
        width: 100%;
        box-sizing: border-box;
    }

    .virtual-canvas {
        position: relative;
        width: 100%;
    }

    .virtual-row {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        width: 100%;
        box-sizing: border-box;
        padding: 4px 0;
    }

    /* 折叠 steps 时，对应虚拟行保持在列表中，但高度收缩为 0，避免产生大块空白。
       通过 ResizeObserver + measureRow，virtualizer 会在样式变化后重新计算总高度。 */
    .virtual-row.collapsed-group-row {
        padding-top: 0;
        padding-bottom: 0;
        height: 0;
    }

    .item-row {
        display: flex;
        align-items: center;
        width: 100%;
        box-sizing: border-box;
        gap: 6px;
    }

    .item-row-body {
        flex: 1 1 auto;
        min-width: 0;
    }

    .item-row-group {
        position: relative;
        padding-left: 24px; /* 给折叠线和节点预留空间 */
    }

    .fold-node {
        position: absolute;
        /* 折叠节点和垂线共用同一条 x 轴 */
        --fold-x: 12px;
        --fold-node-size: calc(var(--ai-font-size, 14px) + 6px);
        left: var(--fold-x);
        top: var(--fold-node-top, calc(var(--row-height, 32px) / 2));
        transform: translate(-50%, -50%);
        width: var(--fold-node-size);
        height: var(--fold-node-size);
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
    }

    .fold-node::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: var(--bg-primary, #020617);
    }

    :global(.fold-node-icon) {
        display: block;
        width: calc(var(--ai-font-size, 14px) + 2px);
        height: calc(var(--ai-font-size, 14px) + 2px);
        color: var(--fold-node-color, rgba(56, 189, 248, 0.9));
        stroke-width: 2;
        position: relative;
        z-index: 1;
    }

    .fold-node.collapsed :global(.fold-node-icon) {
        color: var(--fold-node-color, rgba(56, 189, 248, 0.9));
        opacity: 0.9;
    }

    .fold-node-active :global(.fold-node-icon) {
        color: #22c55e;
    }

    .item-row-group::before {
        /* 垂直折叠线，略微向上下溢出，避免行与行之间出现断点 */
        content: "";
        position: absolute;
        left: var(--fold-x, 12px);
        top: -6px;
        bottom: -6px;
        width: 2px;
        border-radius: 1px;
        background: rgba(56, 189, 248, 0.25);
    }

    .item-row-group.group-first::before {
        /* 从第一个节点中心开始向下连接，始终延伸到本行底部（兼容内容较高的卡片） */
        top: 16px;
        bottom: -6px;
        height: auto;
    }

    .item-row-group.group-last::before {
        /* 从上一行延伸到最后一个节点中心，下面不要再多出“尾巴” */
        top: -6px;
        height: calc(var(--row-height, 32px) / 2 + 6px);
        bottom: auto;
    }

    .item-row-group.group-single::before {
        /* 只有一个 step 时，不画竖线，只保留一个菱形 */
        display: none;
    }

    .status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 8px 0 6px;
        max-width: 100%;
        width: 100%;
    }

    .usage-row {
        margin: 10px 0 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
    }

    .turn-usage-chips {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 12px;
        font-family: var(--font-mono, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
        font-weight: 600;
        color: var(--text-secondary, #bbb);
        letter-spacing: 0.2px;
    }

    .chip {
        padding: 2px 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: 1.25;
    }

    .chip.muted {
        opacity: 0.9;
    }

    .turn-total {
        display: inline-flex;
        align-items: center;
        font-weight: 600;
        color: var(--text-secondary, #bbb);
        line-height: 1.25;
        font-family: var(--font-mono, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
    }

    .expand-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: transparent;
        border: 1px solid var(--border-color, #444);
        border-radius: 6px;
        color: var(--text-secondary, #aaa);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
    }

    .expand-toggle:hover {
        background: var(--bg-hover, #2a2a2a);
        border-color: var(--accent-color, #007acc);
        color: var(--text-primary, #fff);
    }

    .expand-toggle svg {
        transition: transform 0.15s;
    }

    .expand-toggle.expanded svg {
        transform: rotate(180deg);
    }

    .todo-list {
        margin-top: 16px;
        padding: 12px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #444);
        border-radius: 6px;
    }

    .todo-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        color: var(--text-primary, #fff);
        font-weight: 500;
        font-size: 14px;
    }

    .todo-header svg {
        color: var(--accent-color, #007acc);
    }

    .todo-items {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    .todo-items li {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 0;
        color: var(--text-primary, #fff);
        font-size: 13px;
        line-height: 1.5;
    }

    .todo-items li.completed {
        opacity: 0.6;
    }

    .todo-items li.completed span {
        text-decoration: line-through;
    }

    .todo-items input[type="checkbox"] {
        margin-top: 2px;
        cursor: default;
    }

    .empty-state {
        padding: 12px 4px;
        font-size: 13px;
        color: var(--text-secondary, #aaa);
    }

    .file-change-summary {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--border-color, #444);
        background: var(--bg-secondary, #111827);
    }

    .summary-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
    }

    .summary-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary, #e5e7eb);
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .summary-counts {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
    }

    .summary-add {
        color: #22c55e;
    }

    .summary-del {
        color: #f97373;
    }

    .summary-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }

    .summary-diff-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #444);
        background: transparent;
        color: var(--text-secondary, #9ca3af);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .summary-diff-button:hover {
        background: var(--bg-hover, #1f2937);
        border-color: var(--accent-color, #38bdf8);
        color: var(--text-primary, #e5e7eb);
    }

    .summary-diff-label {
        white-space: nowrap;
    }
</style>
