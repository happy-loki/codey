import type {
    ThreadItem as ProtocolThreadItem,
    Turn as ProtocolTurn,
} from "./protocol/generated/v2";

// Re-export Codex protocol bindings generated from app-server-protocol.
// These types are generated via `codex app-server generate-ts` and copied into
// `src/lib/codex/protocol/generated`.

export * from "./protocol/generated/v2";

// Non-v2 (legacy) protocol shapes that are still active as ServerRequest methods.
export type { ApplyPatchApprovalParams } from "./protocol/generated/ApplyPatchApprovalParams";
export type { ExecCommandApprovalParams } from "./protocol/generated/ExecCommandApprovalParams";
export type { ReviewDecision } from "./protocol/generated/ReviewDecision";

// Codey keeps a small compatibility layer for UI-only items and the approval
// vocabulary used by the legacy review endpoints. These are intentionally not
// added to generated protocol files.
export type ApprovalDecision = "accept" | "decline" | "cancel";

export type TodoItem = {
    id: string;
    text: string;
    completed: boolean;
};

export type CodeyTodoListItem = {
    type: "todoList";
    id: string;
    items: TodoItem[];
};

export type CodeyFunctionToolCallItem = {
    type: "functionToolCall";
    id: string;
    toolName: string;
    arguments: string;
    output: string;
    success: boolean | null;
};

export type CodeyCodeReviewItem = {
    type: "codeReview";
    id: string;
    review?: string;
};

export type CodeyThreadItem =
    | ProtocolThreadItem
    | CodeyTodoListItem
    | CodeyFunctionToolCallItem
    | CodeyCodeReviewItem;

export type ThreadItem = CodeyThreadItem;
export type Turn = Omit<ProtocolTurn, "items"> & { items: ThreadItem[] };
export type ReasoningEffort = import("./protocol/generated/ReasoningEffort").ReasoningEffort;
export type Tool = import("./protocol/generated/Tool").Tool;

// The generated v2 shape is authoritative for wire data. CodeyThreadItem is
// used at the rendering boundary because old resumed threads can still contain
// these locally synthesized items.

export type { ClientNotification } from "./protocol/generated/ClientNotification";
export type { ClientRequest } from "./protocol/generated/ClientRequest";
export type { ServerNotification } from "./protocol/generated/ServerNotification";
export type { ServerRequest } from "./protocol/generated/ServerRequest";
