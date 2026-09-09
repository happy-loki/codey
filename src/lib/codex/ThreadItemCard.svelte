<script lang="ts">
    import {
        User,
        Bot,
        Brain,
        FileEdit,
        Wrench,
        Search,
        ListTodo,
        Image,
        FileSearch,
        ChevronDown,
        ChevronRight,
        Loader2,
        CheckCircle2,
        XCircle,
        Ban,
        SquareTerminal,
        FileText,
        FolderTree,
        BookOpenCheck,
        FoldVertical,
        ClipboardList,
        Globe2,
        MessageSquare,
        GitBranch,
        Puzzle,
        Send,
        PauseCircle,
        X,
        Play,
    } from "lucide-svelte";
    import type { ThreadItem } from "./types";
    import MarkdownRenderer from "./MarkdownRenderer.svelte";
    import FileDiffViewer from "./FileDiffViewer.svelte";
    import { openFileAtLine } from "../EditorTabList.svelte";
    import { addNotification, NotifType } from "../Notifications/notifications";
    import ImagePreview from "../ImagePreview.svelte";
    import { onMount, afterUpdate, createEventDispatcher } from "svelte";
    import { convertFileSrc } from "@tauri-apps/api/core";
    import { writeText } from "@tauri-apps/plugin-clipboard-manager";
    import { openContextMenu } from "../utility/contextMenuService";
    import FileTypeIcon from "../Icons/FileTypeIcon.svelte";
    import { resolveLocalPath } from "../markdown/mediaUtils";

    export let item: ThreadItem;
    export let isStreaming = false;
    export let hideLeadingIcon = false;
    // 中间的 agentMessage 可以按 reasoning 样式渲染
    export let renderAsReasoning = false;
    // 如果为 true，userMessage 作为 review 提示 header 样式渲染
    export let isReviewPrompt = false;
    // Workspace directory used to resolve relative media references in chat Markdown.
    export let mediaBaseDir: string | null = null;
    const dispatch = createEventDispatcher<{
        openThread: { threadId: string };
    }>();

    const isWindowsHost =
        typeof navigator !== "undefined" &&
        (/\bWindows\b/i.test(navigator.userAgent || "") ||
            /\bWin/i.test(navigator.platform || ""));

    // Reasoning 默认展开，其他默认折叠
    let isExpanded = item.type === "reasoning" || item.type === "plan";

    // 工具输出解析
    interface ToolOutput {
        type: 'grep_files' | 'read_file' | 'list_dir' | 'unknown';
        name: string;
        content: string;
        pattern?: string;
        path?: string;
        matchCount?: number;
    }

    function isToolOutput(text: string): boolean {
        if (!text) return false;
        // 检测工具输出的特征
        return Boolean(text.includes('Absolute path:') ||
               text.includes('L1:') || 
               text.includes('No matches found') ||
               text.match(/^[\w\/\-\.]+\n[\w\/\-\.]+\n/));
    }

    function parseToolOutput(text: string): ToolOutput | null {
        if (!text) return null;

        // 检测 list_dir 输出
        if (text.startsWith('Absolute path:')) {
            const lines = text.split('\n');
            const pathLine = lines[0];
            const path = pathLine.replace('Absolute path:', '').trim();
            return {
                type: 'list_dir',
                name: 'Directory Listing',
                path,
                content: lines.slice(1).join('\n'),
            };
        }

        // 检测 read_file 输出 (以 L1:, L2: 开头)
        if (text.match(/^L\d+:/m)) {
            return {
                type: 'read_file',
                name: 'File Content',
                content: text,
            };
        }

        // 检测 grep_files 输出 (文件路径列表)
        if (text === 'No matches found.') {
            return {
                type: 'grep_files',
                name: 'File Search',
                content: text,
                matchCount: 0,
            };
        }

        // 检测文件路径列表
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length > 0 && lines.every(l => l.match(/^[\w\/\-\.]+$/))) {
            return {
                type: 'grep_files',
                name: 'File Search',
                content: text,
                matchCount: lines.length,
            };
        }

        return null;
    }

    function getToolIcon(type: string) {
        const icons = {
            grep_files: Search,
            read_file: FileText,
            list_dir: FolderTree,
        };
        return icons[type] || FileSearch;
    }

    // 获取图标组件
    function getIcon(type: string) {
        const icons = {
            userMessage: User,
            agentMessage: Bot,
            reasoning: Brain,
            plan: ClipboardList,
            contextCompaction: FoldVertical,
            commandExecution: SquareTerminal,
            fileChange: FileEdit,
            mcpToolCall: Wrench,
            collabAgentToolCall: GitBranch,
            subAgentActivity: GitBranch,
            sleep: PauseCircle,
            dynamicToolCall: Wrench,
            hookPrompt: MessageSquare,
            webSearch: Globe2,
            todoList: ListTodo,
            imageView: Image,
            imageGeneration: Image,
            codeReview: FileSearch,
            enteredReviewMode: FileSearch,
            exitedReviewMode: FileSearch,
            functionToolCall: Wrench,
        };
        return icons[type] || Bot;
    }

    // 获取工具特定图标
    function getToolSpecificIcon(toolName: string) {
        const toolIcons = {
            grep_files: Search,
            read_file: FileText,
            list_dir: FolderTree,
            request_user_input: MessageSquare,
        };
        return toolIcons[toolName] || Wrench;
    }

    // 获取工具显示名称
    function getToolDisplayName(toolName: string): string {
        const displayNames: Record<string, string> = {
            grep_files: 'Search Files',
            read_file: 'Read File',
            list_dir: 'List Directory',
            request_user_input: "Request User Input",
        };
        return displayNames[toolName] || toolName;
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

    function extractShellWrappedCommand(command: string): string {
        const tokens = tokenizeShellCommand(command);
        if (tokens.length < 2) return command.trim();

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

    function formatCommandForDisplay(command: string): string {
        return extractShellWrappedCommand(command).replace(/\s+/g, " ").trim();
    }

    // 获取颜色
    function getColor(type: string): string {
        const colors = {
            userMessage: "#3b82f6",
            agentMessage: "#8b5cf6",
            reasoning: "#f59e0b",
            plan: "#f59e0b",
            contextCompaction: "#64748b",
            commandExecution: "#10b981",
            fileChange: "#06b6d4",
            mcpToolCall: "#6366f1",
            collabAgentToolCall: "#0f766e",
            subAgentActivity: "#0891b2",
            sleep: "#64748b",
            dynamicToolCall: "#7c3aed",
            hookPrompt: "#d97706",
            webSearch: "#ec4899",
            todoList: "#14b8a6",
            imageView: "#a855f7",
            imageGeneration: "#f97316",
            codeReview: "#f97316",
            enteredReviewMode: "#f97316",
            exitedReviewMode: "#f97316",
            functionToolCall: "#8b5cf6",
        };
        return colors[type] || "#8b5cf6";
    }

    // 获取工具特定颜色
    function getToolColor(toolName: string): string {
        const toolColors = {
            read_file: "#06b6d4",  // 青色，与fileChange相同
            list_dir: "#14b8a6",   // 绿松石色，与todoList相同
            grep_files: "#3b82f6", // 蓝色，与userMessage相同
        };
        return toolColors[toolName] || "#8b5cf6"; // 默认紫色，与functionToolCall相同
    }

    // 获取状态图标
    function getStatusIcon(status: string) {
        if (status === "inProgress") return Loader2;
        if (status === "completed") return CheckCircle2;
        if (status === "failed") return XCircle;
        if (status === "declined") return Ban;
        return null;
    }

    // 获取状态颜色
    function getStatusColor(status: string): string {
        if (status === "inProgress") return "#3b82f6";
        if (status === "completed") return "#10b981";
        if (status === "failed") return "#ef4444";
        if (status === "declined") return "#6b7280";
        return "#6b7280";
    }

    // 判断是否需要折叠
    function hasVisibleCollabContent(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): boolean {
        if (item.tool === "spawnAgent") {
            return Boolean(getCollabTaskSummary(item));
        }
        if (item.tool === "wait") {
            const entries = Object.values(item.agentsStates ?? {}).filter(Boolean);
            if (entries.length === 0) return false;
            // Only expand when we have something non-trivial to show (message, or multiple agents).
            const hasAnyMessage = entries.some((state) => (state?.message || "").trim().length > 0);
            return hasAnyMessage || entries.length > 1;
        }
        return false;
    }

    function isCollapsible(item: ThreadItem, type: string): boolean {
        // reasoning 不可折叠，直接显示内容
        if (type === "imageGeneration") {
            return false;
        }
        if (type === "collabAgentToolCall") {
            const collab = item as Extract<ThreadItem, { type: "collabAgentToolCall" }>;
            // spawnAgent 的 prompt 很关键：默认直接展示，不走折叠卡片。
            if (collab.tool === "spawnAgent") return false;
            // wait 可能包含多 agent 状态信息，允许折叠展开。
            if (collab.tool === "wait") return hasVisibleCollabContent(collab);
            // 其余 collab 事件基本是一行日志，无需折叠。
            return false;
        }
        return !["userMessage", "agentMessage", "reasoning"].includes(type);
    }

    // 获取摘要文本
    type ItemSummary = string | { text: string; icon: typeof Wrench };

    function getSummary(item: ThreadItem): ItemSummary {
        switch (item.type) {
            case "commandExecution":
                // 只展示原始 shell 命令文本；语义化映射在 ThreadItemFlatList 中完成
                if (item.command) {
                    const displayCommand = formatCommandForDisplay(item.command);
                    return `Ran: ${displayCommand.length > 50 ? displayCommand.substring(0, 50) + '...' : displayCommand}`;
                }
                return "Command execution";
            case "fileChange":
                {
                    const count = item.changes?.length ?? 0;
                    const suffix = count === 1 ? "file" : "files";
                    return count > 0 ? `Review ${count} ${suffix}` : "File changes";
                }
            case "reasoning":
                // 简短标题，避免和展开内容重复
                return "Reasoning process";
            case "plan":
                return "Plan";
            case "contextCompaction":
                return "Context compacted";
            case "mcpToolCall":
                if (getChromeBrowserRecoveryMessage(item as any)) {
                    return item.status === "failed"
                        ? "Chrome browser connection needs retry"
                        : "Chrome browser tool";
                }
                if (isBrowserUseMcpCall(item as any)) {
                    return getBrowserUseSummary(item as any);
                }
                return `${item.server}.${item.tool}`;
            case "collabAgentToolCall":
                return getCollabSummary(item);
            case "subAgentActivity": {
                const activity = item as Extract<ThreadItem, { type: "subAgentActivity" }>;
                const labels: Record<string, string> = {
                    started: "Subagent started",
                    interacted: "Subagent updated",
                    interrupted: "Subagent interrupted",
                    completed: "Subagent completed",
                };
                return labels[activity.kind] ?? "Subagent activity";
            }
            case "sleep":
                return `Waiting ${Math.max(0, Math.round((item as any).durationMs ?? 0))}ms`;
            case "dynamicToolCall": {
                const dynamic = item as Extract<ThreadItem, { type: "dynamicToolCall" }>;
                return `${dynamic.namespace ? `${dynamic.namespace}.` : ""}${dynamic.tool}`;
            }
            case "hookPrompt":
                return "Hook prompt";
            case "functionToolCall":
                const IconComp = getToolSpecificIcon(item.toolName);
                return {
                    text: getToolCallSummary(item.toolName, item.output, item.arguments),
                    icon: IconComp
                };
            case "webSearch":
                return `Search: ${item.query}`;
            case "todoList":
                return `${item.items?.length || 0} task(s)`;
            case "imageView":
                return `View: ${item.path}`;
            case "imageGeneration":
                if (getImageGenerationRevisedPrompt(item)) {
                    return getImageGenerationRevisedPrompt(item) || "";
                }
                if (getImageGenerationSavedPath(item)) {
                    const savedPath = getImageGenerationSavedPath(item) || "";
                    const fileName = savedPath.split(/[/\\]/).pop() || savedPath;
                    return `Generated: \`${fileName}\``;
                }
                return "Generated image";
            case "codeReview":
                return "Code review";
            case "enteredReviewMode":
                // Show the human‑readable review label, e.g. "current changes"
                return item.review || "Code review";
            case "exitedReviewMode":
                return item.review || "Review completed";
            default:
                return "";
        }
    }

    function getImageGenerationSavedPath(item: ThreadItem): string | undefined {
        if (item.type !== "imageGeneration") return undefined;
        const imageItem = item as ThreadItem & {
            savedPath?: string;
            saved_path?: string;
        };
        return imageItem.savedPath || imageItem.saved_path;
    }

    function getImageGenerationRevisedPrompt(item: ThreadItem): string | null | undefined {
        if (item.type !== "imageGeneration") return undefined;
        const imageItem = item as ThreadItem & {
            revisedPrompt?: string | null;
            revised_prompt?: string | null;
        };
        return imageItem.revisedPrompt ?? imageItem.revised_prompt;
    }

    function getMcpToolCallOutput(item: ThreadItem): string {
        if (item.type !== "mcpToolCall") return "";
        const parts: string[] = [];
        if (item.error?.message) {
            parts.push(item.error.message);
        }
        const content = item.result?.content;
        if (Array.isArray(content)) {
            for (const entry of content) {
                if (entry && typeof entry === "object" && "text" in entry && typeof entry.text === "string") {
                    parts.push(entry.text);
                } else if (entry !== null && entry !== undefined) {
                    try {
                        parts.push(JSON.stringify(entry));
                    } catch {
                        parts.push(String(entry));
                    }
                }
            }
        }
        return parts.join("\n").trim();
    }

    function isChromeBrowserMcpCall(
        item: ThreadItem
    ): item is Extract<ThreadItem, { type: "mcpToolCall" }> {
        return item.type === "mcpToolCall" && item.server === "node_repl" && item.tool === "js";
    }

    function asObject(value: unknown): Record<string, any> | null {
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : null;
    }

    function getMcpArgumentsObject(item: ThreadItem): Record<string, any> | null {
        if (item.type !== "mcpToolCall") return null;
        return asObject(item.arguments);
    }

    function isBrowserUseMcpCall(item: ThreadItem): boolean {
        if (!isChromeBrowserMcpCall(item)) return false;
        const meta = asObject(item.result?._meta);
        if (meta?.["codex/browserUse"] === true) return true;

        const args = getMcpArgumentsObject(item);
        const title = typeof args?.title === "string" ? args.title : "";
        const code = typeof args?.code === "string" ? args.code : "";
        return Boolean(
            title &&
                (code.includes("setupBrowserRuntime") ||
                    code.includes("agent.browsers") ||
                    code.includes("browser.tabs") ||
                    code.includes("browser.user"))
        );
    }

    function getBrowserUseTitle(item: ThreadItem): string {
        const args = getMcpArgumentsObject(item);
        const title = typeof args?.title === "string" ? args.title.trim() : "";
        return title || "Chrome 浏览器操作";
    }

    function getBrowserUseSummary(item: ThreadItem): string {
        const title = getBrowserUseTitle(item);
        if (item.type !== "mcpToolCall") return title;
        if (item.status === "failed") return `Chrome 操作失败：${title}`;
        if (item.status === "inProgress") return `正在操作 Chrome：${title}`;
        return `Chrome：${title}`;
    }

    function getBrowserUseStatusLabel(item: ThreadItem): string {
        if (item.type !== "mcpToolCall") return "";
        if (item.status === "failed") return "失败";
        if (item.status === "inProgress") return "执行中";
        return "已完成";
    }

    function getBrowserUseDurationLabel(item: ThreadItem): string {
        if (item.type !== "mcpToolCall" || typeof item.durationMs !== "number") return "";
        if (item.durationMs < 1000) return `${item.durationMs}ms`;
        const seconds = item.durationMs / 1000;
        return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
    }

    function decodeJsonStringValue(value: unknown): string | null {
        if (typeof value !== "string") return null;
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === "object") {
                return summarizeBrowserUseObject(parsed as Record<string, any>);
            }
        } catch {
            return null;
        }
        return null;
    }

    function summarizeBrowserUseObject(value: Record<string, any>): string | null {
        const title = typeof value.title === "string" ? value.title : "";
        const url = typeof value.url === "string" ? value.url : "";
        if (title && url) return `${title} · ${url}`;
        if (url) return url;
        if (typeof value.openTabsCount === "number") return `已连接 Chrome，当前可见标签页 ${value.openTabsCount} 个。`;
        if (value.selectedBrowser || value.capabilities || value.sessionId) return "Chrome 浏览器已连接。";
        return null;
    }

    function getBrowserUseOutputSummary(item: ThreadItem): string {
        const output = getMcpToolCallOutput(item);
        const trimmed = output.trim();
        if (!trimmed) return "";
        if (trimmed === "finalized") return "浏览器标签页已保留。";

        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object") {
                const objectSummary = summarizeBrowserUseObject(parsed as Record<string, any>);
                if (objectSummary) return objectSummary;

                const parsedObject = parsed as Record<string, any>;
                const valueSummary = decodeJsonStringValue(parsedObject.value);
                if (valueSummary) return valueSummary;
            }
        } catch {
            // node_repl may print JS object previews that are not strict JSON.
        }

        const titleMatch = trimmed.match(/"title"\s*:\s*"([^"]+)"/);
        const urlMatch = trimmed.match(/"url"\s*:\s*"([^"]+)"/);
        if (titleMatch?.[1] && urlMatch?.[1]) return `${titleMatch[1]} · ${urlMatch[1]}`;
        if (urlMatch?.[1]) return urlMatch[1];
        if (trimmed.includes("selectedBrowser") || trimmed.includes("codex/browserUse")) return "Chrome 浏览器已连接。";
        return trimmed.length > 220 ? `${trimmed.slice(0, 220)}...` : trimmed;
    }

    function getBrowserUseTechnicalDetails(item: ThreadItem): string {
        if (item.type !== "mcpToolCall") return "";
        return JSON.stringify(
            {
                arguments: item.arguments,
                durationMs: item.durationMs,
                error: item.error,
                result: item.result,
                status: item.status,
            },
            null,
            2
        );
    }

    function getChromeBrowserRecoveryMessage(item: ThreadItem): string | null {
        if (!isChromeBrowserMcpCall(item)) return null;
        const output = getMcpToolCallOutput(item);
        const text = output.toLowerCase();
        if (!text) return null;
        if (
            text.includes("js execution timed out") ||
            text.includes("kernel reset") ||
            text.includes("not part of browser session") ||
            text.includes("missing required browser session_id") ||
            text.includes("missing required browser turn_id") ||
            text.includes("missing required codex turn metadata") ||
            text.includes("stale handle") ||
            text.includes("lost binding")
        ) {
            return "Chrome 浏览器连接已重置或标签会话已过期。请直接重试同一句请求；下一次会重新建立浏览器连接，不应复用之前的 tab 句柄。";
        }
        if (
            text.includes("privileged native pipe bridge is not available") ||
            text.includes("browser-client is not trusted") ||
            text.includes("failed to connect to browser") ||
            text.includes("cannot communicate with the codex chrome extension") ||
            text.includes("native pipe closed")
        ) {
            return "无法连接 Codex Chrome 扩展。请在设置的 Plugins 页点击 Chrome 插件“安装/修复”，并确认 Chrome 扩展已安装且启用。";
        }
        return null;
    }

    function getBrowserUsePolicyRejectionMessage(item: ThreadItem): string | null {
        if (!isChromeBrowserMcpCall(item)) return null;
        const output = getMcpToolCallOutput(item);
        const text = output.toLowerCase();
        if (
            !text.includes("browser use rejected this action due to browser security policy") &&
            !text.includes("browser use is not permitted on") &&
            !text.includes("the user has requested that")
        ) {
            return null;
        }

        const url = output.match(/https?:\/\/[^\s"')]+/i)?.[0]?.replace(/[.,;:!?]+$/, "") ?? "";
        const target = url ? ` ${url}` : "";
        return `官方 Browser Use 安全策略拒绝访问${target}。这不是插件安装失败，也不是 Codey 没有转发授权请求；该策略在用户授权之前生效，因此不会产生 mcpServer/elicitation/request 弹窗。请换一个允许访问的目标，或让用户手动提供该页面内容。`;
    }

    function getCollabToolLabel(tool: string): string {
        switch (tool) {
            case "spawnAgent":
                return "Spawn agent";
            case "sendInput":
                return "Send input";
            case "resumeAgent":
                return "Resume agent";
            case "wait":
                return "Wait for agents";
            case "closeAgent":
                return "Close agent";
            default:
                return tool;
        }
    }

    function getCollabToolIcon(tool: string) {
        switch (tool) {
            case "spawnAgent":
                return GitBranch;
            case "sendInput":
                return Send;
            case "resumeAgent":
                return Play;
            case "wait":
                return PauseCircle;
            case "closeAgent":
                return X;
            default:
                return GitBranch;
        }
    }

    function getCollabSummary(
        item: Extract<ThreadItem, { type: "collabAgentToolCall" }>
    ): string {
        const receiverCount = item.receiverThreadIds?.length ?? 0;
        const stateCount = Object.keys(item.agentsStates ?? {}).length;
        const modelTag = getCollabModelTag(item);
        switch (item.tool) {
            case "spawnAgent":
                return modelTag ? `Spawned subagent [${modelTag}]` : "Spawned subagent";
            case "sendInput":
                return receiverCount > 0 ? `Sent input to ${receiverCount} agent(s)` : "Sent input";
            case "resumeAgent":
                return receiverCount > 0 ? `Resumed ${receiverCount} agent(s)` : "Resume agent";
            case "wait":
                return stateCount > 0 ? `Waiting on ${stateCount} agent(s)` : "Waiting on agents";
            case "closeAgent":
                return receiverCount > 0 ? `Closed ${receiverCount} agent(s)` : "Close agent";
            default:
                return getCollabToolLabel(item.tool);
        }
    }

    function getCollabTaskSummary(
        item: Extract<ThreadItem, { type: "collabAgentToolCall" }>
    ): string | null {
        const prompt = (item.prompt || "").trim();
        if (!prompt) return null;
        const singleLine = prompt.replace(/\s+/g, " ");
        return singleLine.length > 220 ? `${singleLine.slice(0, 217)}...` : singleLine;
    }

    function getCollabModelTag(
        item: Extract<ThreadItem, { type: "collabAgentToolCall" }>
    ): string | null {
        const parts = [item.model, item.reasoningEffort].filter(Boolean);
        return parts.length ? parts.join(" ") : null;
    }

    function getCollabEventTitle(
        item: Extract<ThreadItem, { type: "collabAgentToolCall" }>
    ): string {
        return getCollabSummary(item);
    }

    function parseToolArguments(args?: string) {
        if (!args || !args.trim()) return null;
        try {
            return JSON.parse(args);
        } catch {
            return null;
        }
    }

    function extractInfoFromOutput(toolName: string, output: string) {
        const info: Record<string, any> = {};
        if (toolName === "list_dir" && output.startsWith('Absolute path:')) {
            const match = output.match(/Absolute path:\s*(.+)/);
            if (match) info.path = match[1].trim();
        }
        return info;
    }

    function shouldShowArguments(item: any) {
        if (item.type !== "functionToolCall") return false;
        const parsedArgs = parseToolArguments(item.arguments);
        const extractedInfo = extractInfoFromOutput(item.toolName, item.output);
        return parsedArgs || Object.keys(extractedInfo).length > 0;
    }

    function getToolArgValue(item: any, key: string) {
        if (item.type !== "functionToolCall") return null;
        const parsedArgs = parseToolArguments(item.arguments);
        const extractedInfo = extractInfoFromOutput(item.toolName, item.output);
        return parsedArgs?.[key] || extractedInfo[key] || null;
    }

    function getToolArgEntries(item: any): [string, any][] {
        if (item.type !== "functionToolCall") return [];
        const parsedArgs = parseToolArguments(item.arguments);
        return parsedArgs ? Object.entries(parsedArgs) : [];
    }

    function formatToolOutput(item: any): string {
        if (item.type !== "functionToolCall") return item.output;
        
        // For read_file, remove the L1:, L2:, etc. line prefixes
        if (item.toolName === "read_file") {
            return item.output
                .split('\n')
                .map((line: string) => line.replace(/^L\d+:\s*/, ''))
                .join('\n');
        }
        
        return item.output;
    }

    type ReadFileTarget = {
        id: string;
        label: string;
        path: string | null;
        startLine: number | null;
        endLine: number | null;
    };
    const INLINE_CODE_REGEX = /`([^`\n\r]+)`/g;
    const INLINE_CODE_TAG_REGEX = /<code>([^<\n\r]+)<\/code>/gi;
    const VSCODE_URI_PATTERN = /^(vscode|vscode-insiders):\/\//i;

    function escapeHtml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    $: reasoningSummaryBody =
        item.type === "reasoning" ? (item as any).reasoningSummaryBody ?? "" : "";
    $: hasReasoningSummaryBody = reasoningSummaryBody.trim().length > 0;

    type FileLinkDescriptor = {
        absolutePath: string;
        displayName: string;
        tooltip: string;
        referenceText: string;
        startLine: number | null;
        endLine: number | null;
    };
    const INLINE_CODE_MARKDOWN_LINK_REGEX = /`(\[([^\]\n]+)\]\(([^)\n]+)\))`/g;

    function buildFileReferenceLink(descriptor: FileLinkDescriptor): string {
        const startLine = descriptor.startLine ?? 1;
        const endLine = descriptor.endLine ?? descriptor.startLine ?? null;
        const iconSvg = getReadFilePillIconSvg();
        const label = escapeHtml(descriptor.referenceText);
        const attrs = [
            `type="button"`,
            `class="read-file-pill read-file-inline-pill"`,
            `title="${escapeHtml(descriptor.tooltip)}"`,
            `data-file-path="${escapeHtml(descriptor.absolutePath)}"`,
            `data-line-start="${escapeHtml(String(startLine))}"`,
            `data-line-end="${escapeHtml(endLine ? String(endLine) : "" )}"`,
        ].join(" ");
        return `<button ${attrs}>${iconSvg}<span class="pill-name">${label}</span></button>`;
    }

    function getReadFilePillIconSvg(): string {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide-icon lucide lucide-file-text pill-icon"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>';
    }

    function createVsCodeDescriptor(
        href: string,
        referenceText?: string
    ): FileLinkDescriptor | null {
        const parsed = parseVsCodeFileHref(href);
        if (!parsed) return null;
        const displayName = parsed.path.split(/[/\\]/).pop() || parsed.path;
        return {
            absolutePath: parsed.path,
            displayName,
            tooltip: parsed.path,
            referenceText: referenceText || displayName,
            startLine: parsed.line,
            endLine: parsed.line,
        };
    }

    function createAbsoluteFileDescriptor(
        href: string,
        referenceText?: string
    ): FileLinkDescriptor | null {
        const parsed = parseAbsoluteFileHref(href);
        if (!parsed) return null;
        const displayName = parsed.path.split(/[/\\]/).pop() || parsed.path;
        return {
            absolutePath: parsed.path,
            displayName,
            tooltip: parsed.path,
            referenceText: referenceText || displayName,
            startLine: parsed.line,
            endLine: parsed.line,
        };
    }

    function createRelativeFileDescriptor(
        href: string,
        referenceText?: string
    ): FileLinkDescriptor | null {
        if (!mediaBaseDir) return null;

        const trimmed = (href || "").trim();
        if (!trimmed || /^(?:https?|mailto|tel|file|asset|tauri|blob|data|vscode(?:-insiders)?):/i.test(trimmed)) {
            return null;
        }

        const fragmentIndex = trimmed.indexOf("#");
        const rawPath = fragmentIndex >= 0 ? trimmed.slice(0, fragmentIndex) : trimmed;
        const fragment = fragmentIndex >= 0 ? trimmed.slice(fragmentIndex + 1) : "";
        const suffix = splitLineColumnSuffix(rawPath);
        const absolutePath = resolveLocalPath(suffix.path, mediaBaseDir);
        if (!absolutePath) return null;

        const lineColumnFromFragment = parseLineAndColumnFromFragment(fragment);
        const line = fragment ? lineColumnFromFragment.line : (suffix.line ?? 1);
        const column = fragment ? lineColumnFromFragment.column : (suffix.column ?? 1);
        const displayName = absolutePath.split(/[/\\]/).pop() || absolutePath;

        return {
            absolutePath,
            displayName,
            tooltip: absolutePath,
            referenceText: referenceText || displayName,
            startLine: line,
            endLine: line,
        };
    }

    function consumeTrailingLineSuffix(
        anchor: HTMLAnchorElement,
        descriptor: FileLinkDescriptor
    ): FileLinkDescriptor {
        if (descriptor.startLine && descriptor.startLine > 1) return descriptor;

        const labelSuffix = (descriptor.referenceText || "").match(/^(.*):(\d+)(?::(\d+))?$/);
        if (labelSuffix?.[1] && labelSuffix[2]) {
            const line = Number(labelSuffix[2]) || null;
            const column = Number(labelSuffix[3]) || 1;
            if (line) {
                return {
                    ...descriptor,
                    referenceText: `${labelSuffix[1]}:${line}${labelSuffix[3] ? `:${column}` : ""}`,
                    tooltip: `${descriptor.absolutePath}:${line}${labelSuffix[3] ? `:${column}` : ""}`,
                    startLine: line,
                    endLine: line,
                };
            }
        }

        const next = anchor.nextSibling;
        if (!next || next.nodeType !== Node.TEXT_NODE) return descriptor;

        const text = next.textContent ?? "";
        const match = text.match(/^:(\d+)(?::(\d+))?/);
        if (!match) return descriptor;

        const line = Number(match[1]) || null;
        if (!line) return descriptor;

        const column = Number(match[2]) || 1;
        const consumed = match[0].length;
        next.textContent = text.slice(consumed);

        const labelBase = (descriptor.referenceText || descriptor.displayName).replace(/:\d+(?::\d+)?$/, "");
        return {
            ...descriptor,
            referenceText: `${labelBase}:${line}${match[2] ? `:${column}` : ""}`,
            tooltip: `${descriptor.tooltip}:${line}${match[2] ? `:${column}` : ""}`,
            startLine: line,
            endLine: line,
        };
    }

    function replaceInternalFileReference(
        match: string,
        href: string,
        referenceText?: string
    ): string {
        const trimmedHref = href.trim();
        if (/^https?:\/\//i.test(trimmedHref)) {
            return match;
        }
        const descriptor = VSCODE_URI_PATTERN.test(trimmedHref)
            ? createVsCodeDescriptor(trimmedHref, referenceText)
            : createAbsoluteFileDescriptor(trimmedHref, referenceText);
        return descriptor ? buildFileReferenceLink(descriptor) : match;
    }

    function stripCitationWrappers(text: string): string {
        const startMarker = "cite";
        const endMarker = "";
        let result = "";
        let index = 0;

        while (index < text.length) {
            const start = text.indexOf(startMarker, index);
            if (start === -1) {
                result += text.slice(index);
                break;
            }

            // keep text before wrapper
            result += text.slice(index, start);

            const contentStart = start + startMarker.length;
            const end = text.indexOf(endMarker, contentStart);
            if (end === -1) {
                // malformed wrapper, keep the rest as-is
                result += text.slice(start);
                break;
            }

            // keep inner content wrapped in brackets, drop wrapper markers.
            // Some wrappers contain multiple cites separated by ``, so split
            // on that separator and emit one bracketed segment per cite.
            // This feeds into our existing file-reference parser, which expects
            // patterns like [path:line] or 【path†L1-L2】.
            const inner = text.slice(contentStart, end);
            const parts = inner.split("").filter((p) => p && p.trim().length > 0);
            if (parts.length === 0) {
                // no usable content
            } else if (parts.length === 1) {
                result += `【${parts[0]}】`;
            } else {
                result += parts.map((p) => `【${p}】`).join("");
            }
            index = end + endMarker.length;
        }

        return result;
    }

    function enhanceFileReferenceSegment(text: string): string {
        let transformed = text.replace(INLINE_CODE_MARKDOWN_LINK_REGEX, (match, _full, label, href) =>
            replaceInternalFileReference(match, href, label)
        );
        transformed = transformed.replace(INLINE_CODE_TAG_REGEX, (match, inner) => {
            const trimmed = inner.trim();
            const descriptor = VSCODE_URI_PATTERN.test(trimmed)
                ? createVsCodeDescriptor(trimmed, trimmed)
                : createAbsoluteFileDescriptor(trimmed, trimmed);
            return descriptor ? buildFileReferenceLink(descriptor) : match;
        });
        transformed = transformed.replace(INLINE_CODE_REGEX, (match, inner) => {
            const trimmed = inner.trim();
            const descriptor = VSCODE_URI_PATTERN.test(trimmed)
                ? createVsCodeDescriptor(trimmed, trimmed)
                : createAbsoluteFileDescriptor(trimmed, trimmed);
            return descriptor ? buildFileReferenceLink(descriptor) : match;
        });
        return transformed;
    }

    function getFenceMarker(line: string): { char: "`" | "~"; length: number } | null {
        const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (!match) return null;
        const marker = match[1] || "";
        return { char: marker[0] as "`" | "~", length: marker.length };
    }

    function isClosingFence(line: string, fence: { char: "`" | "~"; length: number }): boolean {
        const escaped = fence.char === "`" ? "`" : "~";
        const match = line.match(new RegExp(`^ {0,3}(${escaped}{${fence.length},})\\s*$`));
        return Boolean(match);
    }

    function enhanceFileReferences(text: string): string {
        const lines = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? [];
        let activeFence: { char: "`" | "~"; length: number } | null = null;
        let transformed = "";

        for (const line of lines) {
            const content = line.replace(/(?:\r\n|\n|\r)$/, "");

            if (activeFence) {
                transformed += line;
                if (isClosingFence(content, activeFence)) {
                    activeFence = null;
                }
                continue;
            }

            const fence = getFenceMarker(content);
            if (fence) {
                activeFence = fence;
                transformed += line;
                continue;
            }

            transformed += enhanceFileReferenceSegment(line);
        }

        return transformed;
    }

    function normalizeMarkdown(text: string | undefined | null): string {
        if (!text) return "";
        return stripCitationWrappers(text);
    }

    function enhanceMarkdown(text: string | undefined | null): string {
        if (!text) return "";
        const normalized = stripCitationWrappers(text);
        return enhanceFileReferences(normalized);
    }

    let cachedMarkdownInput: string | null = null;
    let cachedMarkdownStreaming: boolean | null = null;
    let cachedMarkdownOutput = "";

    function renderMarkdownContent(text: string | undefined | null): string {
        const source = text ?? "";
        if (
            cachedMarkdownInput === source &&
            cachedMarkdownStreaming === isStreaming
        ) {
            return cachedMarkdownOutput;
        }
        const rendered = isStreaming ? normalizeMarkdown(source) : enhanceMarkdown(source);
        cachedMarkdownInput = source;
        cachedMarkdownStreaming = isStreaming;
        cachedMarkdownOutput = rendered;
        return rendered;
    }

    function openInternalFilePath(path: string, line = 1, column = 1) {
        const normalizedPath = normalizeLocalFilePath((path || "").trim());
        if (!normalizedPath) {
            addNotification(NotifType.Warning, "无法打开文件", [], "缺少文件路径");
            return;
        }
        void openFileAtLine(
            normalizedPath,
            Math.max(1, Math.floor(line || 1)),
            Math.max(1, Math.floor(column || 1))
        );
    }

    function parseVsCodeFileHref(href: string): { path: string; line: number; column: number } | null {
        try {
            const url = new URL(href);
            if (!["vscode:", "vscode-insiders:"].includes(url.protocol)) {
                return null;
            }
            if (url.hostname !== "file") {
                return null;
            }

            let path = decodeURIComponent(url.pathname || "");
            if (!path) return null;

            // Support suffix forms like `.../file.go:12:3` in addition to query params.
            const suffixMatch = path.match(/^(.*?)(?::(\d+))?(?::(\d+))?$/);
            let lineFromSuffix = 1;
            let columnFromSuffix = 1;
            if (suffixMatch?.[1] && (suffixMatch[2] || suffixMatch[3])) {
                path = suffixMatch[1];
                lineFromSuffix = Number(suffixMatch[2]) || 1;
                columnFromSuffix = Number(suffixMatch[3]) || 1;
            }

            if (/^\/[A-Za-z]:[\\/]/.test(path) || /^\/[A-Za-z]:\//.test(path)) {
                path = path.slice(1);
            }

            const line =
                Number(url.searchParams.get("line")) ||
                Number(url.searchParams.get("start")) ||
                Number(url.hash.match(/L(\d+)/i)?.[1]) ||
                lineFromSuffix;
            const column =
                Number(url.searchParams.get("column")) ||
                Number(url.searchParams.get("col")) ||
                Number(url.hash.match(/C(\d+)/i)?.[1]) ||
                columnFromSuffix;

            return { path, line, column };
        } catch {
            return null;
        }
    }

    function parseLineAndColumnFromFragment(fragment: string): { line: number; column: number } {
        const normalized = (fragment || "").trim();
        if (!normalized) {
            return { line: 1, column: 1 };
        }

        const line =
            Number(normalized.match(/(?:^|[#:])L(\d+)/i)?.[1]) ||
            Number(normalized.match(/(?:^|[#:])line=(\d+)/i)?.[1]) ||
            Number(normalized.match(/^(\d+)(?::\d+)?$/)?.[1]) ||
            1;
        const column =
            Number(normalized.match(/(?:^|[#:])C(\d+)/i)?.[1]) ||
            Number(normalized.match(/(?:^|[#:])col(?:umn)?=(\d+)/i)?.[1]) ||
            Number(normalized.match(/^\d+:(\d+)$/)?.[1]) ||
            1;

        return { line, column };
    }

    function decodeLocalPath(path: string): string {
        if (!/%[0-9A-Fa-f]{2}/.test(path)) return path;
        try {
            return decodeURIComponent(path);
        } catch {
            return path;
        }
    }

    function normalizeLocalFilePath(path: string): string {
        const decoded = decodeLocalPath(path);
        if (!isWindowsHost) return decoded;

        const msysMatch = decoded.match(/^[/\\]([A-Za-z])[/\\](.*)$/);
        if (msysMatch) return `${msysMatch[1].toUpperCase()}:/${msysMatch[2]}`;

        const wslMatch = decoded.match(/^[/\\]mnt[/\\]([A-Za-z])(?:[/\\](.*))?$/i);
        if (wslMatch) return `${wslMatch[1].toUpperCase()}:/${wslMatch[2] ?? ""}`;

        const cygwinMatch = decoded.match(/^[/\\]cygdrive[/\\]([A-Za-z])(?:[/\\](.*))?$/i);
        if (cygwinMatch) return `${cygwinMatch[1].toUpperCase()}:/${cygwinMatch[2] ?? ""}`;

        return decoded;
    }

    function splitLineColumnSuffix(path: string): { path: string; line: number | null; column: number | null } {
        const match = path.match(/^(.*?)(?::(\d+))(?::(\d+))?$/);
        if (!match?.[1] || !match[2]) {
            return { path, line: null, column: null };
        }
        return {
            path: match[1],
            line: Number(match[2]) || null,
            column: Number(match[3]) || null,
        };
    }

    function parseAbsoluteFileHref(href: string): { path: string; line: number; column: number } | null {
        const trimmed = (href || "").trim();
        if (!trimmed) return null;

        if (/^file:\/\//i.test(trimmed)) {
            try {
                const url = new URL(trimmed);
                let path = decodeURIComponent(url.pathname || "");
                if (!path) return null;
                const suffix = splitLineColumnSuffix(path);
                path = suffix.path;
                if (/^\/[A-Za-z]:[\\/]/.test(path) || /^\/[A-Za-z]:\//.test(path)) {
                    path = path.slice(1);
                }
                const fragment = parseLineAndColumnFromFragment(url.hash.replace(/^#/, ""));
                return {
                    path,
                    line: url.hash ? fragment.line : (suffix.line ?? 1),
                    column: url.hash ? fragment.column : (suffix.column ?? 1),
                };
            } catch {
                return null;
            }
        }

        const fragmentIndex = trimmed.indexOf("#");
        const rawPath = normalizeLocalFilePath(fragmentIndex >= 0 ? trimmed.slice(0, fragmentIndex) : trimmed);
        const fragment = fragmentIndex >= 0 ? trimmed.slice(fragmentIndex + 1) : "";
        const suffix = splitLineColumnSuffix(rawPath);
        const lineColumnFromFragment = parseLineAndColumnFromFragment(fragment);
        const line = fragment ? lineColumnFromFragment.line : (suffix.line ?? 1);
        const column = fragment ? lineColumnFromFragment.column : (suffix.column ?? 1);

        if (/^\/[A-Za-z]:[\\/]/.test(suffix.path) || /^\/[A-Za-z]:\//.test(suffix.path)) {
            return { path: suffix.path.slice(1), line, column };
        }

        if (/^[A-Za-z]:[\\/]/.test(suffix.path) || /^\//.test(suffix.path) || /^\\\\/.test(suffix.path)) {
            return { path: suffix.path, line, column };
        }

        return null;
    }

    function getAttachmentImageSrc(input: { type: string; url?: string; path?: string }): string {
        if (input.type === "image") {
            return input.url || "";
        }
        if (input.type === "localImage") {
            return input.path ? convertFileSrc(input.path) : "";
        }
        return "";
    }

    async function handleReferenceClick(event: MouseEvent) {
        const target = (event.target as HTMLElement | null)?.closest?.("button.read-file-inline-pill, a");
        if (!target) return;
        const isInlineButton =
            target instanceof HTMLButtonElement && target.classList.contains("read-file-inline-pill");
        const isAnchor = target instanceof HTMLAnchorElement;
        if (!isInlineButton && !isAnchor) return;

        try {
            if (isInlineButton) {
                event.preventDefault();
                event.stopPropagation();
                const path = target.getAttribute("data-file-path")?.trim();
                if (!path) {
                    addNotification(NotifType.Warning, "无法打开文件", [], "缺少文件路径");
                    return;
                }
                const line = Number(target.getAttribute("data-line-start")) || 1;
                void openFileAtLine(path, line, 1);
                return;
            }

            const href = target.getAttribute("href") || "";
            if (!href) return;

            if (isAnchor && target.dataset.codeyInternalFileLink === "true") {
                event.preventDefault();
                event.stopPropagation();
                const path = target.dataset.filePath?.trim();
                const line = Number(target.dataset.lineStart) || 1;
                if (!path) {
                    addNotification(NotifType.Warning, "无法打开文件", [], "缺少文件路径");
                    return;
                }
                openInternalFilePath(path, line, 1);
                return;
            }

            // Upstream Codex can emit editor citations using a configured URI opener.
            // We treat vscode-style links as trusted internal-file links and open them
            // in the Codey editor instead of delegating to an external app.
            if (href.startsWith("vscode://") || href.startsWith("vscode-insiders://")) {
                event.preventDefault();
                event.stopPropagation();
                const parsed = parseVsCodeFileHref(href);
                if (!parsed) {
                    addNotification(NotifType.Warning, "无法打开文件", [], "不支持的 VS Code 文件链接");
                    return;
                }
                openInternalFilePath(parsed.path, parsed.line, parsed.column);
                return;
            }

            // 外部 URL：在系统默认处理器中打开
            if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
                event.preventDefault();
                event.stopPropagation();
                try {
                    const isTauri =
                        typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
                    if (isTauri) {
                        const mod = await import("@tauri-apps/plugin-shell");
                        await mod.open(href);
                        return;
                    }
                } catch {
                    // fall through to window.open
                }
                try {
                    window.open(href, "_blank", "noopener,noreferrer");
                } catch {
                    // ignore
                }
                return;
            }

            const absoluteFile = parseAbsoluteFileHref(href);
            if (absoluteFile) {
                event.preventDefault();
                event.stopPropagation();
                openInternalFilePath(absoluteFile.path, absoluteFile.line, absoluteFile.column);
                return;
            }

            // Streaming Markdown is intentionally not decorated into a file pill yet,
            // but a relative file link should still be usable while the response grows.
            const relativeFile = createRelativeFileDescriptor(
                href,
                target.textContent?.trim() || undefined
            );
            if (relativeFile) {
                event.preventDefault();
                event.stopPropagation();
                openInternalFilePath(
                    relativeFile.absolutePath,
                    relativeFile.startLine ?? 1,
                    1
                );
                return;
            }

            // All other href forms are considered unsupported for in-app file opening.
            // Prevent default navigation so plain `/D:/...` or relative markdown links
            // cannot blow away the current ChatView route.
            event.preventDefault();
            event.stopPropagation();
        } catch (error) {
            console.error("Failed to handle markdown file link", error);
            addNotification(NotifType.Error, "打开链接失败", [], "请检查路径后重试");
        }
    }

    function decorateMarkdownAnchors(root: ParentNode | null) {
        if (!root) return;

        const anchors = root.querySelectorAll<HTMLAnchorElement>(
            ".markdown-content a, .item-summary-markdown a"
        );

        anchors.forEach((anchor) => {
            const href = (anchor.getAttribute("href") || "").trim();
            if (!href) return;

            if (/^https?:\/\//i.test(href)) {
                anchor.classList.remove("read-file-inline-pill");
                delete anchor.dataset.codeyInternalFileLink;
                if (anchor.dataset.codeyPillDecorated === "true") {
                    const originalLabel = anchor.dataset.codeyPillLabel || anchor.textContent || "";
                    anchor.textContent = originalLabel;
                    delete anchor.dataset.codeyPillDecorated;
                }
                return;
            }

            const descriptor = VSCODE_URI_PATTERN.test(href)
                ? createVsCodeDescriptor(href, anchor.textContent?.trim() || undefined)
                : createAbsoluteFileDescriptor(href, anchor.textContent?.trim() || undefined) ||
                  createRelativeFileDescriptor(href, anchor.textContent?.trim() || undefined);

            const displayDescriptor = descriptor
                ? consumeTrailingLineSuffix(anchor, descriptor)
                : null;

            if (!displayDescriptor) {
                anchor.classList.remove("read-file-inline-pill");
                delete anchor.dataset.codeyInternalFileLink;
                if (anchor.dataset.codeyPillDecorated === "true") {
                    const originalLabel = anchor.dataset.codeyPillLabel || anchor.textContent || "";
                    anchor.textContent = originalLabel;
                    delete anchor.dataset.codeyPillDecorated;
                }
                return;
            }

            const label = displayDescriptor.referenceText || displayDescriptor.displayName;
            anchor.classList.add("read-file-inline-pill");
            anchor.dataset.codeyInternalFileLink = "true";
            anchor.dataset.codeyPillLabel = label;
            anchor.setAttribute("title", displayDescriptor.tooltip);
            anchor.dataset.filePath = displayDescriptor.absolutePath;
            anchor.dataset.lineStart = String(displayDescriptor.startLine ?? 1);
            anchor.dataset.lineEnd = displayDescriptor.endLine ? String(displayDescriptor.endLine) : "";

            if (anchor.dataset.codeyPillDecorated === "true") {
                const labelEl = anchor.querySelector<HTMLElement>(".pill-name");
                if (labelEl) {
                    labelEl.textContent = label;
                }
                return;
            }

            anchor.innerHTML = `${getReadFilePillIconSvg()}<span class="pill-name">${escapeHtml(label)}</span>`;
            anchor.dataset.codeyPillDecorated = "true";
        });
    }

    // Reasoning icon: match first-line height and center icon
    let reasoningIconWrapper: HTMLSpanElement | null = null;
    let reasoningContentEl: HTMLDivElement | null = null;
    let reasoningIconLineHeight = 0;
    let lastLayoutItem: ThreadItem | null = null;
    let lastLayoutExpanded = false;
    let lastLayoutRenderAsReasoning = false;
    let lastDecoratedItem: ThreadItem | null = null;
    let lastDecoratedText = "";
    let lastDecoratedSummary = "";
    let lastDecoratedExpanded = false;
    let lastDecoratedStreaming = true;

    // --- User attachment helpers ---
    function isImageInput(input: any): input is { type: "image" | "localImage"; url?: string; path?: string } {
        return input?.type === "image" || input?.type === "localImage";
    }

    function isResourceMentionInput(
        input: any
    ): input is { type: "skill" | "mention"; name: string; path: string } {
        return (
            (input?.type === "skill" || input?.type === "mention") &&
            typeof input.name === "string" &&
            typeof input.path === "string"
        );
    }

    function resourceMentionLabel(input: { type: "skill" | "mention"; name: string }): string {
        return input.name.trim() || (input.type === "skill" ? "Skill" : "Plugin");
    }

    function isAttachmentText(input: any): input is { type: "text"; text: string } {
        if (!input || input.type !== "text") return false;
        const trimmed = (input.text || "").trim();
        if (!trimmed) return false;
        // 自动上下文不当作附件展示，避免噪声
        if (trimmed.startsWith("[Editor Context]")) return false;
        return true;
    }

    function deriveAttachmentLabel(input: { type: "text"; text: string }, index: number): string {
        const firstLine = (input.text || "").split(/\r?\n/)[0]?.trim() || "";
        if (!firstLine) return `Attachment ${index + 1}`;

        const basenameFromPath = (value: string): string => {
            const trimmed = (value || "").trim();
            if (!trimmed) return "";
            const parts = trimmed.split(/[\\/]/).filter(Boolean);
            return parts[parts.length - 1] || trimmed;
        };

        const splitTrailingMeta = (value: string): { base: string; meta: string | null } => {
            const trimmed = (value || "").trim();
            const match = trimmed.match(/^(.*)\s*\(([^)]*)\)\s*$/);
            if (!match) return { base: trimmed, meta: null };
            return { base: (match[1] || "").trim(), meta: (match[2] || "").trim() || null };
        };

        const fileMatch = firstLine.match(/^File:\s*(.+)$/i);
        if (fileMatch) {
            const { base, meta } = splitTrailingMeta(fileMatch[1] || "");
            const name = basenameFromPath(base) || "file";
            const range =
                meta && /^lines\s+/i.test(meta)
                    ? meta.replace(/^lines\s+/i, "").trim()
                    : "";
            return range ? `${name} ${range}` : name;
        }

        const dirMatch = firstLine.match(/^Directory:\s*(.+)$/i);
        if (dirMatch) {
            const { base } = splitTrailingMeta(dirMatch[1] || "");
            const name = basenameFromPath(base) || "/";
            return name.endsWith("/") ? name : `${name}/`;
        }

        const snippetMatch = firstLine.match(/^Snippet:\s*(.+)$/i);
        if (snippetMatch) return snippetMatch[1].trim();

        // 代码块或一般文本，截断展示
        const fallback = firstLine.replace(/^```+/, "").trim();
        return fallback.length > 40 ? `${fallback.slice(0, 37)}...` : fallback || `Attachment ${index + 1}`;
    }

    function deriveAttachmentIcon(input: { type: "text"; text: string }): "folder" | "file" | "snippet" {
        const firstLine = (input.text || "").split(/\r?\n/)[0]?.trim() || "";
        if (/^Directory:/i.test(firstLine)) return "folder";
        if (/^File:/i.test(firstLine)) return "file";
        return "snippet";
    }

    function deriveAttachmentTitle(input: { type: "text"; text: string }): string {
        const firstLine = (input.text || "").split(/\r?\n/)[0]?.trim() || "";
        return firstLine || "Attachment";
    }

    function updateReasoningIconLayout() {
        if (!reasoningContentEl) {
            reasoningIconLineHeight = 0;
            return;
        }
        const lineEl =
            (reasoningContentEl.querySelector("p") as HTMLElement | null) ||
            (reasoningContentEl.querySelector(".markdown-content") as HTMLElement | null) ||
            reasoningContentEl;
        const style = getComputedStyle(lineEl);
        let lineHeightPx = parseFloat(style.lineHeight);
        const fontSizePx = parseFloat(style.fontSize);
        if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
            lineHeightPx = Number.isFinite(fontSizePx) ? fontSizePx * 1.4 : 0;
        }
        reasoningIconLineHeight = Number.isFinite(lineHeightPx) && lineHeightPx > 0 ? lineHeightPx : 0;
    }

    function updateReasoningIconLayoutIfNeeded() {
        if (
            lastLayoutItem === item &&
            lastLayoutExpanded === isExpanded &&
            lastLayoutRenderAsReasoning === renderAsReasoning
        ) {
            return;
        }
        updateReasoningIconLayout();
        lastLayoutItem = item;
        lastLayoutExpanded = isExpanded;
        lastLayoutRenderAsReasoning = renderAsReasoning;
    }

    function decorateMarkdownAnchorsIfNeeded() {
        const text = typeof (item as any).text === "string" ? (item as any).text : "";
        const summary = summaryText || "";
        if (isStreaming) {
            lastDecoratedStreaming = true;
            return;
        }
        if (
            lastDecoratedItem === item &&
            lastDecoratedText === text &&
            lastDecoratedSummary === summary &&
            lastDecoratedExpanded === isExpanded &&
            !lastDecoratedStreaming
        ) {
            return;
        }
        decorateMarkdownAnchors(cardElement);
        lastDecoratedItem = item;
        lastDecoratedText = text;
        lastDecoratedSummary = summary;
        lastDecoratedExpanded = isExpanded;
        lastDecoratedStreaming = false;
    }

    onMount(() => {
        updateReasoningIconLayoutIfNeeded();
        decorateMarkdownAnchorsIfNeeded();
    });

    afterUpdate(() => {
        updateReasoningIconLayoutIfNeeded();
        decorateMarkdownAnchorsIfNeeded();
    });

    function coerceLineNumber(value: unknown): number | null {
        if (value === null || value === undefined) return null;
        const num = Number(value);
        if (!Number.isFinite(num)) return null;
        return Math.max(1, Math.floor(num));
    }

    function extractRangeFromArgs(args: Record<string, any> | null): { startLine: number; endLine: number } | null {
        if (!args || typeof args !== "object") return null;
        const candidates = [
            coerceLineNumber(args.start_line),
            coerceLineNumber(args.line_start),
            coerceLineNumber(args.startLine),
            coerceLineNumber(args.from),
        ];
        const endCandidates = [
            coerceLineNumber(args.end_line),
            coerceLineNumber(args.line_end),
            coerceLineNumber(args.endLine),
            coerceLineNumber(args.to),
        ];

        if (Array.isArray(args.lines) && args.lines.length > 0) {
            const start = coerceLineNumber(args.lines[0]);
            const end = coerceLineNumber(args.lines[args.lines.length - 1]);
            if (start !== null) candidates.push(start);
            if (end !== null) endCandidates.push(end);
        }

        if (Array.isArray(args.line_numbers) && args.line_numbers.length > 0) {
            const start = coerceLineNumber(args.line_numbers[0]);
            const end = coerceLineNumber(args.line_numbers[args.line_numbers.length - 1]);
            if (start !== null) candidates.push(start);
            if (end !== null) endCandidates.push(end);
        }

        const rangeObj = args.range || args.range_lines;
        if (rangeObj && typeof rangeObj === "object") {
            const rangeStart = coerceLineNumber(rangeObj.start ?? rangeObj.from);
            const rangeEnd = coerceLineNumber(rangeObj.end ?? rangeObj.to);
            if (rangeStart !== null) candidates.push(rangeStart);
            if (rangeEnd !== null) endCandidates.push(rangeEnd);
        }

        if (Array.isArray(args.ranges) && args.ranges.length > 0) {
            const firstRange = args.ranges[0];
            const lastRange = args.ranges[args.ranges.length - 1];
            const start = coerceLineNumber(firstRange?.start ?? firstRange?.from);
            const end = coerceLineNumber((lastRange?.end ?? lastRange?.to) ?? lastRange?.start);
            if (start !== null) candidates.push(start);
            if (end !== null) endCandidates.push(end);
        }

        const start = candidates.find((n) => typeof n === "number");
        const end = endCandidates.find((n) => typeof n === "number");
        if (typeof start === "number" && typeof end === "number") {
            return { startLine: start, endLine: Math.max(start, end) };
        }
        if (typeof start === "number") {
            return { startLine: start, endLine: start };
        }
        return null;
    }

    function extractRangeFromOutput(output: string): { startLine: number; endLine: number } | null {
        if (!output) return null;
        const matches = [...output.matchAll(/^L(\d+):/gm)].map((match) => Number(match[1]));
        if (matches.length === 0) return null;
        const start = Math.min(...matches);
        const end = Math.max(...matches);
        return { startLine: start, endLine: end };
    }

    function normalizePath(value: unknown): string | null {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }

    function collectPathsFromArgs(args: Record<string, any> | null): string[] {
        if (!args || typeof args !== "object") return [];
        const paths: string[] = [];
        const push = (value: unknown) => {
            const normalized = normalizePath(value);
            if (normalized) paths.push(normalized);
        };

        push(args.file_path);
        push(args.path);
        push(args.file);
        push(args.target);
        if (Array.isArray(args.paths)) {
            args.paths.forEach(push);
        }
        if (Array.isArray(args.files)) {
            args.files.forEach(push);
        }
        return paths;
    }

    function getReadFileTargets(item: any): ReadFileTarget[] {
        if (item.type !== "functionToolCall" || item.toolName !== "read_file") return [];
        const parsedArgs = parseToolArguments(item.arguments) as Record<string, any> | null;
        const paths = collectPathsFromArgs(parsedArgs);

        if (paths.length === 0) {
            const fallback = getToolArgValue(item, "file_path") || getToolArgValue(item, "path") || getToolArgValue(item, "file");
            if (fallback) paths.push(fallback);
        }

        if (paths.length === 0) {
            return [];
        }

        const range = extractRangeFromArgs(parsedArgs) || extractRangeFromOutput(item.output);

        return paths.map((path, index) => {
            const label = path.split(/[/\\]/).pop() || path;
            return {
                id: `${path}-${index}`,
                label,
                path,
                startLine: range?.startLine ?? null,
                endLine: range?.endLine ?? null,
            };
        });
    }

    async function openReadFileTarget(target: ReadFileTarget) {
        if (!target.path) {
            addNotification(NotifType.Warning, "无法打开文件", [], "Agent 未提供文件路径");
            return;
        }
        const line = target.startLine ?? 1;
        try {
            await openFileAtLine(target.path, line, 1);
        } catch (error) {
            console.error("Failed to open file from read_file card", error);
            addNotification(NotifType.Error, "打开文件失败", [], target.path);
        }
    }

    interface DirectoryEntry {
        name: string;
        isDirectory: boolean;
        indent: number;
    }

    function parseDirectoryListing(output: string): DirectoryEntry[] {
        const lines = output.split('\n').filter(l => l.trim());
        const entries: DirectoryEntry[] = [];
        
        for (const line of lines) {
            // Skip the "Absolute path:" line
            if (line.startsWith('Absolute path:')) continue;
            
            // Calculate indentation level
            const indent = line.search(/\S/);
            const name = line.trim();
            
            // Check if it's a directory (ends with /)
            const isDirectory = name.endsWith('/');
            const displayName = isDirectory ? name.slice(0, -1) : name;
            
            entries.push({
                name: displayName,
                isDirectory,
                indent: Math.floor(indent / 2), // Convert spaces to indent level
            });
        }
        
        return entries;
    }

    type OutputLineStats = {
        source: string;
        lineCount: number;
        completedNonEmptyLines: number;
        trailingLineHasContent: boolean;
    };

    let outputLineStatsCache: OutputLineStats | null = null;

    function scanOutputLineStats(output: string): OutputLineStats {
        const cached = outputLineStatsCache;
        if (cached?.source === output) return cached;

        let lineCount = 1;
        let completedNonEmptyLines = 0;
        let trailingLineHasContent = false;

        // Command output normally grows by appending deltas. Re-scan only the
        // suffix in that case; a replacement falls back to a full scan.
        const start = cached && output.startsWith(cached.source) ? cached.source.length : 0;
        if (start > 0) {
            lineCount = cached.lineCount;
            completedNonEmptyLines = cached.completedNonEmptyLines;
            trailingLineHasContent = cached.trailingLineHasContent;
        }

        for (let index = start; index < output.length; index += 1) {
            const character = output[index];
            if (character === "\n") {
                if (trailingLineHasContent) completedNonEmptyLines += 1;
                trailingLineHasContent = false;
                lineCount += 1;
            } else if (!/\s/.test(character)) {
                trailingLineHasContent = true;
            }
        }

        const next: OutputLineStats = {
            source: output,
            lineCount,
            completedNonEmptyLines,
            trailingLineHasContent,
        };
        outputLineStatsCache = next;
        return next;
    }

    function getToolCallSummary(toolName: string, output: string, args?: string): string {
        const parsedArgs = parseToolArguments(args);
        
        switch (toolName) {
            case "grep_files": {
                const lineStats = scanOutputLineStats(output ?? "");
                const nonEmptyLineCount =
                    lineStats.completedNonEmptyLines + (lineStats.trailingLineHasContent ? 1 : 0);
                const pattern = parsedArgs?.pattern || parsedArgs?.query || '(unknown)';
                return `Search "${pattern}" → ${nonEmptyLineCount} file(s)`;
            }
            case "request_user_input":
                {
                    const questionCount =
                        Array.isArray(parsedArgs?.questions) ? parsedArgs.questions.length : null;
                    const suffix = typeof questionCount === "number" ? ` (${questionCount})` : "";
                    return `Request input${suffix}`;
                }
            case "read_file": {
                const lineStats = scanOutputLineStats(output ?? "");
                // Try to extract file path from output if not in args
                let filePath = parsedArgs?.file_path || parsedArgs?.path || parsedArgs?.file;
                if (!filePath && output.includes('L1:')) {
                    // File content format, try to get from context
                    filePath = '(file)';
                }
                const fileName = filePath ? (filePath.split(/[/\\]/).pop() || filePath) : '(unknown)';
                return `Read ${fileName} (${lineStats.lineCount} lines)`;
            }
            case "list_dir":
                // Try to extract directory from output
                let dirPath = parsedArgs?.path || parsedArgs?.directory;
                if (!dirPath && output.startsWith('Absolute path:')) {
                    const match = output.match(/Absolute path:\s*(.+)/);
                    if (match) dirPath = match[1].trim();
                }
                // Keep the full directory path in the summary. Basenames are often
                // identical across a workspace, making `List backend` ambiguous.
                return `List ${dirPath || '(unknown)'}`;
            default:
                return `Tool: ${toolName}`;
        }
    }

    // 渲染用类型：中间 agentMessage 可以按 reasoning 处理
    $: displayType =
        item.type === "agentMessage" && renderAsReasoning ? "reasoning" : item.type;

    let summary: ItemSummary = "";
    let summaryText = "";

    $: IconComponent =
        displayType === "functionToolCall" && typeof summary === "object" && summary.icon
            ? summary.icon
            : getIcon(displayType);
    $: color =
        displayType === "functionToolCall"
            ? getToolColor((item as any).toolName)
            : getColor(displayType);
    $: summary = getSummary(item);
    $: summaryText = typeof summary === "object" ? summary.text : summary;
    $: isReadFileTool = displayType === "functionToolCall" && (item as any).toolName === "read_file";
    $: readFileTargets = isReadFileTool ? getReadFileTargets(item) : [];
    $: collapsible = isReadFileTool ? false : isCollapsible(item, displayType);
    $: status = (item as any).status;
    $: StatusIcon = status ? getStatusIcon(status) : null;
    $: statusColor = status ? getStatusColor(status) : "";
    $: showStreamingIndicator = isStreaming && collapsible;
    // Inline图标：中间 agentMessage 用单独的总结图标，其它沿用默认 IconComponent
    $: inlineIcon =
        item.type === "agentMessage" && renderAsReasoning ? MessageSquare : IconComponent;
    $: agentMessageMarkdownContent =
        item.type === "agentMessage" ? renderMarkdownContent(item.text || "") : "";

    // 右键菜单 / 复制支持
    let cardElement: HTMLDivElement | null = null;
    $: commandText =
        item.type === "commandExecution" && typeof item.command === "string"
            ? formatCommandForDisplay(item.command)
            : "";
    $: commandOutputTextRaw =
        item.type === "commandExecution" && typeof item.aggregatedOutput === "string"
            ? item.aggregatedOutput
            : "";
    const COMMAND_OUTPUT_PREVIEW_LIMIT = 80_000;
    const COMMAND_OUTPUT_HEAD_CHARS = 48_000;
    const COMMAND_OUTPUT_TAIL_CHARS = 24_000;
    let cachedCommandOutputRaw: string | null = null;
    let cachedCommandOutputPreview: {
        text: string;
        truncated: boolean;
        omittedChars: number;
    } | null = null;

    function buildCommandOutputPreview(output: string): {
        text: string;
        truncated: boolean;
        omittedChars: number;
    } {
        if (cachedCommandOutputRaw === output && cachedCommandOutputPreview) {
            return cachedCommandOutputPreview;
        }

        let preview: {
            text: string;
            truncated: boolean;
            omittedChars: number;
        };
        if (!output) {
            preview = { text: "", truncated: false, omittedChars: 0 };
        } else if (output.length <= COMMAND_OUTPUT_PREVIEW_LIMIT) {
            preview = { text: output.trim(), truncated: false, omittedChars: 0 };
        } else {
            const head = output.slice(0, COMMAND_OUTPUT_HEAD_CHARS).trimEnd();
            const tail = output.slice(-COMMAND_OUTPUT_TAIL_CHARS).trimStart();
            const omittedChars = Math.max(0, output.length - head.length - tail.length);
            preview = {
                text: `${head}\n\n... output truncated, ${formatCompactNumber(omittedChars)} characters omitted ...\n\n${tail}`,
                truncated: true,
                omittedChars,
            };
        }

        cachedCommandOutputRaw = output;
        cachedCommandOutputPreview = preview;
        return preview;
    }

    function formatCompactNumber(value: number): string {
        if (!Number.isFinite(value)) return "0";
        return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(value)));
    }

    $: commandOutputPreview = buildCommandOutputPreview(commandOutputTextRaw);
    $: commandOutputText = commandOutputPreview.text;
    $: commandMetaParts = (() => {
        if (item.type !== "commandExecution") return [];
        const parts: string[] = [];
        if (status) parts.push(`Status: ${status}`);
        if (typeof item.exitCode === "number") parts.push(`exit ${item.exitCode}`);
        if (typeof item.durationMs === "number") parts.push(`${item.durationMs}ms`);
        return parts;
    })();

    const copyLabel = "复制";
    const copyShortcut = (() => {
        if (typeof navigator !== "undefined") {
            const platform = navigator.platform?.toLowerCase?.() ?? "";
            if (platform.includes("mac")) {
                return "⌘ + C";
            }
        }
        return "Ctrl + C";
    })();

    async function copyTextPayload(text: string): Promise<boolean> {
        if (!text) return false;
        try {
            await writeText(text);
            return true;
        } catch (_) {
            try {
                if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                    return true;
                }
            } catch (_) {
                return false;
            }
        }
        return false;
    }

    function getSelectedTextInCard(): string {
        if (typeof window === "undefined") return "";
        const selection = window.getSelection?.();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
        const text = selection.toString();
        if (!text) return "";
        if (!cardElement) return text;
        const anchor = selection.anchorNode;
        const focus = selection.focusNode;
        const anchorInside = anchor ? cardElement.contains(anchor) || anchor === cardElement : false;
        const focusInside = focus ? cardElement.contains(focus) || focus === cardElement : false;
        return anchorInside && focusInside ? text : "";
    }

    async function handleCopyFromCard() {
        const selected = getSelectedTextInCard();
        const fallback = cardElement?.innerText?.trim?.() ?? "";
        const text = selected || fallback;
        if (!text) return;
        void copyTextPayload(text);
    }

    function isCopyShortcut(event: KeyboardEvent): boolean {
        const key = event.key?.toLowerCase?.() ?? "";
        if (key !== "c") return false;
        const platform = typeof navigator !== "undefined" ? navigator.platform?.toLowerCase?.() ?? "" : "";
        const isMac = platform.includes("mac");
        if (isMac) {
            return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
        }
        return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (!isCopyShortcut(event)) return;
        const text = getSelectedTextInCard();
        if (!text) return;
        event.preventDefault();
        void copyTextPayload(text);
    }

    function handleContextMenu(event: MouseEvent) {
        event.preventDefault();
        const items = [
            {
                name: copyLabel,
                shortcut: copyShortcut,
                action: () => {
                    void handleCopyFromCard();
                },
            },
        ];
        openContextMenu(items, event.clientX, event.clientY);
    }
</script>

<div 
    class="thread-item-card" 
    bind:this={cardElement}
    class:user-message={displayType === "userMessage"}
    class:agent-message={displayType === "agentMessage"}
    class:reasoning={displayType === "reasoning"}
    class:file-change-card={item.type === "fileChange"}
    class:streaming={showStreamingIndicator}
    tabindex="0"
    on:contextmenu={handleContextMenu}
    on:keydown={handleKeyDown}
    style="--item-color: {color}"
>
{#if isReadFileTool}
        <div class="read-file-row">
            <div class="read-file-label">
            {#if !hideLeadingIcon}
                <BookOpenCheck size="1em" style="color: {getToolColor('read_file')}" />
            {/if}
            <span>Read </span>
        </div>
        <div class="read-file-row-pills">
            {#if readFileTargets.length === 0}
                <span class="read-file-empty">Path unavailable</span>
            {:else}
                {#each readFileTargets as target (target.id)}
                    <button
                        type="button"
                        class="read-file-pill"
                        title={target.path || target.label}
                        on:click={() => openReadFileTarget(target)}
                    >
                        <span class="pill-icon" aria-hidden="true">
                            <FileTypeIcon filename={target.label} />
                        </span>
                        <span class="pill-name">{target.label}</span>
                        {#if typeof target.startLine === "number"}
                            <span class="pill-range">
                                L{target.startLine}
                                {#if target.endLine && target.endLine !== target.startLine}
                                    –{target.endLine}
                                {/if}
                            </span>
                        {/if}
                    </button>
                {/each}
            {/if}
        </div>
    </div>
{:else if collapsible}
    {#if item.type === "fileChange"}
        {#each item.changes || [] as change, index (change.path + ":" + index)}
            <FileDiffViewer
                {change}
                defaultExpanded={(item.changes?.length || 0) <= 2}
                tone="default"
                topGap={index === 0 ? 0 : 12}
            />
        {/each}
    {:else}
        <!-- 可折叠的 Item -->
        <button class="item-header" on:click={() => (isExpanded = !isExpanded)}>
            <div class="header-left">
                {#if !hideLeadingIcon}
                    <svelte:component this={IconComponent} size="1em" class="item-icon" />
                {/if}
                {#if displayType === "reasoning"}
                    <!-- Reasoning 标题用 markdown 渲染 -->
                    <div class="item-summary-markdown" on:click={handleReferenceClick}>
                        <MarkdownRenderer
                            content={normalizeMarkdown(summaryText)}
                            mediaBaseDir={mediaBaseDir}
                            plain
                            enhance={!isStreaming}
                        />
                    </div>
                {:else}
                    <span class="item-summary">{summaryText}</span>
                {/if}
                {#if showStreamingIndicator}
                    <span class="streaming-indicator">
                        <svelte:component this={getStatusIcon("inProgress")} size="1em" class="streaming-icon" />
                        <span class="streaming-text">Processing</span>
                    </span>
                {/if}
            </div>
            <div class="header-right">
                {#if StatusIcon}
                    <svelte:component
                        this={StatusIcon}
                        size="1em"
                        class="status-icon {status === 'inProgress' ? 'spinning' : ''}"
                        style="color: {statusColor}"
                    />
                {/if}
                <svelte:component
                    this={isExpanded ? ChevronDown : ChevronRight}
                    size="1em"
                    class="chevron"
                />
            </div>
        </button>

        {#if isExpanded}
            <!-- Reasoning 类型不显示详情 -->
            <div class="item-content">
                {#if item.type === "commandExecution"}
                    <div class="command-simple">
                        {#if commandText}
                            <pre class="command-line-simple">{commandText}</pre>
                        {/if}
                        {#if commandOutputText}
                            <div class="command-output-shell">
                                {#if commandOutputPreview.truncated}
                                    <div class="command-output-notice">
                                        Output preview truncated from
                                        {formatCompactNumber(commandOutputTextRaw.length)}
                                        characters.
                                    </div>
                                {/if}
                                <pre
                                    class="command-output-simple"
                                    class:truncated={commandOutputPreview.truncated}
                                >{commandOutputText}</pre>
                            </div>
                        {/if}
                        {#if commandMetaParts.length}
                            <div class="command-meta-text subtle">
                                {commandMetaParts.join(" · ")}
                            </div>
                        {/if}
                    </div>
                {:else if item.type === "webSearch"}
                    <div class="web-search-card">
                        <div class="web-search-eyebrow">Web search</div>
                        <div class="web-search-query">
                            <Globe2 size="1em" class="web-search-icon" />
                            <span>{item.query}</span>
                        </div>
                    </div>
                {:else if item.type === "subAgentActivity"}
                    <div class="protocol-event-card subagent-activity-card">
                        <div class="protocol-event-title">
                            <GitBranch size="1em" aria-hidden="true" />
                            <span>{summaryText}</span>
                        </div>
                        <div class="protocol-event-meta">
                            <code>{item.agentPath}</code>
                            <span class="protocol-event-id">{item.agentThreadId}</span>
                        </div>
                        {#if item.agentThreadId}
                            <button
                                type="button"
                                class="protocol-event-link"
                                on:click={() => dispatch("openThread", { threadId: item.agentThreadId })}
                            >
                                Open subagent thread
                            </button>
                        {/if}
                    </div>
                {:else if item.type === "sleep"}
                    <div class="protocol-event-card sleep-card">
                        <div class="protocol-event-title">
                            <PauseCircle size="1em" aria-hidden="true" />
                            <span>{summaryText}</span>
                        </div>
                    </div>
                {:else if item.type === "dynamicToolCall"}
                    <div class="protocol-event-card dynamic-tool-card">
                        <div class="protocol-event-title">
                            <Wrench size="1em" aria-hidden="true" />
                            <span>{summaryText}</span>
                            <span class="protocol-event-status">{item.status}</span>
                        </div>
                        {#if item.contentItems?.length}
                            <div class="protocol-event-output">
                                {#each item.contentItems as contentItem}
                                    {#if contentItem.type === "inputText"}
                                        <span>{contentItem.text}</span>
                                    {:else}
                                        <span>{contentItem.type === "inputImage" ? "Image output" : "Audio output"}</span>
                                    {/if}
                                {/each}
                            </div>
                        {/if}
                        <details class="protocol-event-details">
                            <summary>Technical details</summary>
                            <pre>{JSON.stringify(item.arguments, null, 2)}</pre>
                        </details>
                    </div>
                {:else if item.type === "hookPrompt"}
                    <div class="protocol-event-card hook-prompt-card">
                        <div class="protocol-event-title">
                            <MessageSquare size="1em" aria-hidden="true" />
                            <span>Hook prompt</span>
                        </div>
                        {#each item.fragments ?? [] as fragment (fragment.hookRunId)}
                            <div class="hook-prompt-fragment">{fragment.text}</div>
                        {/each}
                    </div>
                {:else if item.type === "todoList"}
                    <div class="todo-list">
                        {#each item.items || [] as todo}
                            <div class="todo-item">
                                <input type="checkbox" checked={todo.completed} disabled />
                                <span class:completed={todo.completed}>{todo.text}</span>
                            </div>
                        {/each}
                    </div>
                {:else if item.type === "collabAgentToolCall"}
                    {@const collabTask = getCollabTaskSummary(item)}
                    <div class="collab-card">
                        {#if item.tool === "spawnAgent" && collabTask}
                            <div class="collab-task-log">
                                <div class="collab-task-prefix">└</div>
                                <div class="collab-task-text">
                                    {collabTask}
                                </div>
                            </div>
                        {:else if item.tool === "wait"}
                            {@const states = Object.entries(item.agentsStates ?? {})}
                            {#if states.length > 0}
                                <div class="collab-wait-states">
                                    {#each states as [agentId, state] (agentId)}
                                        <div class="collab-wait-row">
                                            <span class="collab-wait-agent">{agentId}</span>
                                            <span class="collab-wait-status">{state?.status ?? "unknown"}</span>
                                            {#if state?.message}
                                                <div class="collab-wait-message">{state.message}</div>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {:else}
                                <div class="collab-task-log">
                                    <div class="collab-task-prefix">└</div>
                                    <div class="collab-task-text subtle">No agent state yet.</div>
                                </div>
                            {/if}
                        {/if}
                    </div>
                {:else if item.type === "mcpToolCall" && getBrowserUsePolicyRejectionMessage(item)}
                    <div class="browser-policy-card">
                        <div class="browser-policy-title">Browser Use security policy</div>
                        <div class="browser-policy-message">
                            {getBrowserUsePolicyRejectionMessage(item)}
                        </div>
                        {#if getMcpToolCallOutput(item)}
                            <details class="browser-policy-details">
                                <summary>原始错误</summary>
                                <pre>{getMcpToolCallOutput(item)}</pre>
                            </details>
                        {/if}
                    </div>
                {:else if item.type === "mcpToolCall" && getChromeBrowserRecoveryMessage(item)}
                    <div class="chrome-tool-recovery-card">
                        <div class="chrome-tool-recovery-title">Chrome browser connection</div>
                        <div class="chrome-tool-recovery-message">
                            {getChromeBrowserRecoveryMessage(item)}
                        </div>
                        {#if getMcpToolCallOutput(item)}
                            <details class="chrome-tool-recovery-details">
                                <summary>原始错误</summary>
                                <pre>{getMcpToolCallOutput(item)}</pre>
                            </details>
                        {/if}
                    </div>
                {:else if item.type === "mcpToolCall" && isBrowserUseMcpCall(item)}
                    <div class="browser-use-card" class:failed={item.status === "failed"}>
                        <div class="browser-use-head">
                            <div class="browser-use-icon">
                                <Globe2 size="1em" />
                            </div>
                            <div class="browser-use-copy">
                                <div class="browser-use-title">{getBrowserUseTitle(item)}</div>
                                <div class="browser-use-meta">
                                    <span>{getBrowserUseStatusLabel(item)}</span>
                                    {#if getBrowserUseDurationLabel(item)}
                                        <span>{getBrowserUseDurationLabel(item)}</span>
                                    {/if}
                                </div>
                            </div>
                        </div>
                        {#if item.status === "failed" && getChromeBrowserRecoveryMessage(item)}
                            <div class="browser-use-message">
                                {getChromeBrowserRecoveryMessage(item)}
                            </div>
                        {:else if getBrowserUseOutputSummary(item)}
                            <div class="browser-use-message">
                                {getBrowserUseOutputSummary(item)}
                            </div>
                        {/if}
                        <details class="browser-use-details">
                            <summary>技术详情</summary>
                            <pre>{getBrowserUseTechnicalDetails(item)}</pre>
                        </details>
                    </div>
                {:else if item.type === "functionToolCall"}
                    <div class="function-tool-call">
                        {#if item.toolName === "list_dir"}
                            <div class="directory-listing">
                                {#each parseDirectoryListing(item.output) as entry}
                                    <div 
                                        class="dir-entry" 
                                        class:is-directory={entry.isDirectory}
                                        style="padding-left: {8 + entry.indent * 16}px"
                                    >
                                        <svelte:component 
                                            this={entry.isDirectory ? FolderTree : FileText} 
                                            size="1em"
                                            class="entry-icon"
                                        />
                                        <span class="entry-name">{entry.name}</span>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <pre class="tool-output" class:code-content={item.toolName === 'read_file'}>{formatToolOutput(item)}</pre>
                        {/if}
                    </div>
                {:else if item.type === "enteredReviewMode"}
                    <div class="review-mode-card">
                        <div class="review-mode-title">
                            {item.review || "Code review"}
                        </div>
                        <div class="review-mode-subtitle">
                            Review mode started
                        </div>
                    </div>
                {:else if item.type === "exitedReviewMode"}
                    <div class="review-mode-card">
                        <div class="review-mode-title">
                            {item.review || "Code review"}
                        </div>
                        <div class="review-mode-subtitle">
                            Review mode completed
                        </div>
                    </div>
                {:else if item.type === "imageView"}
                    <div class="image-view-card">
                        <ImagePreview path={item.path} />
                    </div>
                {:else if item.type === "imageGeneration"}
                    {@const savedPath = getImageGenerationSavedPath(item)}
                    {@const revisedPrompt = getImageGenerationRevisedPrompt(item)}
                    <div class="image-generation-card">
                        {#if savedPath}
                            <ImagePreview path={savedPath} />
                            <div class="image-generation-meta">
                                {#if revisedPrompt}
                                    <div class="image-generation-prompt">{revisedPrompt}</div>
                                {/if}
                                <div class="image-generation-path">{savedPath}</div>
                            </div>
                        {:else}
                            {#if revisedPrompt}
                                <div class="image-generation-prompt">{revisedPrompt}</div>
                            {/if}
                            <div class="image-generation-empty">
                                No saved image path was recorded for this result.
                            </div>
                        {/if}
                    </div>
                {:else if item.type === "plan"}
                    <div class="markdown-wrapper plan" on:click={handleReferenceClick}>
                        <MarkdownRenderer
                            content={renderMarkdownContent(item.text || "")}
                            mediaBaseDir={mediaBaseDir}
                            enhance={!isStreaming}
                        />
                    </div>
                {:else if item.type === "contextCompaction"}
                    <div class="context-compaction-card">
                        <div class="context-compaction-title">Context compacted</div>
                        <div class="context-compaction-subtitle subtle">
                            The assistant summarized earlier messages to stay within the context window.
                        </div>
                    </div>
                {:else}
                    <div class="generic-content">
                        <pre>{JSON.stringify(item, null, 2)}</pre>
                    </div>
                {/if}
            </div>
        {/if}
    {/if}
{:else}
    <!-- 不可折叠的 Item (UserMessage, AgentMessage, Reasoning-like) -->
    <div class="item-simple">
            {#if item.type === "userMessage"}
                {@const content = item.content || []}
                {@const firstText = content.find((input) => input.type === "text")}
                {@const rest = content.filter((input) => input !== firstText)}
                {@const attachmentTexts = rest.filter((input) => isAttachmentText(input))}
                {@const attachmentImages = rest.filter((input) => isImageInput(input))}
                {@const resourceMentions = rest.filter((input) => isResourceMentionInput(input))}
                {#if isReviewPrompt}
                    <div class="review-prompt-card">
                        {#if firstText}
                            <p>{firstText.text}</p>
                        {/if}
                    </div>
                {:else}
                    <div class="simple-content">
                        {#if resourceMentions.length}
                            <div class="resource-mention-row" aria-label="Codex resources">
                                {#each resourceMentions as mention}
                                    <div
                                        class:plugin={mention.type === "mention"}
                                        class="resource-mention-chip"
                                        title={mention.path}
                                    >
                                        {#if mention.type === "mention"}
                                            <Puzzle size="1em" class="resource-mention-icon" aria-hidden="true" />
                                        {:else}
                                            <BookOpenCheck size="1em" class="resource-mention-icon" aria-hidden="true" />
                                        {/if}
                                        <span class="resource-mention-label">{resourceMentionLabel(mention)}</span>
                                        <span class="resource-mention-kind">{mention.type === "mention" ? "Plugin" : "Skill"}</span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                        {#if attachmentTexts.length}
                            <div class="attachment-row in-bubble">
                                {#each attachmentTexts as input, idx}
                                    {@const iconKind = deriveAttachmentIcon(input)}
                                    <div class="attachment-chip" title={deriveAttachmentTitle(input)}>
                                        {#if iconKind === "folder"}
                                            <FolderTree size="1em" class="attachment-icon" />
                                        {:else}
                                            <FileText size="1em" class="attachment-icon" />
                                        {/if}
                                        <span class="attachment-label">{deriveAttachmentLabel(input, idx)}</span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                        {#if firstText}
                            <p>{firstText.text}</p>
                        {/if}
                        {#each attachmentImages as input}
                            {#if input.type === "image"}
                                <!-- svelte-ignore a11y-img-redundant-alt -->
                                <img src={getAttachmentImageSrc(input)} alt="User upload" />
                            {:else if input.type === "localImage"}
                                <!-- svelte-ignore a11y-img-redundant-alt -->
                                <img src={getAttachmentImageSrc(input)} alt="Local upload" />
                            {/if}
                        {/each}
                    </div>
                {/if}
            {:else if item.type === "agentMessage" && !renderAsReasoning}
                <div class="simple-content">
                    {#if isToolOutput(item.text)}
                        {@const toolInfo = parseToolOutput(item.text)}
                        {#if toolInfo}
                                <div class="tool-output-card">
                                <div class="tool-header">
                                    <svelte:component this={getToolIcon(toolInfo.type)} size="1em" class="tool-header-icon" />
                                    <span class="tool-name">{toolInfo.name}</span>
                                </div>
                                <div class="tool-content">
                                    {#if toolInfo.type === 'grep_files'}
                                        <div class="file-search-results">
                                            <div class="search-info">
                                                Pattern: <code>{toolInfo.pattern}</code>
                                                {#if toolInfo.matchCount}
                                                    · {toolInfo.matchCount} matches
                                                {/if}
                                            </div>
                                            <pre class="tool-results">{toolInfo.content}</pre>
                                        </div>
                                    {:else if toolInfo.type === 'read_file'}
                                        <div class="file-read-content">
                                            <div class="file-info">
                                                File: <code>{toolInfo.path}</code>
                                            </div>
                                            <pre class="tool-results">{toolInfo.content}</pre>
                                        </div>
                                    {:else if toolInfo.type === 'list_dir'}
                                        <div class="directory-listing">
                                            <div class="dir-info">
                                                Directory: <code>{toolInfo.path}</code>
                                            </div>
                                            <pre class="tool-results">{toolInfo.content}</pre>
                                        </div>
                                    {:else}
                                        <pre class="tool-results">{toolInfo.content}</pre>
                                    {/if}
                                </div>
                            </div>
                        {:else}
                                <div class="markdown-wrapper reasoning" on:click={handleReferenceClick}>
                                <MarkdownRenderer
                                    content={agentMessageMarkdownContent}
                                    mediaBaseDir={mediaBaseDir}
                                    enhance={!isStreaming}
                                />
                            </div>
                        {/if}
                    {:else}
                        <div class="markdown-wrapper" on:click={handleReferenceClick}>
                            <MarkdownRenderer
                                content={agentMessageMarkdownContent}
                                mediaBaseDir={mediaBaseDir}
                                enhance={!isStreaming}
                            />
                        </div>
                        {/if}
                </div>
            {:else if item.type === "collabAgentToolCall"}
                <div class="collab-row">
                    <div class="collab-row-left">
                        {#if !hideLeadingIcon}
                            <svelte:component
                                this={getCollabToolIcon(item.tool)}
                                size="1em"
                                class="collab-row-icon"
                            />
                        {/if}
                        <span class="collab-row-title">
                            {item.tool === "spawnAgent" ? "Spawned subagent" : getCollabEventTitle(item)}
                        </span>
                    </div>
                    <div class="collab-row-right">
                        {#if item.tool === "spawnAgent"}
                            {#if getCollabModelTag(item)}
                                <span class="collab-chip">{getCollabModelTag(item)}</span>
                            {/if}
                        {:else if (item.receiverThreadIds?.length ?? 0) > 0}
                            <span class="collab-chip">{item.receiverThreadIds.length} agent(s)</span>
                        {/if}
                        {#if StatusIcon}
                            <svelte:component
                                this={StatusIcon}
                                size="1em"
                                class="status-icon {status === 'inProgress' ? 'spinning' : ''}"
                                style="color: {statusColor}"
                            />
                        {/if}
                    </div>
                </div>
                {#if item.tool === "spawnAgent" && item.prompt}
                    <div class="collab-row-prompt">
                        <span class="collab-row-branch">└</span>
                        <div class="collab-row-prompt-text">{item.prompt.trim()}</div>
                    </div>
                {/if}
            {:else if item.type === "imageGeneration"}
                {@const savedPath = getImageGenerationSavedPath(item)}
                <div class="image-generation-card">
                    <div class="image-generation-summary-col">
                        {#if summaryText}
                            <div class="image-generation-header">
                                <div class="image-generation-summary markdown-wrapper" on:click={handleReferenceClick}>
                                    <MarkdownRenderer
                                        content={renderMarkdownContent(summaryText)}
                                        mediaBaseDir={mediaBaseDir}
                                        enhance={!isStreaming}
                                    />
                                </div>
                            </div>
                        {/if}
                    </div>
                    {#if savedPath}
                        <div class="image-generation-preview-col">
                            <div class="image-generation-preview">
                                <ImagePreview path={savedPath} />
                            </div>
                        </div>
                    {:else}
                        <div class="image-generation-empty">
                            No saved image path was recorded for this result.
                        </div>
                    {/if}
                </div>
            {:else if item.type === "reasoning" || (item.type === "agentMessage" && renderAsReasoning)}
                <div class="reasoning-inline">
                    {#if !hideLeadingIcon}
                        <span
                            class="thinking-icon-wrapper"
                            bind:this={reasoningIconWrapper}
                            style={`height: ${reasoningIconLineHeight || 0}px`}
                        >
                            <svelte:component
                                this={inlineIcon}
                                size="1em"
                                class={
                                    item.type === "agentMessage" && renderAsReasoning
                                        ? isStreaming
                                            ? "summary-icon pulsing"
                                            : "summary-icon"
                                        : isStreaming
                                            ? "thinking-icon pulsing"
                                            : "thinking-icon"
                                }
                            />
                        </span>
                    {/if}
                    <div class="reasoning-body" bind:this={reasoningContentEl}>
                        {#if item.type === "reasoning"}
                            {#if item.content && item.content.length > 0}
                                <div class="reasoning-content">
                                    {#each item.content as contentText}
                                        {#if contentText}
                                            <div class="markdown-wrapper reasoning" on:click={handleReferenceClick}>
                                                <MarkdownRenderer
                                                    content={normalizeMarkdown(contentText)}
                                                    mediaBaseDir={mediaBaseDir}
                                                    plain
                                                    enhance={!isStreaming}
                                                />
                                            </div>
                                        {/if}
                                    {/each}
                                </div>
                            {:else if hasReasoningSummaryBody}
                                <div class="reasoning-content">
                                    <div class="markdown-wrapper reasoning" on:click={handleReferenceClick}>
                                        <MarkdownRenderer
                                            content={normalizeMarkdown(reasoningSummaryBody)}
                                            mediaBaseDir={mediaBaseDir}
                                            plain
                                            enhance={!isStreaming}
                                        />
                                    </div>
                                </div>
                            {/if}
                        {:else}
                            <!-- agentMessage 作为 reasoning 展示，直接用 text -->
                            {#if item.text}
                                <div class="reasoning-content">
                                    <div class="markdown-wrapper reasoning" on:click={handleReferenceClick}>
                                        <MarkdownRenderer
                                            content={normalizeMarkdown(item.text)}
                                            mediaBaseDir={mediaBaseDir}
                                            plain
                                            enhance={!isStreaming}
                                        />
                                    </div>
                                </div>
                            {/if}
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .thread-item-card {
        --row-height: 32px;
        --icon-column-width: calc(var(--ai-font-size, 14px) - 2px);
        --web-search-bg: rgba(18, 20, 26, 0.82);
        --web-search-border: rgba(255, 255, 255, 0.08);
        margin-bottom: 1px;
        border-radius: 4px;
        background: transparent;
        border: none;
        overflow: hidden;
        transition: background 0.12s ease, box-shadow 0.12s ease;
        padding: 0;
        user-select: text;
        -webkit-user-select: text;
    }

    :global(html[data-theme="light"]) .thread-item-card {
        --web-search-bg: rgba(248, 250, 252, 0.96);
        --web-search-border: rgba(15, 23, 42, 0.12);
    }

    .thread-item-card.file-change-card {
        background: transparent;
        border: none;
        border-radius: 0;
        overflow: visible;
    }

    .thread-item-card.file-change-card:hover {
        border: none;
        box-shadow: none;
    }

    /* 暗色主题下展开时的轮廓 */
    :global(.thread-item-card.file-change-card .file-diff-header) {
        border-radius: 8px;
        transition: background 0.12s ease, box-shadow 0.12s ease;
    }

    :global(.thread-item-card.file-change-card .file-diff-header.expanded) {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
    }

    :global(.thread-item-card.file-change-card .file-diff-header:hover) {
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
    }

    :global(.thread-item-card.file-change-card .file-diff-content) {
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
    }

    :global(html[data-theme="light"] .thread-item-card.file-change-card .file-diff-header) {
        border-radius: 8px;
        transition: background 0.12s ease, box-shadow 0.12s ease;
    }

    :global(html[data-theme="light"] .thread-item-card.file-change-card .file-diff-header.expanded) {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        background: rgba(15, 23, 42, 0.04);
        box-shadow:
            inset 0 0 0 1px rgba(15, 23, 42, 0.08),
            0 2px 6px rgba(15, 23, 42, 0.08);
    }

    :global(html[data-theme="light"] .thread-item-card.file-change-card .file-diff-header:hover) {
        background: rgba(15, 23, 42, 0.04);
        box-shadow:
            inset 0 0 0 1px rgba(15, 23, 42, 0.08),
            0 2px 6px rgba(15, 23, 42, 0.08);
    }

    /* 展开时的内容区域也添加轮廓 */
    :global(html[data-theme="light"] .thread-item-card.file-change-card .file-diff-content) {
        box-shadow:
            inset 0 0 0 1px rgba(15, 23, 42, 0.08),
            0 2px 6px rgba(15, 23, 42, 0.08);
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
    }

    .thread-item-card:hover {
        background: transparent;
        border: none;
        /* 只用内外阴影画轮廓，不改变布局 */
        box-shadow:
            0 0 0 1px var(--border-color, #333);
    }

    .thread-item-card.streaming {
        background: transparent;
        box-shadow: none;
    }

    /* 用户消息靠右 */
    .thread-item-card.user-message {
        margin-left: auto;
        max-width: 80%;
        background: rgba(59, 130, 246, 0.12);
    }

    /* AI 消息靠左，使用稍亮的灰色背景 */
    .thread-item-card.agent-message {
        position: relative;
        max-width: 100%;
        background: transparent;
        box-shadow: none;
    }

    /* agent-message 不需要 hover 效果，保持极简 */
    .thread-item-card.agent-message:hover {
        background: transparent;
        border: none;
        box-shadow: none;
    }

    /* user-message 本身有背景，不需要 hover 效果 */
    .thread-item-card.user-message:hover {
        background: rgba(59, 130, 246, 0.12);
        border: none;
        box-shadow: none;
    }

    /* Icon 样式 */
    :global(.item-icon),
    :global(.thinking-icon),
    :global(.streaming-icon),
    :global(.status-icon),
    :global(.chevron) {
        width: var(--icon-column-width);
        height: var(--icon-column-width);
        flex-shrink: 0;
    }

    .pill-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: var(--icon-column-width);
        height: var(--icon-column-width);
    }

    .pill-icon :global(.file-icon) {
        width: var(--icon-column-width);
        height: var(--icon-column-width);
        margin-right: 0;
        display: block;
    }

    .pill-icon :global(svg) {
        width: var(--icon-column-width);
        height: var(--icon-column-width);
    }

    :global(.thinking-icon) {
        color: #ffba6b;
    }

    :global(.thinking-icon.pulsing) {
        animation: pulse 1.5s ease-in-out infinite;
    }

    :global(.summary-icon) {
        color: #93c5fd; /* 柔和的蓝色，用于中间 agent 总结 */
    }

    :global(.summary-icon.pulsing) {
        animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% {
            opacity: 1;
        }
        50% {
            opacity: 0.6;
        }
    }

    .item-header {
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
        padding: 0 8px;
        min-height: var(--row-height);
        background: transparent;
        border: none;
        color: var(--text-primary, #ddd);
        cursor: pointer;
        transition: color 0.12s ease, background 0.12s ease;
        text-align: left;
    }

    .item-header:hover {
        background: rgba(255, 255, 255, 0.02);
        color: #fff;
    }

    .header-left {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        min-height: var(--row-height);
    }

    .header-left :global(.item-icon) {
        width: var(--icon-column-width);
        height: var(--icon-column-width);
        flex-shrink: 0;
        display: flex;
        justify-content: flex-start;
    }

    .header-right {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        min-height: var(--row-height);
    }

    .item-header :global(.chevron) {
        color: var(--text-secondary, #aaa);
        flex-shrink: 0;
    }

    .item-header :global(.item-icon) {
        color: var(--item-color);
        flex-shrink: 0;
    }

    .item-summary {
        font-size: calc(var(--ai-font-size, 14px) - 2px);
        font-weight: 400;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--text-secondary, #bdbdbd);
        line-height: 1.35;
    }

    .thread-item-card.agent-message .item-summary {
        font-size: var(--ai-font-size, 14px);
        font-weight: 400;
        color: var(--text-primary, #f5f5f5);
        line-height: 1.35;
        min-height: var(--row-height);
        display: inline-flex;
        align-items: center;
    }

    .streaming-indicator {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
        padding: 2px 8px;
        background: rgba(33, 150, 243, 0.15);
        border: 1px solid rgba(33, 150, 243, 0.3);
        border-radius: 10px;
        font-size: 11px;
        font-weight: 400;
        color: #2196f3;
        flex-shrink: 0;
    }

    .streaming-indicator :global(.streaming-icon) {
        animation: spin 1s linear infinite;
    }

    .streaming-text::after {
        content: '';
        animation: dots 1.5s steps(4, end) infinite;
    }

    @keyframes dots {
        0%, 20% { content: ''; }
        40% { content: '.'; }
        60% { content: '..'; }
        80%, 100% { content: '...'; }
    }

    .item-summary-markdown {
        flex: 1;
        min-width: 0;
        font-size: calc(var(--ai-font-size, 14px) - 2px);
        line-height: 1.35;
        color: var(--text-secondary, #c7c7c7);
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: var(--row-height);
    }

    .thread-item-card.agent-message .item-summary-markdown {
        font-size: var(--ai-font-size, 14px);
        color: var(--text-primary, #f2f2f2);
        font-weight: 400;
        line-height: 1.35;
        min-height: var(--row-height);
        display: inline-flex;
        align-items: center;
    }

    .thread-item-card:not(.agent-message) .item-summary,
    .thread-item-card:not(.agent-message) .item-summary-markdown {
        color: var(--text-secondary, #b0b0b0);
    }

    :global(html[data-theme="light"]) .thread-item-card:not(.user-message):not(.agent-message) {
        background: rgba(241, 245, 249, 0.42);
        border-color: #d9e1e8;
    }

    :global(html[data-theme="light"]) .item-summary,
    :global(html[data-theme="light"]) .item-summary-markdown,
    :global(html[data-theme="light"]) .thread-item-card:not(.agent-message) .item-summary,
    :global(html[data-theme="light"]) .thread-item-card:not(.agent-message) .item-summary-markdown {
        color: #526170;
    }

    :global(html[data-theme="light"]) .thread-item-card.agent-message .item-summary-markdown,
    :global(html[data-theme="light"]) .thread-item-card.agent-message .item-summary {
        color: #263746;
    }

    .thread-item-card:not(.agent-message) .item-summary-markdown :global(strong),
    .thread-item-card:not(.agent-message) .item-summary-markdown :global(b) {
        font-weight: 400 !important;
    }

    .item-summary-markdown :global(.markdown-content strong),
    .item-summary-markdown :global(.markdown-content b) {
        font-weight: 400 !important;
    }

    .markdown-wrapper.reasoning :global(.markdown-content strong),
    .markdown-wrapper.reasoning :global(.markdown-content b) {
        font-weight: 400 !important;
    }

    /* 防止列表序号被卡片左侧裁切，同时保持数字与文本同一行 */
    .markdown-wrapper :global(ol),
    .markdown-wrapper :global(ul) {
        list-style-position: outside;
        padding-left: 2em; /* 给 marker 预留更多空间，避免靠左被裁切 */
        margin: 8px 0;
    }

    .markdown-wrapper :global(li) {
        margin: 6px 0;
    }

    .markdown-wrapper.reasoning {
        margin: 0;
    }

    .thread-item-card.reasoning .markdown-wrapper.reasoning :global(.markdown-content),
    .thread-item-card.reasoning .reasoning-body :global(.markdown-content) {
        color: var(--text-secondary, #b1b1b1);
    }

    .reasoning-body :global(.markdown-content strong),
    .reasoning-body :global(.markdown-content b) {
        font-weight: 400 !important;
    }

    .item-summary-markdown :global(p) {
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.35;
    }

    .item-summary-markdown :global(code) {
        font-size: 13px;
        padding: 2px 4px;
        background: var(--bg-input, #1e1e1e);
        border-radius: 3px;
    }

    .markdown-wrapper :global(.read-file-inline-pill) {
        text-decoration: none;
        margin: 0 4px;
        background: rgba(14, 165, 233, 0.12);
        border-color: rgba(14, 165, 233, 0.35);
        color: var(--text-primary, #f4f4f4);
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: calc(var(--ai-font-size, 14px) - 3px);
    }

    .markdown-wrapper :global(.read-file-inline-pill:hover) {
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(14, 165, 233, 0.45);
    }

    .item-header :global(.status-icon) {
        flex-shrink: 0;
    }

    .item-header :global(.status-icon.spinning) {
        animation: spin 1s linear infinite;
    }

    /* 非折叠行（如 collab-row）也需要旋转 */
    .thread-item-card :global(.status-icon.spinning) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    .item-content {
        padding: 0 8px 8px 8px;
        border-top: none;
        background: transparent;
    }

    /* 展开时的工具卡片外轮廓 - 只在有 .item-content 时显示 */
    .thread-item-card:not(.file-change-card):not(.user-message):not(.agent-message):not(.reasoning):has(.item-content) {
        border-radius: 8px;
    }

    .thread-item-card:not(.file-change-card):not(.user-message):not(.agent-message):not(.reasoning):has(.item-content) .item-header {
        border-radius: 8px 8px 0 0;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.01);
    }

    .thread-item-card:not(.file-change-card):not(.user-message):not(.agent-message):not(.reasoning) .item-content {
        border-radius: 0 0 8px 8px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.01);
        padding: 8px;
    }

    :global(html[data-theme="light"]) .thread-item-card:not(.file-change-card):not(.user-message):not(.agent-message):not(.reasoning):has(.item-content) .item-header {
        box-shadow: 
            inset 0 0 0 1px rgba(15, 23, 42, 0.08),
            0 2px 6px rgba(15, 23, 42, 0.08);
        background: rgba(15, 23, 42, 0.02);
    }

    :global(html[data-theme="light"]) .thread-item-card:not(.file-change-card):not(.user-message):not(.agent-message):not(.reasoning) .item-content {
        box-shadow: 
            inset 0 0 0 1px rgba(15, 23, 42, 0.08),
            0 2px 6px rgba(15, 23, 42, 0.08);
        background: rgba(15, 23, 42, 0.02);
    }

    .command-simple {
        margin-top: 0;
        display: flex;
        flex-direction: column;
        gap: 0;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 0;
        overflow: hidden;
        border: none;
    }

    :global(html[data-theme="light"]) .command-simple {
        background: rgba(15, 23, 42, 0.04);
        border: none;
    }

    .command-line-simple,
    .command-output-simple {
        margin: 0;
        padding: 10px 12px;
        border-radius: 0;
        background: transparent;
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-family: "Consolas", "Monaco", monospace;
        font-size: 12px;
        color: var(--text-primary, #e8e8e8);
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .command-line-simple {
        color: #a3e635;
    }

    .command-output-shell {
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: transparent;
    }

    .command-output-notice {
        padding: 7px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        font-family: var(--font-mono, "Consolas", "Monaco", monospace);
        font-size: 11px;
        line-height: 1.35;
        color: var(--text-secondary, #94a3b8);
        background: rgba(245, 158, 11, 0.08);
    }

    .command-output-simple.truncated {
        max-height: 360px;
        overflow: auto;
    }

    .command-line-simple:first-child {
        border-top: none;
    }

    :global(html[data-theme="light"]) .command-line-simple,
    :global(html[data-theme="light"]) .command-output-simple {
        background: transparent;
        border-top-color: rgba(15, 23, 42, 0.08);
        color: #1e293b;
    }

    :global(html[data-theme="light"]) .command-output-shell {
        border-top-color: rgba(15, 23, 42, 0.08);
    }

    :global(html[data-theme="light"]) .command-output-notice {
        border-bottom-color: rgba(15, 23, 42, 0.08);
        background: rgba(245, 158, 11, 0.12);
        color: #92400e;
    }

    :global(html[data-theme="light"]) .command-line-simple {
        color: #15803d;
    }

    :global(html[data-theme="light"]) .command-line-simple:first-child {
        border-top: none;
    }

    .command-meta-text {
        font-size: 11px;
        color: var(--text-secondary, #a1a1aa);
        padding: 8px 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(0, 0, 0, 0.15);
    }

    .command-meta-text.subtle {
        color: var(--text-secondary, #94a3b8);
    }

    :global(html[data-theme="light"]) .command-meta-text {
        border-top-color: rgba(15, 23, 42, 0.08);
        background: rgba(15, 23, 42, 0.03);
        color: #64748b;
    }

    .web-search-card {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 7px;
        border: 1px solid var(--web-search-border);
        background: var(--web-search-bg);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .web-search-eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-secondary, rgba(255, 255, 255, 0.7));
    }

    .web-search-query {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--text-primary, #fefefe);
        word-break: break-word;
    }

    :global(html[data-theme="light"]) .web-search-query {
        color: #0f172a;
    }

    .web-search-icon {
        color: var(--accent-color, #0ea5e9);
        flex-shrink: 0;
    }

    .todo-list {
        margin-top: 8px;
    }

    .todo-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
    }

    .todo-item input[type="checkbox"] {
        flex-shrink: 0;
    }

    .todo-item span {
        color: var(--text-primary, #fff);
    }

    .todo-item span.completed {
        text-decoration: line-through;
        color: var(--text-secondary, #aaa);
    }

    .generic-content {
        margin-top: 8px;
    }

    .image-view-card {
        margin-top: 8px;
    }

    .image-generation-card {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 0;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 20px;
        overflow: hidden;
    }

    .image-generation-summary-col,
    .image-generation-preview-col,
    .image-generation-path-col {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .image-generation-header {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 18px 20px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
    }

    .image-generation-summary {
        margin: 0;
    }

    .image-generation-summary :global(.markdown-content) {
        font-size: 15px;
        line-height: 1.6;
        color: var(--text-primary, #f8fafc);
        word-break: break-word;
        text-align: left;
    }

    .image-generation-summary :global(p) {
        margin: 0;
    }

    .image-generation-preview-col {
        padding: 20px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
    }

    .image-generation-preview {
        overflow: hidden;
        border-radius: 12px;
        min-width: 0;
    }

    .image-generation-empty {
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-secondary, rgba(255, 255, 255, 0.7));
        word-break: break-all;
        padding: 14px 20px;
        text-align: left;
    }

    :global(html[data-theme="light"]) .image-generation-card,
    :global(html[data-theme="light"]) .image-generation-header,
    :global(html[data-theme="light"]) .image-generation-preview-col {
        border-color: rgba(15, 23, 42, 0.18);
    }

    :global(html[data-theme="light"]) .image-generation-summary :global(.markdown-content) {
        color: #111827;
    }

    :global(html[data-theme="light"]) .image-generation-empty {
        color: rgba(17, 24, 39, 0.72);
    }


    .context-compaction-card {
        margin-top: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
    }

    :global(html[data-theme="light"]) .context-compaction-card {
        border-color: rgba(15, 23, 42, 0.12);
        background: rgba(15, 23, 42, 0.02);
    }

    .context-compaction-title {
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 4px;
        color: var(--text-primary, #fefefe);
    }

    :global(html[data-theme="light"]) .context-compaction-title {
        color: #0f172a;
    }

    .context-compaction-subtitle {
        font-size: 12px;
        line-height: 1.35;
        color: var(--text-secondary, rgba(255, 255, 255, 0.7));
    }

    :global(html[data-theme="light"]) .context-compaction-subtitle {
        color: rgba(15, 23, 42, 0.6);
    }

    .generic-content pre {
        padding: 10px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 4px;
        font-family: "Consolas", "Monaco", monospace;
        font-size: 12px;
        color: var(--text-secondary, #c1c1c1);
        overflow-x: auto;
    }

    .review-prompt-card {
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 13px;
        line-height: 1.45;
        border-width: 1px;
        border-style: solid;
        background: #020617;
        border-color: rgba(59, 130, 246, 0.7);
        color: #e5e7eb;
    }

    :global(html[data-theme="light"]) .review-prompt-card {
        background: #e5f0ff;
        border-color: rgba(37, 99, 235, 0.5);
        color: #1f2933;
    }

    .review-prompt-card p {
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .review-mode-card {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        background: rgba(249, 115, 22, 0.08);
        border: 1px solid rgba(249, 115, 22, 0.6);
        font-size: 12px;
        color: var(--text-primary, #fff);
    }

    :global(html[data-theme="light"]) .review-mode-card {
        background: #fff7ed;
        border-color: rgba(194, 65, 12, 0.5);
        color: #7c2d12;
    }

    .review-mode-title {
        font-weight: 600;
        margin-bottom: 2px;
    }

    .review-mode-subtitle {
        opacity: 0.8;
    }

    .collab-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .collab-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: var(--row-height);
        padding: 0 8px;
        color: var(--text-secondary, #bdbdbd);
    }

    .collab-row-prompt {
        padding: 0 8px 8px;
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
    }

    .collab-row-branch {
        color: rgba(148, 163, 184, 0.85);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        line-height: 1.6;
        user-select: none;
    }

    .collab-row-prompt-text {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-primary, #e5e7eb);
        white-space: pre-wrap;
        word-break: break-word;
    }

    :global(html[data-theme="light"]) .collab-row-prompt-text {
        color: #0f172a;
    }

    .collab-row-left {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1;
    }

    .collab-row-right {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .collab-row-icon {
        color: var(--item-color);
        width: var(--icon-column-width);
        height: var(--icon-column-width);
        flex-shrink: 0;
    }

    .collab-row-title {
        font-size: calc(var(--ai-font-size, 14px) - 2px);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.35;
    }

    .collab-chip {
        font-size: 11px;
        line-height: 1;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(15, 118, 110, 0.28);
        background: rgba(15, 118, 110, 0.12);
        color: rgba(153, 246, 228, 0.9);
        max-width: 220px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    :global(html[data-theme="light"]) .collab-row {
        color: rgba(15, 23, 42, 0.7);
    }

    :global(html[data-theme="light"]) .collab-chip {
        border-color: rgba(13, 148, 136, 0.25);
        background: rgba(13, 148, 136, 0.08);
        color: rgba(13, 148, 136, 0.95);
    }

    .collab-task-log,
    .collab-result-log {
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
    }

    .collab-task-prefix {
        color: rgba(148, 163, 184, 0.85);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        line-height: 1.6;
        user-select: none;
    }

    .collab-task-text {
        line-height: 1.6;
        color: var(--text-primary, #e5e7eb);
        font-size: 13px;
    }

    :global(html[data-theme="light"]) .collab-task-text {
        color: #0f172a;
    }

    .collab-result-log {
        color: var(--text-primary, #e2e8f0);
        line-height: 1.55;
        font-size: 13px;
    }

    :global(html[data-theme="light"]) .collab-result-log {
        color: #0f172a;
    }

    .chrome-tool-recovery-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(245, 158, 11, 0.35);
        background: rgba(245, 158, 11, 0.1);
        color: var(--text-primary, #f8fafc);
    }

    .chrome-tool-recovery-title {
        font-size: 13px;
        font-weight: 600;
    }

    .chrome-tool-recovery-message {
        color: var(--text-secondary, #cbd5e1);
        font-size: 13px;
        line-height: 1.55;
    }

    .chrome-tool-recovery-details {
        color: var(--text-secondary, #94a3b8);
        font-size: 12px;
    }

    .chrome-tool-recovery-details summary {
        cursor: pointer;
    }

    .chrome-tool-recovery-details pre {
        margin: 8px 0 0;
        max-height: 220px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
    }

    :global(html[data-theme="light"]) .chrome-tool-recovery-card {
        background: rgba(245, 158, 11, 0.1);
        color: #0f172a;
    }

    :global(html[data-theme="light"]) .chrome-tool-recovery-message {
        color: #475569;
    }

    .browser-policy-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.1);
        color: var(--text-primary, #f8fafc);
    }

    .browser-policy-title {
        font-size: 13px;
        font-weight: 650;
    }

    .browser-policy-message {
        color: var(--text-secondary, #cbd5e1);
        font-size: 13px;
        line-height: 1.55;
    }

    .browser-policy-details {
        color: var(--text-secondary, #94a3b8);
        font-size: 12px;
    }

    .browser-policy-details summary {
        cursor: pointer;
    }

    .browser-policy-details pre {
        margin: 8px 0 0;
        max-height: 220px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
    }

    :global(html[data-theme="light"]) .browser-policy-card {
        background: rgba(239, 68, 68, 0.08);
        color: #0f172a;
    }

    :global(html[data-theme="light"]) .browser-policy-message,
    :global(html[data-theme="light"]) .browser-policy-details {
        color: #475569;
    }

    .browser-use-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid rgba(59, 130, 246, 0.22);
        background:
            linear-gradient(135deg, rgba(59, 130, 246, 0.13), rgba(16, 185, 129, 0.08)),
            rgba(15, 23, 42, 0.18);
        color: var(--text-primary, #f8fafc);
    }

    .browser-use-card.failed {
        border-color: rgba(245, 158, 11, 0.35);
        background: rgba(245, 158, 11, 0.1);
    }

    .browser-use-head {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }

    .browser-use-icon {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: #bfdbfe;
        background: rgba(59, 130, 246, 0.2);
    }

    .browser-use-copy {
        min-width: 0;
        flex: 1;
    }

    .browser-use-title {
        font-size: 13px;
        font-weight: 650;
        line-height: 1.35;
        color: var(--text-primary, #f8fafc);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .browser-use-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 3px;
        color: var(--text-secondary, #94a3b8);
        font-size: 12px;
    }

    .browser-use-message {
        color: var(--text-secondary, #cbd5e1);
        font-size: 13px;
        line-height: 1.55;
        word-break: break-word;
    }

    .browser-use-details {
        color: var(--text-secondary, #94a3b8);
        font-size: 12px;
    }

    .browser-use-details summary {
        cursor: pointer;
        user-select: none;
    }

    .browser-use-details pre {
        margin: 8px 0 0;
        max-height: 220px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
    }

    :global(html[data-theme="light"]) .browser-use-card {
        border-color: rgba(37, 99, 235, 0.18);
        background:
            linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(16, 185, 129, 0.08)),
            #f8fafc;
        color: #0f172a;
    }

    :global(html[data-theme="light"]) .browser-use-icon {
        color: #1d4ed8;
        background: rgba(37, 99, 235, 0.1);
    }

    :global(html[data-theme="light"]) .browser-use-title {
        color: #0f172a;
    }

    :global(html[data-theme="light"]) .browser-use-message,
    :global(html[data-theme="light"]) .browser-use-meta,
    :global(html[data-theme="light"]) .browser-use-details {
        color: #475569;
    }

    .collab-wait-states {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .collab-wait-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.12);
        background: rgba(255, 255, 255, 0.02);
    }

    :global(html[data-theme="light"]) .collab-wait-row {
        border-color: rgba(15, 23, 42, 0.12);
        background: rgba(15, 23, 42, 0.02);
    }

    .collab-wait-agent {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--text-secondary, rgba(255, 255, 255, 0.72));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    :global(html[data-theme="light"]) .collab-wait-agent {
        color: rgba(15, 23, 42, 0.65);
    }

    .collab-wait-status {
        font-size: 11px;
        line-height: 1;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(148, 163, 184, 0.08);
        color: rgba(226, 232, 240, 0.9);
        text-transform: none;
        white-space: nowrap;
    }

    :global(html[data-theme="light"]) .collab-wait-status {
        color: rgba(15, 23, 42, 0.75);
        border-color: rgba(15, 23, 42, 0.14);
        background: rgba(15, 23, 42, 0.06);
    }

    .collab-wait-message {
        grid-column: 1 / -1;
        font-size: 12px;
        line-height: 1.5;
        color: var(--text-primary, #e5e7eb);
        white-space: pre-wrap;
        word-break: break-word;
    }

    :global(html[data-theme="light"]) .collab-wait-message {
        color: #0f172a;
    }

    .collab-prompt {
        white-space: pre-wrap;
        line-height: 1.6;
        color: var(--text-primary, #334155);
    }

    .collab-meta {
        font-size: 12px;
        line-height: 1.5;
    }

    .collab-details {
        border-top: 1px dashed rgba(148, 163, 184, 0.18);
        padding-top: 8px;
    }

    .collab-details > summary {
        list-style: none;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary, #94a3b8);
        user-select: none;
    }

    .collab-details > summary::-webkit-details-marker {
        display: none;
    }

    .collab-details-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 10px;
    }

    .collab-agents {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 2px;
    }

    .collab-agents-inline {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .collab-agent-inline-card {
        padding: 8px 0 0 22px;
        border-radius: 0;
        background: transparent;
        border: none;
        position: relative;
    }

    .collab-agent-inline-card::before {
        content: "└";
        position: absolute;
        left: 0;
        top: 8px;
        color: rgba(148, 163, 184, 0.85);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .collab-agent-inline-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }

    .collab-agent-inline-main {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
    }

    .collab-agent-row {
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.04);
    }

    :global(html[data-theme="light"]) .collab-agent-row {
        background: rgba(148, 163, 184, 0.12);
    }

    .collab-agent-main {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .collab-agent-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: 0 0 auto;
        background: #94a3b8;
    }

    .collab-agent-dot[data-tone="running"] {
        background: #2563eb;
    }

    .collab-agent-dot[data-tone="done"] {
        background: #10b981;
    }

    .collab-agent-dot[data-tone="error"] {
        background: #ef4444;
    }

    .collab-agent-id {
        font-size: 12px;
    }

    .collab-agent-status {
        font-size: 12px;
        font-weight: 600;
        text-transform: capitalize;
    }

    .collab-agent-message {
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
    }

    .collab-open-link {
        border: none;
        background: transparent;
        color: #0f766e;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        padding: 0;
    }

    .collab-open-link:hover {
        text-decoration: underline;
    }

    .item-simple {
        padding: 0;
    }

    .thread-item-card.user-message .item-simple,
    .thread-item-card.agent-message .item-simple {
        padding: 8px 12px;
    }

    .attachment-row.in-bubble {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0 0 6px 0;
    }

    .resource-mention-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0 0 6px 0;
    }

    .resource-mention-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        max-width: 100%;
        padding: 6px 10px;
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 999px;
        background: rgba(99, 102, 241, 0.12);
        color: #c7d2fe;
        font-size: 12px;
        line-height: 1.35;
    }

    .resource-mention-chip.plugin {
        border-color: rgba(217, 70, 239, 0.3);
        background: rgba(217, 70, 239, 0.11);
        color: #f5d0fe;
    }

    :global(html[data-theme="light"]) .resource-mention-chip {
        border-color: rgba(79, 70, 229, 0.2);
        background: rgba(79, 70, 229, 0.08);
        color: #3730a3;
    }

    :global(html[data-theme="light"]) .resource-mention-chip.plugin {
        border-color: rgba(192, 38, 211, 0.2);
        background: rgba(192, 38, 211, 0.07);
        color: #86198f;
    }

    .resource-mention-icon {
        flex: 0 0 auto;
        opacity: 0.9;
    }

    .resource-mention-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .resource-mention-kind {
        flex: 0 0 auto;
        opacity: 0.72;
        font-size: 10px;
        font-weight: 650;
        text-transform: uppercase;
    }

    .attachment-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--ai-chip-bg, rgba(148, 163, 184, 0.12));
        color: var(--ai-chip-fg, #e2e8f0);
        font-size: 12px;
        line-height: 1.35;
        border: 1px solid var(--ai-chip-border, rgba(148, 163, 184, 0.3));
        max-width: 100%;
        min-width: 0;
    }

    :global(html[data-theme="light"]) .thread-item-card .attachment-chip {
        background: rgba(15, 23, 42, 0.06);
        border-color: rgba(15, 23, 42, 0.16);
        color: #0f172a;
    }

    .attachment-chip .attachment-label {
        display: inline-block;
        flex: 1 1 auto;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
    }

    .attachment-chip .attachment-icon {
        opacity: 0.85;
    }

    .simple-content {
        color: var(--text-primary, #fff);
        line-height: 1.45;
    }

    .simple-content p {
        margin: 0 0 8px 0;
        white-space: pre-wrap;
        word-wrap: break-word;
        line-height: 1.45;
    }

    .simple-content p:last-child {
        margin-bottom: 0;
    }

    .simple-content img {
        max-width: min(320px, 100%);
        max-height: 240px;
        border-radius: 4px;
        margin: 8px 0;
        object-fit: contain;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
        background: #111;
    }

    .reasoning-inline {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 0 8px;
        min-height: var(--row-height);
    }

    .thinking-icon-wrapper {
        display: inline-flex;
        align-items: center;
        width: var(--icon-column-width);
        flex-shrink: 0;
    }

    .reasoning-inline :global(.thinking-icon) {
        width: var(--icon-column-width);
        height: var(--icon-column-width);
        flex-shrink: 0;
    }

    .reasoning-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        min-height: var(--row-height);
        gap: 6px;
    }

    .reasoning-content {
        width: 100%;
    }

    .reasoning-content :global(p:first-child) {
        margin-top: 0;
    }

    .reasoning-content :global(p:last-child) {
        margin-bottom: 0;
    }

    /* 工具输出样式 */
    .tool-output-card {
        margin: 6px 0;
        border: 1px solid rgba(255, 255, 255, 0.04);
        border-radius: 6px;
        overflow: hidden;
        background: var(--bg-secondary, rgba(0, 0, 0, 0.25));
    }

    .tool-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: transparent;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary, #a3a3a3);
    }

    .tool-name {
        color: var(--text-primary, #fff);
    }

    .tool-content {
        padding: 10px;
    }

    .search-info,
    .file-info,
    .dir-info {
        margin-bottom: 8px;
        font-size: 13px;
        color: var(--text-secondary, #aaa);
    }

    .search-info code,
    .file-info code,
    .dir-info code {
        padding: 2px 6px;
        background: var(--bg-secondary, #252525);
        border-radius: 3px;
        color: var(--accent-color, #007acc);
        font-family: "Consolas", "Monaco", monospace;
        font-size: 12px;
    }

    .tool-results {
        margin: 0;
        padding: 10px;
        background: var(--bg-secondary, rgba(0, 0, 0, 0.35));
        border-radius: 4px;
        font-family: "Consolas", "Monaco", monospace;
        font-size: calc(var(--ai-font-size, 14px) - 2px);
        color: var(--text-primary, #ccc);
        max-height: 400px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
        line-height: 1.4;
    }

    .file-search-results .tool-results {
        color: var(--accent-color, #007acc);
    }

    /* Function Tool Call 样式 */
    .function-tool-call {
        margin-top: 0;
    }

    .tool-info {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 6px;
        margin-bottom: 8px;
        font-size: 12px;
        border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .tool-name-label {
        font-weight: 600;
        color: var(--text-primary, #fff);
        font-family: ui-monospace, "SFMono-Regular", monospace;
        font-size: 12px;
        letter-spacing: 0.3px;
    }

    .tool-status {
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        margin-left: auto;
    }

    .tool-status.success {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .tool-status.failed {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .tool-arguments {
        margin: 6px 0;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.015);
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .arg-item {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 12px;
    }

    .arg-item:last-child {
        margin-bottom: 0;
    }

    .arg-label {
        color: var(--text-secondary, #aaa);
        font-weight: 500;
        min-width: 70px;
    }

    .arg-value {
        padding: 2px 6px;
        background: var(--bg-input, #1e1e1e);
        border-radius: 3px;
        color: var(--accent-color, #007acc);
        font-family: "Consolas", "Monaco", monospace;
        font-size: 11px;
        word-break: break-all;
    }

    .tool-output {
        margin: 0;
        padding: 12px;
        background: rgba(0, 0, 0, 0.15);
        border-radius: 4px;
        font-family: ui-monospace, "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace;
        font-size: calc(var(--ai-font-size, 14px) - 2px);
        color: var(--text-primary, #d6d6d6);
        max-height: 500px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
        line-height: 1.45;
        border: none;
        box-shadow: none;
    }

    .tool-output.code-content {
        background: rgba(0, 0, 0, 0.2);
        border: none;
        line-height: 1.6;
        tab-size: 4;
    }

    :global(html[data-theme="light"]) .tool-output {
        background: rgba(15, 23, 42, 0.04);
        color: #0f172a;
    }

    :global(html[data-theme="light"]) .tool-output.code-content {
        background: rgba(15, 23, 42, 0.05);
    }

    .read-file-row {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 6px;
        padding: 0 8px;
        min-height: var(--row-height);
        border: none;
        border-radius: 0;
        background: transparent;
        min-width: 0;
    }

    .read-file-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 400;
        font-size: calc(var(--ai-font-size, 14px) - 2px);
        color: var(--text-secondary, #d0d0d0);
        white-space: nowrap;
    }

    .read-file-label :global(svg) {
        width: var(--icon-column-width);
        height: var(--icon-column-width);
        flex-shrink: 0;
    }

    .read-file-row-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-start;
        align-items: center;
        margin-left: 8px;
        flex: 1 1 auto;
        min-width: 0;
    }

    .read-file-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.05);
        font-size: calc(var(--ai-font-size, 14px) - 3px);
        font-weight: 400;
        color: var(--text-primary, #ddd);
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
        font-family: inherit;
        line-height: 1.1;
        appearance: none;
        min-height: 24px;
        max-width: 100%;
        min-width: 0;
        flex: 0 1 auto;
    }

    .read-file-pill:hover {
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(14, 165, 233, 0.35);
    }

    .read-file-pill:focus-visible {
        outline: 2px solid rgba(14, 165, 233, 0.45);
        outline-offset: 2px;
    }

    .pill-name {
        flex: 1 1 auto;
        min-width: 0;
        max-width: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pill-name,
    .pill-range {
        display: inline-flex;
        align-items: center;
        line-height: 1.35;
        align-self: center;
    }

    .pill-range {
        font-size: 0.8em;
        color: var(--text-secondary, #bbb);
        flex: 0 0 auto;
    }

    .read-file-empty {
        font-size: calc(var(--ai-font-size, 14px) - 3px);
        color: var(--text-secondary, #bbb);
        padding: 0 6px;
    }

    /* Directory listing styles */
    .directory-listing {
        margin: 0;
        padding: 8px;
        background: transparent;
        border-radius: 0;
        border: none;
        max-height: 500px;
        overflow-y: auto;
    }

    .dir-entry {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        font-family: ui-monospace, "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace;
        /* Slightly smaller font so directory listings don't look oversized */
        font-size: calc(var(--ai-font-size, 14px) - 2px);
        line-height: 1.4;
        color: var(--text-primary, #e0e0e0);
        transition: background 0.15s ease;
        cursor: default;
    }

    .dir-entry:hover {
        background: rgba(255, 255, 255, 0.03);
    }

    :global(html[data-theme="light"]) .dir-entry {
        color: #0f172a;
    }

    :global(html[data-theme="light"]) .dir-entry:hover {
        background: rgba(15, 23, 42, 0.04);
    }

    .dir-entry.is-directory {
        font-weight: 500;
    }

    .dir-entry.is-directory .entry-name {
        color: var(--accent-color, #60a5fa);
    }

    .dir-entry :global(.entry-icon) {
        flex-shrink: 0;
        color: var(--text-secondary, #888);
        width: var(--icon-column-width);
        height: var(--icon-column-width);
    }

    .dir-entry.is-directory :global(.entry-icon) {
        color: var(--accent-color, #60a5fa);
    }

    .tool-header :global(.tool-header-icon) {
        width: var(--icon-column-width);
        height: var(--icon-column-width);
        flex-shrink: 0;
    }

    .entry-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .protocol-event-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--item-color) 32%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--item-color) 7%, transparent);
        color: var(--text-primary, #e5e7eb);
    }

    .protocol-event-title {
        display: flex;
        align-items: center;
        gap: 7px;
        font-weight: 600;
    }

    .protocol-event-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 12px;
        color: var(--text-secondary, #94a3b8);
        font-size: 12px;
    }

    .protocol-event-meta code,
    .protocol-event-id {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .protocol-event-link {
        align-self: flex-start;
        border: 0;
        padding: 0;
        background: transparent;
        color: var(--accent-color, #60a5fa);
        cursor: pointer;
        font-size: 12px;
    }

    .protocol-event-link:hover {
        text-decoration: underline;
    }

    .protocol-event-status {
        margin-left: auto;
        color: var(--text-secondary, #94a3b8);
        font-size: 12px;
        font-weight: 400;
    }

    .protocol-event-output,
    .hook-prompt-fragment {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: var(--text-secondary, #cbd5e1);
        font-size: 13px;
        line-height: 1.45;
    }

    .protocol-event-details {
        border-top: 1px dashed color-mix(in srgb, var(--item-color) 24%, transparent);
        padding-top: 7px;
        font-size: 12px;
    }

    .protocol-event-details pre {
        max-height: 240px;
        margin: 8px 0 0;
        overflow: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
</style>
