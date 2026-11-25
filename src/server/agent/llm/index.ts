import { config, hasApiKey } from "../../config";
import { AnthropicDriver } from "./anthropic";
import { LOCAL_MODEL, LocalDriver, localAvailable } from "./local";
import type { LlmDriver } from "./types";

export type { LlmDriver } from "./types";
export { AnthropicDriver } from "./anthropic";
export { LocalDriver } from "./local";

let anthropicDriver: AnthropicDriver | null = null;

/**
 * LLM_PROVIDER=anthropic | local | auto (default). Auto prefers Claude when a key is set,
 * then a local OpenAI-compatible server (Ollama). Null means the assistant is offline and
 * conversations go to the human queue.
 */
export async function selectDriver(): Promise<LlmDriver | null> {
  const provider = process.env.LLM_PROVIDER ?? "auto";
  if (provider === "anthropic" || (provider === "auto" && hasApiKey())) {
    if (!hasApiKey()) return null;
    anthropicDriver ??= new AnthropicDriver();
    return anthropicDriver;
  }
  if (provider === "local" || provider === "auto") {
    return (await localAvailable()) ? new LocalDriver() : null;
  }
  return null;
}

/** For the console header. */
export async function agentStatus() {
  const driver = await selectDriver();
  if (driver) return { online: true, provider: driver.provider, model: driver.model, effort: driver.provider === "anthropic" ? config.effort : null };
  return { online: false, provider: null, model: hasApiKey() ? config.model : LOCAL_MODEL, effort: null };
}
