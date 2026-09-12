import type { AskForApproval } from "./types";

export type AccessMode =
    | "workspaceOnRequest"
    | "workspaceGuardian"
    | "fullAccess";

// Legacy auto-run preferences fall back to user approval instead of enabling automatic review.
export function normalizeAccessMode(value: unknown): AccessMode {
    return value === "workspaceGuardian" || value === "fullAccess" ? value : "workspaceOnRequest";
}

export function codexApprovalPolicyForAccessMode(_accessMode: AccessMode): AskForApproval {
    return "on-request";
}

export function approvalsReviewerForAccessMode(accessMode: AccessMode): "user" | "guardian_subagent" {
    return accessMode === "workspaceGuardian" ? "guardian_subagent" : "user";
}

export function sandboxModeForAccessMode(
    accessMode: AccessMode
): "workspace-write" | "danger-full-access" {
    return accessMode === "fullAccess" ? "danger-full-access" : "workspace-write";
}
