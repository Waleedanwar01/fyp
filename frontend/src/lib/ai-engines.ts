import { PROVIDER_STATUS } from "@/lib/providers";

export type AIEngine = {
  name: string;
  /** Logo in /public/ai-logos (see the README there for source/licence). */
  logo: string;
  live: boolean;
};

// Engines RankLens has an integration slot for -- live/not-live comes from
// PROVIDER_STATUS, the same switch the app uses, so enabling a provider
// there flips it to "Live" on the marketing site automatically.
const INTEGRATED: AIEngine[] = [
  { name: "Google Gemini", logo: "/ai-logos/gemini.svg", live: PROVIDER_STATUS.gemini?.enabled ?? false },
  { name: "ChatGPT", logo: "/ai-logos/openai.svg", live: PROVIDER_STATUS.openai?.enabled ?? false },
  { name: "Perplexity", logo: "/ai-logos/perplexity.svg", live: PROVIDER_STATUS.perplexity?.enabled ?? false },
];

// Other answer engines on the roadmap -- never shown as live.
const ROADMAP: AIEngine[] = [
  { name: "Claude", logo: "/ai-logos/claude.svg", live: false },
  { name: "Microsoft Copilot", logo: "/ai-logos/copilot.svg", live: false },
  { name: "Google AI Overviews", logo: "/ai-logos/google.svg", live: false },
  { name: "Grok", logo: "/ai-logos/grok.svg", live: false },
  { name: "DeepSeek", logo: "/ai-logos/deepseek.svg", live: false },
  { name: "Meta AI", logo: "/ai-logos/metaai.svg", live: false },
  { name: "Mistral", logo: "/ai-logos/mistral.svg", live: false },
];

export const AI_ENGINES: AIEngine[] = [...INTEGRATED, ...ROADMAP];
export const LIVE_ENGINE_NAMES = AI_ENGINES.filter((e) => e.live).map((e) => e.name);
