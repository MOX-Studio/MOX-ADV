import { CodexSubscriptionModelAdapter } from "./codex-subscription-model.ts";
import { OpenAIResponsesModelAdapter } from "./openai-responses-model.ts";
import type { P0ModelAdapter } from "./p0-agent-runtime.ts";

export type P0ModelProviderConfiguration = {
  provider: string;
  model: string;
  openaiApiKey: string;
  codexBridgeUrl: string;
  codexBridgeToken: string;
};

export class P0ModelProviderConfigurationError extends Error {
  readonly code = "MODEL_CONFIGURATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "P0ModelProviderConfigurationError";
  }
}

export function createP0ModelAdapter(
  configuration: P0ModelProviderConfiguration,
  fetcher: typeof fetch = fetch,
): P0ModelAdapter {
  const provider = configuration.provider.trim();
  if (provider === "codex-subscription") {
    return new CodexSubscriptionModelAdapter({
      endpoint: configuration.codexBridgeUrl,
      bridgeToken: configuration.codexBridgeToken,
      model: configuration.model,
      fetcher,
    });
  }
  if (provider === "openai-api") {
    return new OpenAIResponsesModelAdapter({
      apiKey: configuration.openaiApiKey,
      model: configuration.model,
      fetcher,
    });
  }
  throw new P0ModelProviderConfigurationError(
    "P0 agent model provider must be explicitly configured as codex-subscription or openai-api.",
  );
}
