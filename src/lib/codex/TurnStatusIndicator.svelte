<script lang="ts">
    import { Bot, CheckCircle2, Pause, XCircle } from "lucide-svelte";
    
    export let status: "completed" | "interrupted" | "failed" | "inProgress" = "inProgress";
    export let currentItem: string | null = null; // e.g., "commandExecution", "webSearch"
    export let error: string | null = null;

    $: statusText = getStatusText(status, currentItem);
    $: StatusIconComponent = getStatusIconComponent(status);

    function getStatusText(status: string, item: string | null): string {
        if (status === "completed") return "Completed";
        if (status === "interrupted") return "Interrupted";
        if (status === "failed") return "Failed";
        
        // InProgress - static text, no animated dots
        return "Working";
    }

    function getStatusIconComponent(status: string) {
        if (status === "completed") return CheckCircle2;
        if (status === "interrupted") return Pause;
        if (status === "failed") return XCircle;
        return Bot; // In progress - AI working
    }
</script>

<div class="turn-status status-{status}">
    <svelte:component 
        this={StatusIconComponent} 
        class="status-icon-svg"
    />
    <span class="status-text">{statusText}</span>
    {#if error}
        <span class="status-error">{error}</span>
    {/if}
</div>

<style>
    .turn-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 500;
    }

    .turn-status :global(.status-icon-svg) {
        flex-shrink: 0;
        width: 12px;
        height: 12px;
    }

    .status-inProgress {
        background: rgba(33, 150, 243, 0.15);
        color: #2196f3;
        border: 1px solid rgba(33, 150, 243, 0.3);
    }
    
    .status-text {
        display: inline-block;
    }

    .status-completed {
        background: rgba(76, 175, 80, 0.15);
        color: #4caf50;
        border: 1px solid rgba(76, 175, 80, 0.3);
    }

    .status-interrupted {
        background: rgba(255, 152, 0, 0.15);
        color: #ff9800;
        border: 1px solid rgba(255, 152, 0, 0.3);
    }

    .status-failed {
        background: rgba(244, 67, 54, 0.15);
        color: #f44336;
        border: 1px solid rgba(244, 67, 54, 0.3);
    }

    .status-error {
        font-size: 11px;
        opacity: 0.9;
    }
</style>
