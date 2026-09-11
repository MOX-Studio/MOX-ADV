import { isPublicCompetitorDiscovery, isEvidenceResearch } from "./public-web-research.ts";
import type {
  JsonValue,
  P0ModelAdapter,
  P0ModelTurnRequest,
  P0ModelTurnResponse,
} from "./p0-agent-runtime.ts";
import { p0ModelInput, p0ModelInstructions } from "./openai-responses-model.ts";
import { chooseCodexOutputPlan, CODEX_NATIVE_OUTPUT, type CodexOutputPlan } from "./codex-subscription-protocol.mjs";
import { losslessModelInputText, LOSSLESS_MODEL_INPUT_INSTRUCTIONS } from "./lossless-model-input.ts";

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

const CODEX_PROMPT_MAXIMUM = 1_000_000;

function compactJson(value: JsonValue, depth = 0): JsonValue {
  if (typeof value === "string") {
    return value.length <= 2_000 ? value : `${value.slice(0, 1_999)}…`;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => compactJson(item, depth + 1));
    return value.length <= 20 ? items : [...items, { omitted_items: value.length - 20 }];
  }
  if (value && typeof value === "object") {
    if (depth >= 8) return { compacted: true };
    return Object.fromEntries(Object.entries(value).slice(0, 100)
      .map(([key, item]) => [key, compactJson(item, depth + 1)]));
  }
  return value;
}

function renderPrompt(request: P0ModelTurnRequest, compactObservations: boolean, output: CodexOutputPlan) {
  const tools = request.tools.map(({ name, description, input_schema: inputSchema }) => ({
    name,
    description,
    input_schema: inputSchema,
  }));
  const input = p0ModelInput(request);
  if (compactObservations) {
    input.observations = request.observations.map((observation) => ({
      ...observation,
      facts: compactJson(observation.facts as JsonValue) as Record<string, JsonValue>,
    }));
  }
  const closedStage = request.tools.length === 1 && request.tools[0].permission === "P0_OBSERVATION_RECORD";
  const toolBoundary = isPublicCompetitorDiscovery(request.tools)
    ? "Use the enabled built-in web search for purposeful public competitor discovery before the final JSON. Stop when the research questions have sufficient evidence or accessible sources are exhausted. Do not use shell, filesystem, authenticated browser, arbitrary HTTP, MCP, or any write tool."
    : "Do not use Codex shell, filesystem, browser, network, or other tools.";
  const renderedInput = closedStage ? losslessModelInputText(input as unknown as JsonValue) : { text: JSON.stringify(input), packed: false };
  return [
    p0ModelInstructions(request),
    renderedInput.packed ? `Trusted runtime input (JSON). ${LOSSLESS_MODEL_INPUT_INSTRUCTIONS}` : "Trusted runtime input (JSON):",
    renderedInput.text,
    "Permitted function tools (JSON):",
    JSON.stringify(tools),
    output.format === CODEX_NATIVE_OUTPUT
      ? `Return only the JSON argument object for the sole permitted tool ${output.bound_tool}; the bridge binds that tool name. Do not wrap the object in tool_name, arguments_json, call, or arguments. The object must satisfy the original tool input_schema, including constraints not represented in the native output schema. ${toolBoundary}`
      : `Return exactly one permitted tool call. The final response must contain tool_name and arguments_json. arguments_json must be a JSON-encoded object matching the selected tool input_schema. ${toolBoundary}`,
  ].join("\n\n");
}

function prompt(request: P0ModelTurnRequest, output: CodexOutputPlan) {
  const complete = renderPrompt(request, false, output);
  if (complete.length <= CODEX_PROMPT_MAXIMUM) return complete;
  if (request.tools.length === 1 && request.tools[0].permission === "P0_OBSERVATION_RECORD") {
    throw new CodexSubscriptionModelError("MODEL_CONFIGURATION_INVALID", "The complete stage input exceeds the prompt limit after lossless packing; source evidence was not truncated.");
  }
  const compacted = renderPrompt(request, true, output);
  if (compacted.length > CODEX_PROMPT_MAXIMUM) {
    throw new CodexSubscriptionModelError(
      "MODEL_CONFIGURATION_INVALID",
      "Codex subscription prompt remains too large after bounded observation compaction.",
    );
  }
  return compacted;
}

