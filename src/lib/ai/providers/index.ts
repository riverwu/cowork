import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { getSettings } from "@/lib/db";
import type { LLMProvider } from "./types";

export type { LLMProvider, StreamParams, StreamEvent, ToolCall, ToolDefinition, LLMMessage } from "./types";

/** Create a provider instance from saved settings. */
export async function getConfiguredProvider(): Promise<LLMProvider> {
  const settings = await getSettings();

  if (settings.llmProvider === "anthropic") {
    if (!settings.anthropicApiKey) {
      throw new Error("Anthropic API key not configured. Go to Settings to add it.");
    }
    return new AnthropicProvider(settings.anthropicApiKey, settings.modelId);
  }

  if (settings.llmProvider === "openai") {
    if (!settings.openaiApiKey) {
      throw new Error("OpenAI API key not configured. Go to Settings to add it.");
    }
    return new OpenAIProvider(settings.openaiApiKey, settings.modelId);
  }

  throw new Error(`Unknown provider: ${settings.llmProvider}`);
}
