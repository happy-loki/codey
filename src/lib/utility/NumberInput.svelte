<script lang="ts">
    import { createEventDispatcher } from "svelte";
    const dispatch = createEventDispatcher();

    export let label = "";
    export let value: string | number = "";
    export let min = 12;
    export let max = 24;
    export let step = 1;
    export let _class = "";
    export let extra_small = false;

    let numericValue: number;
    
    // 将输入值转换为数字
    $: {
        if (typeof value === "number") {
            numericValue = value;
        } else if (typeof value === "string") {
            const parsed = parseFloat(value);
            numericValue = isNaN(parsed) ? min : parsed;
        } else {
            numericValue = min;
        }
        // 确保值在范围内
        numericValue = Math.max(min, Math.min(max, numericValue));
    }

    function increment() {
        const newValue = Math.min(max, numericValue + step);
        updateValue(newValue);
    }

    function decrement() {
        const newValue = Math.max(min, numericValue - step);
        updateValue(newValue);
    }

    function updateValue(newValue: number) {
        numericValue = newValue;
        dispatch("d_input", { value: newValue });
    }

    function handleDirectInput(e: Event) {
        const target = e.target as HTMLInputElement;
        const parsed = parseFloat(target.value);
        if (!isNaN(parsed)) {
            const clampedValue = Math.max(min, Math.min(max, parsed));
            updateValue(clampedValue);
        }
    }
</script>

<div class="number-input-container {_class}">
    {#if label}
        <label>{label}:</label>
    {/if}
    
    <div class="number-input-wrapper" class:extra_small>
        <button 
            type="button" 
            class="decrement-btn" 
            on:click={decrement}
            disabled={numericValue <= min}
        >
            −
        </button>
        
        <input 
            type="number" 
            class="number-display"
            bind:value={numericValue}
            on:input={handleDirectInput}
            {min}
            {max}
            {step}
        />
        
        <button 
            type="button" 
            class="increment-btn" 
            on:click={increment}
            disabled={numericValue >= max}
        >
            +
        </button>
    </div>
</div>

<style lang="scss">
    .number-input-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        margin: 10px 0;
    }

    label {
        font-size: 0.9rem;
        margin-bottom: 0.25rem;
        color: var(--window-inputLabelForeground);
    }

    .number-input-wrapper {
        display: flex;
        align-items: stretch;
        background: var(--window-inputBackground);
        width: fit-content;
        overflow: hidden;
        
        &.extra_small {
            width: 120px;
        }
    }

    .decrement-btn,
    .increment-btn {
        background: var(--window-buttonSecondaryBackground);
        border: none;
        color: var(--window-buttonSecondaryForeground);
        cursor: pointer;
        padding: 8px 12px;
        font-size: 0.9rem;
        font-weight: normal;
        transition: var(--modern-transition);
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
        
        &:hover:not(:disabled) {
            background: var(--window-buttonSecondaryHoverBackground);
            color: var(--window-buttonSecondaryHoverForeground);
        }
        
        &:active:not(:disabled) {
            transform: translateY(1px);
        }
        
        &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            color: var(--window-disabledTextForeground);
            background: var(--window-buttonSecondaryBackground);
        }

        &:focus {
            outline: 1px solid var(--window-inputFocusBorder);
            outline-offset: -1px;
        }
    }

    .decrement-btn {
        border-right: 1px solid var(--window-inputBorder);
        border-radius: 6px 0 0 6px;
    }

    .increment-btn {
        border-left: 1px solid var(--window-inputBorder);
        border-radius: 0 6px 6px 0;
    }

    .number-display {
        background: transparent;
        border: none;
        color: var(--window-inputForeground);
        text-align: center;
        padding: 8px 12px;
        font-size: 0.9rem;
        flex: 1;
        outline: none;
        font-family: inherit;
        transition: var(--modern-transition);
        
        &::placeholder {
            color: var(--window-inputPlaceholderForeground);
        }
        
        /* 隐藏数字输入框的默认箭头 */
        &::-webkit-outer-spin-button,
        &::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        
        /* Firefox */
        &[type=number] {
            -moz-appearance: textfield;
        }
    }
</style>