<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { Hand, OctagonAlert, ShieldCheck } from "lucide-svelte";
    import { t } from "../i18n";
    import type { AccessMode } from "./approvalModes";

    export let selectedPolicy: AccessMode = "workspaceOnRequest";
    export let policyOptions:
        | Array<{
              value: AccessMode;
              label: string;
              buttonLabel?: string;
              tip?: string;
              icon: any;
              tone?: "primary" | "success" | "danger";
          }>
        | null = null;

    type PolicyTone = "primary" | "success" | "danger";

    type PolicyOption = {
        value: AccessMode;
        labelKey?: string;
        label?: string;
        buttonLabelKey?: string;
        buttonLabel?: string;
        tipKey?: string;
        tip?: string;
        icon: any;
        tone?: PolicyTone;
    };

    const defaultPolicies: PolicyOption[] = [
        {
            value: "workspaceOnRequest",
            labelKey: "codex.approval.workspaceOnRequest",
            buttonLabelKey: "codex.approval.workspaceOnRequestShort",
            tipKey: "codex.approval.workspaceOnRequestTip",
            icon: Hand,
            tone: "primary",
        },
        {
            value: "workspaceGuardian",
            labelKey: "codex.approval.workspaceGuardian",
            buttonLabelKey: "codex.approval.workspaceGuardianShort",
            tipKey: "codex.approval.workspaceGuardianTip",
            icon: ShieldCheck,
            tone: "primary",
        },
        {
            value: "fullAccess",
            labelKey: "codex.approval.fullAccess",
            buttonLabelKey: "codex.approval.fullAccessShort",
            tipKey: "codex.approval.fullAccessTip",
            icon: OctagonAlert,
            tone: "danger",
        },
    ];

    let isOpen = false;
    let rootEl: HTMLDivElement | null = null;
    const dispatch = createEventDispatcher<{ selectedPolicyChange: AccessMode }>();

    function handleDocumentPointerDown(event: PointerEvent) {
        if (!isOpen || !rootEl) return;
        const target = event.target as Node | null;
        if (target && rootEl.contains(target)) return;
        isOpen = false;
    }

    if (typeof window !== "undefined") {
        window.addEventListener("pointerdown", handleDocumentPointerDown, true);
    }

    onDestroy(() => {
        if (typeof window !== "undefined") {
            window.removeEventListener("pointerdown", handleDocumentPointerDown, true);
        }
    });

    function selectPolicy(policy: AccessMode) {
        selectedPolicy = policy;
        dispatch("selectedPolicyChange", policy);
        isOpen = false;
    }

    function toggleDropdown() {
        isOpen = !isOpen;
    }

    $: policies =
        policyOptions?.map<PolicyOption>((option) => ({
            value: option.value,
            label: option.label,
            buttonLabel: option.buttonLabel ?? option.label,
            tip: option.tip,
            icon: option.icon,
            tone: option.tone,
        })) ?? defaultPolicies;
    $: currentPolicy = policies.find((p) => p.value === selectedPolicy) ?? policies[0];
    $: currentPolicyIconClass = "policy-icon";
</script>

<div class="policy-selector" bind:this={rootEl}>
    <button class="policy-button" on:click={toggleDropdown}>
        {#if currentPolicy}
            <svelte:component
                this={currentPolicy.icon}
                class={currentPolicyIconClass}
                size="1em"
                strokeWidth={1.5}
            />
            <span>{currentPolicy.buttonLabel ?? $t(currentPolicy.buttonLabelKey || currentPolicy.labelKey || "")}</span>
        {/if}
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="chevron"
            class:open={isOpen}
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    </button>

    {#if isOpen}
        <div class="policy-dropdown">
            {#each policies as policy}
                <button
                    class="policy-option"
                    class:selected={selectedPolicy === policy.value}
                    class:danger={policy.tone === "danger"}
                    class:success={policy.tone === "success"}
                    on:click={() => selectPolicy(policy.value)}
                    title={policy.tip ?? $t(policy.tipKey || "")}
                >
                    <div class="option-left">
                        <svelte:component
                            this={policy.icon}
                            class={`policy-icon${policy.tone === "danger" ? " danger" : ""}${policy.tone === "success" ? " success" : ""}`}
                            size="1em"
                            strokeWidth={1.5}
                        />
                        <div class="option-text">
                            <span class="option-label">{policy.label ?? $t(policy.labelKey || "")}</span>
                            {#if policy.tip || policy.tipKey}
                                <span class="option-description">{policy.tip ?? $t(policy.tipKey || "")}</span>
                            {/if}
                        </div>
                    </div>
                    {#if selectedPolicy === policy.value}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 6L9 17l-5-5" />
                        </svg>
                    {/if}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .policy-selector {
        position: relative;
    }

    .policy-button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: var(--bg-secondary, #252525);
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--text-primary, #fff);
        cursor: pointer;
        font-size: var(--header-compact-font-size, 12px);
        transition: all 0.2s;
    }

    .policy-icon {
        flex-shrink: 0;
        stroke-width: 1.5;
    }

    .policy-button:hover,
    .policy-button:focus-visible {
        background: var(--bg-hover, #2a2a2a);
        border-color: var(--accent-color, #007acc);
    }

    .policy-button .chevron {
        transition: transform 0.2s;
        color: var(--text-secondary, #aaa);
    }

    .policy-button .chevron.open {
        transform: rotate(180deg);
    }

    .policy-dropdown {
        position: absolute;
        bottom: calc(100% + 4px);
        left: 0;
        width: 340px;
        max-width: calc(100vw - 32px);
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        overflow: hidden;
        animation: slideDown 0.15s ease-out;
    }

    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .policy-option {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: transparent;
        border: none;
        color: var(--text-primary, #fff);
        cursor: pointer;
        transition: background 0.15s;
        text-align: left;
        font-size: var(--header-compact-font-size, 12px);
    }

    .policy-option:hover {
        background: var(--bg-hover, #2a2a2a);
    }

    .policy-option.selected {
        background: rgba(0, 122, 204, 0.1);
    }

    .policy-option.success.selected {
        background: rgba(55, 147, 92, 0.12);
    }

    .policy-option.danger.selected {
        background: rgba(216, 79, 69, 0.12);
    }

    .option-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
    }

    .option-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .option-description {
        color: var(--text-secondary, #aaa);
        font-size: 0.95em;
        line-height: 1.4;
    }

    .option-label {
        font-size: 1em;
        font-weight: 500;
        color: var(--text-primary, #fff);
    }

    .policy-icon.danger {
        color: #d84f45;
    }

    .policy-icon.success {
        color: #37935c;
    }

</style>