export class CodexSubscriptionModelAdapter implements P0ModelAdapter {
  readonly adapter_id: string;
  private readonly endpoint: string;
  private readonly bridgeToken: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly useStageBudget: boolean;

  constructor({
    endpoint,
    bridgeToken,
    model,
    fetcher = fetch,
    timeoutMs,
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
    const configuredTimeout = timeoutMs ?? 110_000;
    if (!Number.isSafeInteger(configuredTimeout) || configuredTimeout <= 0 || configuredTimeout > 120_000) {
      throw new CodexSubscriptionModelError("MODEL_CONFIGURATION_INVALID", "Codex subscription bridge timeout is invalid.");
    }
    this.fetcher = fetcher;
    this.timeoutMs = configuredTimeout;
    this.useStageBudget = timeoutMs === undefined;
    this.adapter_id = `codex-subscription:${this.model}`;
  }

  async turn(request: P0ModelTurnRequest, options: { signal?: AbortSignal } = {}): Promise<P0ModelTurnResponse> {
    const tools = request.tools.map(({ name, description, input_schema: inputSchema }) => ({
      name,
      description,
      input_schema: inputSchema,
    }));
    const closedStageTool = request.tools.length === 1
      && request.tools[0].permission === "P0_OBSERVATION_RECORD"
      && request.policy.allowed_permissions.length === 1 && request.policy.allowed_permissions[0] === "P0_OBSERVATION_RECORD"
      && request.policy.allowed_tools.length === 1 && request.policy.allowed_tools[0] === request.tools[0].name;
    const output = chooseCodexOutputPlan(tools, closedStageTool);
    const stageBudget = Number(request.budget.remaining.max_elapsed_ms);
    const requestTimeoutMs = closedStageTool && this.useStageBudget && Number.isFinite(stageBudget) && stageBudget > 120_000
      ? Math.min(295_000, Math.max(1_000, stageBudget - 5_000)) : this.timeoutMs;
    const controller = new AbortController();
    const untimed = closedStageTool && this.useStageBudget && request.execution?.time_limit_ms === null && isEvidenceResearch(request.tools);
    const timeout = untimed ? undefined : setTimeout(() => controller.abort(), requestTimeoutMs);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    signal.throwIfAborted();
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.bridgeToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: this.model, prompt: prompt(request, output), tools, output_format: output.format,
          ...(untimed ? { timeout_ms: null } : requestTimeoutMs > 120_000 ? { timeout_ms: requestTimeoutMs - 5_000 } : {}),
        }),
        signal,
      });
      if (!response.ok) {
        let failure: Record<string, unknown> = {};
        try { failure = record(await response.json()); } catch { /* Non-JSON outages remain provider failures. */ }
        const code = failure.code === "MODEL_CONFIGURATION_INVALID" || failure.code === "MODEL_RESPONSE_INVALID"
          ? failure.code : "MODEL_PROVIDER_FAILED";
        throw new CodexSubscriptionModelError(
          code,
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
      const completedWebCalls = Number(record(body.public_research).completed_web_calls);
      if (isPublicCompetitorDiscovery(request.tools) && (!Number.isSafeInteger(completedWebCalls)
        || completedWebCalls < 1)) {
        throw new CodexSubscriptionModelError("MODEL_RESPONSE_INVALID", "Competitor discovery returned no completed public web research.");
      }
      if (body.output_format !== output.format) throw new CodexSubscriptionModelError("MODEL_RESPONSE_INVALID", "Codex subscription bridge output format does not match the requested protocol.");
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
      options.signal?.throwIfAborted();
      if (error instanceof CodexSubscriptionModelError) throw error;
      throw new CodexSubscriptionModelError(
        "MODEL_PROVIDER_FAILED",
        error instanceof Error && error.name === "AbortError"
          ? "Codex subscription bridge request timed out."
          : "Codex subscription bridge request failed.",
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
