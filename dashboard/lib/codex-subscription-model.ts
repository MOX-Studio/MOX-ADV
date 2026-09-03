import type {
  JsonValue,
  P0ModelAdapter,
  P0ModelTurnRequest,
  P0ModelTurnResponse,
} from "./p0-agent-runtime.ts";
import { p0ModelInput, p0ModelInstructions } from "./openai-responses-model.ts";

export class CodexSubscriptionModelError extends Error {
  readonly code: "MODEL_CONFIGURATION_INVALID" | "MODEL_PROVIDER_FAILED" | "MODEL_RESPONSE_INVALID";

  constructor(code: CodexSubscriptionModelError["code"], message: string) {
    super(message);
    this.name = "CodexSubscriptionModelError";
    this.code = code;
  }
}

function required(value: string, label: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new CodexSubscriptionModelError("MODEL_CONFIGURATION_INVALID", `${label} is invalid.`);
  }
  return normalized;
}

function loopbackEndpoint(value: string) {
  const normalized = required(value, "Codex subscription bridge endpoint", 2_000);
  let endpoint: URL;
  try {
    endpoint = new URL(normalized);
  } catch {
    throw new CodexSubscriptionModelError("MODEL_CONFIGURATION_INVALID", "Codex subscription bridge endpoint is invalid.");
  }
  if (endpoint.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(endpoint.hostname)
    || endpoint.username
    || endpoint.password) {
    throw new CodexSubscriptionModelError(
      "MODEL_CONFIGURATION_INVALID",
      "Codex subscription bridge endpoint must be an unauthenticated loopback HTTP URL.",
    );
  }
  return endpoint.toString();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function tokenCount(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function prompt(request: P0ModelTurnRequest) {
  const tools = request.tools.map(({ name, description, input_schema: inputSchema }) => ({
    name,
    description,
    input_schema: inputSchema,
  }));
  return [
    p0ModelInstructions(request),
    "Trusted runtime input (JSON):",
    JSON.stringify(p0ModelInput(request)),
    "Permitted function tools (JSON):",
    JSON.stringify(tools),
    "Return exactly one permitted tool call. The final response must contain tool_name and arguments_json. arguments_json must be a JSON-encoded object matching the selected tool input_schema. Do not use Codex shell, filesystem, browser, network, or other tools.",
  ].join("\n\n");
}

export class CodexSubscriptionModelAdapter implements P0ModelAdapter {
  readonly adapter_id: string;
  private readonly endpoint: string;
  private readonly bridgeToken: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor({
    endpoint,
    bridgeToken,
    model,
    fetcher = fetch,
    timeoutMs = 110_000,
  }: {
    endpoint: string;
    bridgeToken: string;
    model: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.endpoint = loopbackEndpoint(endpoint);
    this.bridgeToken = required(bridgeToken, "Codex subscription bridge token", 1_000);
    this.model = required(model, "Codex subscription model", 200);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
      throw new CodexSubscriptionModelError("MODEL_CONFIGURATION_INVALID", "Codex subscription bridge timeout is invalid.");
    }
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    this.adapter_id = `codex-subscription:${this.model}`;
  }

  async turn(request: P0ModelTurnRequest): Promise<P0ModelTurnResponse> {
    const tools = request.tools.map(({ name, description, input_schema: inputSchema }) => ({
      name,
      description,
      input_schema: inputSchema,
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.bridgeToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: this.model, prompt: prompt(request), tools }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new CodexSubscriptionModelError(
          "MODEL_PROVIDER_FAILED",
          `Codex subscription bridge returned HTTP ${response.status}.`,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new CodexSubscriptionModelError("MODEL_RESPONSE_INVALID", "Codex subscription bridge response is not JSON.");
      }
      const body = record(payload);
      const call = record(body.call);
      const id = String(call.id ?? "").trim();
      const name = String(call.name ?? "").trim();
      const argumentsValue = call.arguments;
      const allowed = new Set(request.tools.map((tool) => tool.name));
      if (!id || !allowed.has(name) || !argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
        throw new CodexSubscriptionModelError("MODEL_RESPONSE_INVALID", "Codex subscription bridge returned an invalid tool call.");
      }
      const usage = record(body.usage);
      return {
        kind: "TOOL_CALLS",
        calls: [{ id, name, arguments: argumentsValue as Record<string, JsonValue> }],
        usage: {
          input_tokens: tokenCount(usage.input_tokens),
          output_tokens: tokenCount(usage.output_tokens),
        },
      };
    } catch (error) {
      if (error instanceof CodexSubscriptionModelError) throw error;
      throw new CodexSubscriptionModelError(
        "MODEL_PROVIDER_FAILED",
        error instanceof Error && error.name === "AbortError"
          ? "Codex subscription bridge request timed out."
          : "Codex subscription bridge request failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
