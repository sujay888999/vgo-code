export type PricingEntry = {
  inputPrice: number;
  outputPrice: number;
  cacheReadPrice: number;
  cacheWritePrice: number;
};

export const OPENCODE_ZEN_MARKUP_MULTIPLIER = 1.2;

export const OPENCODE_ZEN_OFFICIAL_PRICING: Record<string, PricingEntry> = {
  "gpt-5.4": { inputPrice: 2.5, outputPrice: 15, cacheReadPrice: 0.25, cacheWritePrice: 0 },
  "gpt-5.4-pro": { inputPrice: 30, outputPrice: 180, cacheReadPrice: 30, cacheWritePrice: 0 },
  "gpt-5.3-codex": { inputPrice: 1.75, outputPrice: 14, cacheReadPrice: 0.175, cacheWritePrice: 0 },
  "gpt-5.3-codex-spark": { inputPrice: 1.75, outputPrice: 14, cacheReadPrice: 0.175, cacheWritePrice: 0 },
  "gpt-5.2": { inputPrice: 1.75, outputPrice: 14, cacheReadPrice: 0.175, cacheWritePrice: 0 },
  "gpt-5.2-codex": { inputPrice: 1.75, outputPrice: 14, cacheReadPrice: 0.175, cacheWritePrice: 0 },
  "gpt-5.1": { inputPrice: 1.07, outputPrice: 8.5, cacheReadPrice: 0.107, cacheWritePrice: 0 },
  "gpt-5.1-codex": { inputPrice: 1.07, outputPrice: 8.5, cacheReadPrice: 0.107, cacheWritePrice: 0 },
  "gpt-5.1-codex-max": { inputPrice: 1.25, outputPrice: 10, cacheReadPrice: 0.125, cacheWritePrice: 0 },
  "gpt-5.1-codex-mini": { inputPrice: 0.25, outputPrice: 2, cacheReadPrice: 0.025, cacheWritePrice: 0 },
  "gpt-5": { inputPrice: 1.07, outputPrice: 8.5, cacheReadPrice: 0.107, cacheWritePrice: 0 },
  "gpt-5-codex": { inputPrice: 1.07, outputPrice: 8.5, cacheReadPrice: 0.107, cacheWritePrice: 0 },
  "gpt-5-nano": { inputPrice: 0, outputPrice: 0, cacheReadPrice: 0, cacheWritePrice: 0 },
  "claude-sonnet-4-5": { inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: 3.75 },
  "claude-sonnet-4": { inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: 3.75 },
  "claude-haiku-4-5": { inputPrice: 1, outputPrice: 5, cacheReadPrice: 0.1, cacheWritePrice: 1.25 },
  "claude-3-5-haiku": { inputPrice: 0.8, outputPrice: 4, cacheReadPrice: 0.08, cacheWritePrice: 1 },
  "claude-opus-4-6": { inputPrice: 5, outputPrice: 25, cacheReadPrice: 0.5, cacheWritePrice: 6.25 },
  "claude-opus-4-5": { inputPrice: 5, outputPrice: 25, cacheReadPrice: 0.5, cacheWritePrice: 6.25 },
  "claude-opus-4-1": { inputPrice: 15, outputPrice: 75, cacheReadPrice: 1.5, cacheWritePrice: 18.75 },
  "gemini-3.1-pro": { inputPrice: 2, outputPrice: 12, cacheReadPrice: 0.2, cacheWritePrice: 0 },
  "gemini-3-pro": { inputPrice: 2, outputPrice: 12, cacheReadPrice: 0.2, cacheWritePrice: 0 },
  "gemini-3-flash": { inputPrice: 0.5, outputPrice: 3, cacheReadPrice: 0.05, cacheWritePrice: 0 },
  "glm-5": { inputPrice: 1, outputPrice: 3.2, cacheReadPrice: 0.2, cacheWritePrice: 0 },
  "kimi-k2.5": { inputPrice: 0.6, outputPrice: 3, cacheReadPrice: 0.08, cacheWritePrice: 0 },
  "minimax-m2.5": { inputPrice: 0.3, outputPrice: 1.2, cacheReadPrice: 0.06, cacheWritePrice: 0.375 },
  "minimax-m2.5-free": { inputPrice: 0, outputPrice: 0, cacheReadPrice: 0, cacheWritePrice: 0 },
  "big-pickle": { inputPrice: 0, outputPrice: 0, cacheReadPrice: 0, cacheWritePrice: 0 },
  "nemotron-3-super-free": { inputPrice: 0, outputPrice: 0, cacheReadPrice: 0, cacheWritePrice: 0 },
  "mimo-v2-pro-free": { inputPrice: 0, outputPrice: 0, cacheReadPrice: 0, cacheWritePrice: 0 },
  "mimo-v2-omni-free": { inputPrice: 0, outputPrice: 0, cacheReadPrice: 0, cacheWritePrice: 0 },
  "qwen3.6-plus-free": { inputPrice: 0, outputPrice: 0, cacheReadPrice: 0, cacheWritePrice: 0 },
};

function roundPrice(value: number) {
  return Number(value.toFixed(4));
}

export function applyOpencodeZenMarkup(entry: PricingEntry): PricingEntry {
  return {
    inputPrice: roundPrice(entry.inputPrice * OPENCODE_ZEN_MARKUP_MULTIPLIER),
    outputPrice: roundPrice(entry.outputPrice * OPENCODE_ZEN_MARKUP_MULTIPLIER),
    cacheReadPrice: roundPrice(entry.cacheReadPrice * OPENCODE_ZEN_MARKUP_MULTIPLIER),
    cacheWritePrice: roundPrice(entry.cacheWritePrice * OPENCODE_ZEN_MARKUP_MULTIPLIER),
  };
}

export function getOpencodeZenRetailPricing(modelName: string): PricingEntry | null {
  const pricing = OPENCODE_ZEN_OFFICIAL_PRICING[modelName];
  return pricing ? applyOpencodeZenMarkup(pricing) : null;
}
