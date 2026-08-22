import { P0ApplicationError } from "../../../../lib/p0-application";
import { P0AgentRuntimeError } from "../../../../lib/p0-agent-runtime";
import { OpenAIResponsesModelError } from "../../../../lib/openai-responses-model";
import { runAgent, userKey } from "../../../../lib/p0";

function failure(error: unknown) {
  return {
    error: error instanceof Error ? error.message : "Trusted P0 agent runtime завершил действие fail closed.",
    ...(error instanceof P0ApplicationError
      || error instanceof P0AgentRuntimeError
      || error instanceof OpenAIResponsesModelError
      ? { code: error.code }
      : {}),
  };
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const value = await runAgent(userKey(request), payload);
    return Response.json(value, { status: 201 });
  } catch (error) {
    const providerUnavailable = error instanceof OpenAIResponsesModelError
      && ["MODEL_CONFIGURATION_INVALID", "MODEL_PROVIDER_FAILED"].includes(error.code);
    return Response.json(failure(error), { status: providerUnavailable ? 503 : 409 });
  }
}
