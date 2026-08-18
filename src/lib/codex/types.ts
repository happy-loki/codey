// Re-export Codex protocol bindings generated from app-server-protocol.
// These types are generated via `codex app-server generate-ts` and copied into
// `src/lib/codex/protocol/generated`.

export * from "./protocol/generated/v2";

// Non-v2 (legacy) protocol shapes that are still active as ServerRequest methods.
export type { ApplyPatchApprovalParams } from "./protocol/generated/ApplyPatchApprovalParams";
export type { ExecCommandApprovalParams } from "./protocol/generated/ExecCommandApprovalParams";
export type { ReviewDecision } from "./protocol/generated/ReviewDecision";

export type { ClientNotification } from "./protocol/generated/ClientNotification";
export type { ClientRequest } from "./protocol/generated/ClientRequest";
export type { ServerNotification } from "./protocol/generated/ServerNotification";
export type { ServerRequest } from "./protocol/generated/ServerRequest";
