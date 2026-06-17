import type { Adapter } from "../types.js";
import { anthropicAdapter } from "./anthropic.js";
import { bedrockAdapter } from "./bedrock.js";
import { geminiAdapter } from "./gemini.js";
import { openaiAdapter } from "./openai.js";

export { anthropicAdapter } from "./anthropic.js";
export { bedrockAdapter } from "./bedrock.js";
export { geminiAdapter } from "./gemini.js";
export { openaiAdapter } from "./openai.js";

/**
 * The set of adapters registered on every new {@link UsageMeter} by default.
 * Order matters: the first match wins. More-specific provider detection comes
 * first.
 */
export const BUILT_IN_ADAPTERS: readonly Adapter[] = [
	openaiAdapter,
	anthropicAdapter,
	bedrockAdapter,
	geminiAdapter,
];
