export type TokenUsageInput = {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
};

export type CostBreakdown = {
    input: number;
    cached: number;
    output: number;
    total: number;
};

export type ModelPricing = {
    input_cost_per_token: number;
    output_cost_per_token: number;
    cache_read_input_token_cost?: number;
};

// Built-in defaults; expected to be overridden/augmented by future server sync.
export const MODEL_PRICING: Record<string, ModelPricing> = {
    "gpt-5.2": {
        input_cost_per_token: 1.75e-6,
        output_cost_per_token: 1.4e-5,
        cache_read_input_token_cost: 1.75e-7,
    },
    "gpt-5.2-codex": {
        input_cost_per_token: 1.75e-6,
        output_cost_per_token: 1.4e-5,
        cache_read_input_token_cost: 1.75e-7,
    },
    "gpt-5.1-codex-max": {
        input_cost_per_token: 1.25e-6,
        output_cost_per_token: 1e-5,
        cache_read_input_token_cost: 1.25e-7,
    },
    "gpt-5.1-codex-mini": {
        input_cost_per_token: 2.5e-7,
        output_cost_per_token: 2e-6,
        cache_read_input_token_cost: 2.5e-8,
    },
};

function normalizeModelId(model: string): string {
    const trimmed = model.trim().toLowerCase();
    const noSuffix = trimmed.split(/[:@]/)[0].replace(/-latest$/, "");
    return noSuffix;
}

/**
 * Estimate cost using per-token prices.
 *
 * The pricing fields in the model table are "per token" (e.g. $1.75 / 1M input tokens
 * is represented as 1.75e-6).
 * Returns null when the model isn't found in the pricing map.
 */
export function estimateCost(
    model: string | null | undefined,
    usage: TokenUsageInput | null | undefined,
    pricingMap: Record<string, ModelPricing> = MODEL_PRICING
): CostBreakdown | null {
    if (!model || !usage) return null;

    const normalized = normalizeModelId(model);
    const pricing =
        pricingMap[normalized] ||
        pricingMap[model] ||
        (normalized.includes("gpt-5.2") ? pricingMap["gpt-5.2"] : undefined);
    if (!pricing) return null;

    const inputBillable = Math.max(usage.inputTokens - usage.cachedInputTokens, 0);
    const input = inputBillable * pricing.input_cost_per_token;

    const cached = pricing.cache_read_input_token_cost
        ? usage.cachedInputTokens * pricing.cache_read_input_token_cost
        : 0;

    const outputBillable = usage.outputTokens + usage.reasoningOutputTokens;
    const output = outputBillable * pricing.output_cost_per_token;

    return {
        input,
        cached,
        output,
        total: input + cached + output,
    };
}
