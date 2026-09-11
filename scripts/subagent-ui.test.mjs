import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import { JSDOM } from "jsdom";

// Exercise the real ChatView -> virtual list -> item card -> drawer event path.
// Only unrelated desktop/editor components and the external IPC boundary are stubbed.
test("activity-only subagents stay visible and open the correct read-only conversation", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const temp = await mkdtemp(path.join(tmpdir(), "codey-subagent-ui-"));
    const dom = new JSDOM("<html data-theme='light'><body></body></html>", {
        url: "http://localhost/", pretendToBeVisual: true,
    });
    for (const name of ["window", "document", "navigator", "Element", "HTMLElement", "HTMLDivElement", "HTMLMediaElement",
        "Node", "Text", "Comment", "Event", "CustomEvent", "MutationObserver", "localStorage", "getComputedStyle"]) {
        Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
    }
    globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
    globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    dom.window.ResizeObserver = globalThis.ResizeObserver;
    for (const name of ["offsetHeight", "clientHeight", "scrollHeight"]) {
        Object.defineProperty(dom.window.HTMLElement.prototype, name, { configurable: true, get: () => 900 });
    }
    Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { get: () => 1000 });
    dom.window.HTMLElement.prototype.scrollTo = function (options) { this.scrollTop = options.top ?? 0; };
    const requests = [];
    const pending = [];
    const metadataPending = new Map();
    globalThis.subagentTestInvoke = (command, args) => {
        if (command === "codex_thread_goal_get") return Promise.resolve({ goal: null });
        requests.push({ command, args });
        if (command === "codex_subagent_metadata") {
            return new Promise(resolve => metadataPending.set(args.threadId, resolve));
        }
        if (command !== "codex_thread_read") throw new Error(`Unexpected IPC: ${command}`);
        return new Promise(resolve => pending.push(resolve));
    };
    let chat;
    try {
        const keep = new Set(["ChatView.svelte", "ThreadItemFlatList.svelte", "ThreadItemCard.svelte", "SubagentTranscript.svelte", "SubagentMetadata.svelte"]);
        await build({
            stdin: { contents: 'export { default as ChatView } from "./src/lib/codex/ChatView.svelte"; export { mount, unmount, tick } from "svelte";', resolveDir: root },
            outfile: path.join(temp, "ui.mjs"), bundle: true, format: "esm", platform: "browser", conditions: ["browser"],
            plugins: [{ name: "component-test", setup(b) {
                b.onResolve({ filter: /EditorTabList\.svelte|Notifications\/notifications|contextMenuService|viewAllChangesHost|^\.\.\/i18n$/ }, args => ({ path: args.path, namespace: "desktop-stub" }));
                b.onLoad({ filter: /.*/, namespace: "desktop-stub" }, args => ({ contents: args.path.endsWith("i18n")
                    ? 'import { writable } from "svelte/store"; export const t = writable(key => key);'
                    : 'export const openFileAtLine = () => {}; export const addNotification = () => {}; export const NotifType = {}; export const openViewAllChangesTab = () => {}; export const openContextMenu = () => {};', resolveDir: root }));
                b.onResolve({ filter: /^@tauri-apps\// }, args => ({ path: args.path, namespace: "tauri-stub" }));
                b.onLoad({ filter: /.*/, namespace: "tauri-stub" }, () => ({ contents: 'export const invoke = (...args) => globalThis.subagentTestInvoke(...args); export const listen = async () => () => {}; export const convertFileSrc = path => path; export const writeText = async () => {}; export const openUrl = async () => {}; export const join = async (...p) => p.join("/");' }));
                b.onLoad({ filter: /\.svelte$/ }, async args => {
                    const source = keep.has(path.basename(args.path)) ? await readFile(args.path, "utf8") : "<script>export let content = '';</script>{content}";
                    return { contents: compile(source, { filename: args.path, generate: "client", css: "injected", compatibility: { componentApi: 4 } }).js.code, loader: "js", resolveDir: path.dirname(args.path) };
                });
            } }], logLevel: "silent",
        });
        const { ChatView, tick } = await import(pathToFileURL(path.join(temp, "ui.mjs")));
        const activity = (id, kind, child = "child-a") => ({ type: "subAgentActivity", id, kind, agentThreadId: child, agentPath: `/root/task-${child}` });
        const initialTurns = [{ id: "turn-1", status: "completed", items: [activity("start", "started"), activity("update", "interacted")] }];
        chat = new ChatView({ target: document.body, props: { threadId: "main", initialTurnsThreadId: "main", initialTurns } });
        const settle = async () => { await tick(); await new Promise(resolve => setTimeout(resolve, 40)); await tick(); };
        await settle();
        const entries = () => [...document.querySelectorAll(".subagent-entry")];
        assert.equal(entries().length, 2, "history containing only activities must keep both timeline positions");
        assert.deepEqual(requests[0], { command: "codex_subagent_metadata", args: { threadId: "child-a", parentThreadId: "main", spawnCallId: "start" } });
        chat.handleSubagentMetadata({ method: "thread/settings/updated", params: {
            threadId: "child-a", threadSettings: { model: "child-model", effort: "high", cwd: "D:\\workspace\\child" },
        } });
        metadataPending.get("child-a")({ thread: {
            id: "child-a", agentNickname: "Luna", agentRole: "explorer", createdAt: 1700000000,
            cwd: "D:\\stale-dir", status: { type: "notLoaded" }, turns: [],
        }, metadata: { model: "older-model", effort: "low", forkTurns: "all" } });
        await settle();
        const metadata = () => document.querySelector(".subagent-metadata")?.textContent ?? "";
        for (const text of ["Luna", "explorer", "child-model", "high", "D:\\workspace\\child", "主 Agent", "创建时间"]) {
            assert.ok(metadata().includes(text), `creation information must include ${text}`);
        }
        assert.ok(!metadata().includes("stale-dir"), "a delayed read cannot replace newer settings");
        assert.match(metadata(), /历史继承\s*完整上下文/, "explicit creation history must be visible");
        assert.ok(!metadata().includes("older-model"), "live settings take precedence over stored settings");
        chat.handleSubagentMetadata({ method: "turn/completed", params: { threadId: "child-a", turn: { status: "interrupted" } } });
        await settle();
        assert.match(metadata(), /已中断/);
        chat.handleSubagentMetadata({ method: "thread/status/changed", params: { threadId: "child-a", status: { type: "idle" } } });
        await settle();
        assert.match(metadata(), /已中断/, "idle runtime state must not erase the last turn outcome");
        chat.handleSubagentMetadata({ method: "thread/settings/updated", params: {
            threadId: "unrelated", threadSettings: { model: "unrelated-model", effort: "low", cwd: "elsewhere" },
        } });
        await settle();
        assert.ok(!document.body.textContent.includes("unrelated-model"));
        entries()[0].click();
        await settle();
        assert.equal(document.querySelector(".subagent-drawer h2")?.textContent, "task-child-a");
        assert.deepEqual(requests.find(request => request.command === "codex_thread_read"), { command: "codex_thread_read", args: { params: { threadId: "child-a", includeTurns: true } } });
        assert.equal(requests.filter(request => request.command === "codex_subagent_metadata").length, 1, "card and drawer share one metadata read per child");
        document.querySelector(".subagent-drawer-close").click();
        await settle();
        entries()[1].click();
        await settle();
        pending[0]({ thread: { turns: [{ items: [{ type: "agentMessage", text: "stale reply" }] }] } });
        await settle();
        assert.ok(!document.body.textContent.includes("stale reply"), "a closed drawer request must not replace a reopened drawer");
        pending[1]({ thread: { turns: [{ items: [{ type: "agentMessage", text: "Project inspection result" }] }] } });
        await settle();
        assert.match(document.querySelector(".subagent-transcript").textContent, /Project inspection result/);
        document.querySelector(".subagent-drawer-close").click();
        await settle();
        chat.handleNotification({ method: "turn/started", params: { threadId: "main", turn: { id: "turn-2", status: "inProgress", items: [] } } });
        chat.handleNotification({ method: "item/started", params: { threadId: "main", turnId: "turn-2", item: activity("new-child", "started", "child-b") } });
        await settle();
        assert.equal(entries().length, 3, "live activities must appear without requiring a resize or a completed turn");
        assert.ok(!document.querySelectorAll(".subagent-metadata")[1].textContent.includes("历史继承"), "missing history must not be guessed");
        entries()[2].click();
        await settle();
        assert.equal(requests.at(-1).args.params.threadId, "child-b");
        document.querySelector(".subagent-drawer-close").click();
        const count = requests.length;
        pending[2]({ thread: { turns: [] } });
        await new Promise(resolve => setTimeout(resolve, 2200));
        assert.equal(requests.length, count, "closing while a read is pending must not restart polling");
        assert.equal(document.querySelector(".subagent-drawer"), null);
        const metadataReads = (childId) => requests.filter(request => request.command === "codex_subagent_metadata" && request.args.threadId === childId).length;
        chat.handleSubagentMetadata({ method: "turn/completed", params: { threadId: "child-b", turn: { status: "completed" } } });
        metadataPending.get("child-b")({ thread: { id: "child-b", turns: [] }, metadata: { forkTurns: "all" } });
        await settle();
        assert.equal(metadataReads("child-b"), 2, "completion during the first read must refresh metadata written after creation");
        chat.handleSubagentMetadata({ method: "turn/completed", params: { threadId: "child-b", turn: { status: "completed" } } });
        await settle();
        assert.equal(metadataReads("child-b"), 2, "duplicate completion events must share the pending refresh");
        metadataPending.get("child-b")({ thread: { id: "child-b", turns: [] }, metadata: { model: "late-child-model", effort: "xhigh", forkTurns: "all" } });
        await settle();
        assert.match(document.body.textContent, /模型\s*late-child-model\s*思考强度\s*xhigh/);
        chat.handleSubagentMetadata({ method: "turn/completed", params: { threadId: "child-b", turn: { status: "completed" } } });
        await settle();
        assert.equal(metadataReads("child-b"), 2, "complete metadata needs no further read");
        chat.handleNotification({ method: "item/completed", params: { threadId: "main", turnId: "turn-2", item: {
            type: "collabAgentToolCall", id: "legacy-spawn", tool: "spawnAgent", status: "completed",
            receiverThreadIds: ["legacy-child"], prompt: "Review the project structure", model: "test-model", reasoningEffort: "high", agentsStates: {},
        } } });
        await settle();
        assert.equal(entries().length, 3, "a legacy collab card must not remove activity rows");
        metadataPending.get("legacy-child")({ thread: { id: "legacy-child", turns: [] },
            metadata: { model: "persisted-child-model", effort: "xhigh", forkTurns: "none" } });
        await settle();
        const storedInfo = [...document.querySelectorAll(".subagent-metadata")].find(node => node.textContent.includes("persisted-child-model"));
        assert.ok(storedInfo, "stored model must render without a live settings event");
        assert.match(storedInfo.textContent, /思考强度\s*xhigh/);
        assert.match(storedInfo.textContent, /历史继承\s*不继承历史/);
        const legacyLink = document.querySelector(".collab-row-actions button");
        assert.ok(legacyLink, "legacy task cards must keep their own conversation entry");
        legacyLink.click();
        await settle();
        assert.equal(requests.at(-1).args.params.threadId, "legacy-child");
        assert.match(document.querySelector(".subagent-drawer").textContent, /Review the project structure/);
        document.querySelector(".subagent-drawer-close").click();
        chat.handleNotification({ method: "item/completed", params: { threadId: "main", turnId: "turn-2", item: {
            type: "collabAgentToolCall", id: "encrypted-spawn", tool: "spawnAgent", status: "completed",
            receiverThreadIds: ["encrypted-child"], prompt: `gAAAA${"Q".repeat(100)}`, model: "another-model", reasoningEffort: "medium",
            agentsStates: { "encrypted-child": { status: "running", message: null } },
        } } });
        await settle();
        assert.ok(!document.body.textContent.includes("gAAAA"), "encrypted tasks must never be rendered");
        assert.match(document.body.textContent, /执行中/, "spawn completion must not imply child completion");
        assert.match(document.body.textContent, /another-model/);
        metadataPending.get("encrypted-child")({ thread: { id: "encrypted-child", turns: [] }, metadata: { forkTurns: "3" } });
        await settle();
        assert.match(document.body.textContent, /历史继承\s*最近 3 轮/, "limited inheritance must display the exact turn count");
        chat.handleNotification({ method: "item/completed", params: { threadId: "main", turnId: "turn-2", item: activity("encrypted-done", "completed", "encrypted-child") } });
        await settle();
        assert.equal(metadataReads("encrypted-child"), 2, "parent completion activity must also refresh missing child settings");
        metadataPending.get("encrypted-child")({ thread: { id: "encrypted-child", turns: [] }, metadata: { model: "finished-child-model", effort: "high", forkTurns: "3" } });
        await settle();
        assert.match(document.body.textContent, /finished-child-model/);
        chat.handleNotification({ method: "item/started", params: { threadId: "main", turnId: "turn-2", item: activity("stale-start", "started", "stale-child") } });
        await settle();
        chat.handleSubagentMetadata({ method: "turn/completed", params: { threadId: "stale-child", turn: { status: "completed" } } });
        chat.$set({ threadId: "another-main", initialTurnsThreadId: "another-main", initialTurns: [] });
        await settle();
        metadataPending.get("stale-child")({ thread: { id: "stale-child", agentNickname: "STALE CHILD" } });
        await settle();
        assert.ok(!document.body.textContent.includes("STALE CHILD"), "switching main threads invalidates outstanding metadata reads");
        assert.equal(metadataReads("stale-child"), 1, "a pending refresh cannot restart after switching main threads");
    } finally {
        chat?.$destroy();
        dom.window.close();
        delete globalThis.subagentTestInvoke;
        await rm(temp, { recursive: true, force: true });
    }
});
