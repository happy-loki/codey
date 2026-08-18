import type { AskForApproval } from "./types";

export type AccessMode =
    | "workspaceOnRequest"
    | "workspaceNever"
    | "workspaceGuardian"
    | "fullAccess";

export function codexApprovalPolicyForAccessMode(accessMode: AccessMode): AskForApproval {
    if (accessMode === "workspaceNever") {
        return {
            granular: {
                sandbox_approval: false,
                rules: false,
                skill_approval: false,
                request_permissions: false,
                mcp_elicitations: true,
            },
        };
    }
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
