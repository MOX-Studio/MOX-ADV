import { CodexSubscriptionModelError } from "../../../../lib/codex-subscription-model";
import { P0ApplicationError } from "../../../../lib/p0-application";
import { P0AgentRuntimeError } from "../../../../lib/p0-agent-runtime";
import { P0ModelProviderConfigurationError } from "../../../../lib/p0-model-provider";
import { OpenAIResponsesModelError } from "../../../../lib/openai-responses-model";
import { runAgent, userKey } from "../../../../lib/p0";

function failure(error: unknown) {
  return {
    error: error instanceof Error ? error.message : "Trusted P0 agent runtime завершил действие fail closed.",
    ...(error instanceof P0ApplicationError
      || error instanceof P0AgentRuntimeError
      || error instanceof OpenAIResponsesModelError
      || error instanceof CodexSubscriptionModelError
      || error instanceof P0ModelProviderConfigurationError
      ? { code: error.code }
      : {}),
  };
}

export async function POST(request: Request) {
  try {
    const value = await runAgent(userKey(request));
    return Response.json(value, { status: 201 });
  } catch (error) {
    const providerUnavailable = (error instanceof OpenAIResponsesModelError
      || error instanceof CodexSubscriptionModelError
      || error instanceof P0ModelProviderConfigurationError)
      && ["MODEL_CONFIGURATION_INVALID", "MODEL_PROVIDER_FAILED"].includes(error.code);
    return Response.json(failure(error), { status: providerUnavailable ? 503 : 409 });
  }
}
