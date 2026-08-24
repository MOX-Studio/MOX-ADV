export const P0_AGENT_RUNTIME_CONTRACT = "mox-adv.p0.agent-runtime";
export const P0_AGENT_RUNTIME_VERSION = "2.0.0";
export const P0_AGENT_RUN_SCHEMA = "p0-agent-run-v2";
export const P0_AGENT_APPLICATION_CONTRACT_SCHEMA = "p0-agent-application-contract-v1";
export const P0_AGENT_OBSERVATION_SCHEMA = "p0-agent-observation-v1";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type P0AgentObjectiveKind = "COORDINATE_OWNER_JOURNEY";
export type P0AgentToolPermission =
  | "P0_APPLICATION_READ"
  | "P0_PROVIDER_READ"
  | "P0_LOCAL_DRAFT_WRITE"
  | "P0_APPROVED_DISPATCH"
  | "P0_OBSERVATION_RECORD";

export type P0AgentStopReasonCode =
  | "COMPLETED"
  | "MATERIAL_DECISION_REQUIRED"
  | "CRITICAL_DECISION_REQUIRED"
  | "EXACT_WRITE_AUTHORITY_REQUIRED"
  | "BUDGET_EXHAUSTED"
  | "TEMPORARY_PROVIDER_FAILURE"
  | "POLICY_SAFETY_BLOCKED"
  | "REPEATED_SAFE_READ_FAILURE"
  | "AMBIGUOUS_WRITE_REQUIRES_RECONCILIATION"
  | "RESUME_PRECONDITION_FAILED";

export type P0AgentStopReason = {
  code: P0AgentStopReasonCode;
  message: string;
  resumable: boolean;
  resume_at?: string;
};

export type P0AgentToolDefinition = {
  name: string;
  description: string;
  permission: P0AgentToolPermission;
  input_schema: Record<string, JsonValue>;
};

export type P0AgentApplicationContract = {
  schema_version: typeof P0_AGENT_APPLICATION_CONTRACT_SCHEMA;
  objective: {
    kind: P0AgentObjectiveKind;
    statement: string;
  };
  policy: {
    version: string;
    instruction: string;
    allowed_tools: string[];
    allowed_permissions: P0AgentToolPermission[];
  };
  authority: {
    application_revision: number;
    authority_digest: string;
    prior_outcomes_digest: string;
    observed_at: string;
    fresh_until: string;
  };
  tools: P0AgentToolDefinition[];
};

export type P0AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, JsonValue>;
};

export type P0ValidatedObservation = {
  schema_version: typeof P0_AGENT_OBSERVATION_SCHEMA;
  sequence: number;
  tool_call_id: string;
  tool_name: string;
  trust: "TRUSTED_APPLICATION" | "UNTRUSTED_EVIDENCE";
  summary: string;
  facts: Record<string, JsonValue>;
  source_references: Array<{
    source_kind: string;
    locator: string;
    observed_at: string;
  }>;
  application_revision: number;
  authority_digest: string;
  prior_outcomes_digest: string;
  observed_at: string;
};

export type P0ModelTurnRequest = {
  contract: {
    name: typeof P0_AGENT_RUNTIME_CONTRACT;
    version: typeof P0_AGENT_RUNTIME_VERSION;
  };
  run_id: string;
  objective: P0AgentApplicationContract["objective"];
  policy: P0AgentApplicationContract["policy"];
  authority: P0AgentApplicationContract["authority"];
  tools: P0AgentToolDefinition[];
  checkpoint: {
    sequence: number;
    compacted_summary: string | null;
  };
  observations: P0ValidatedObservation[];
  budget: P0AgentBudgetState;
};

export type P0ModelUsage = {
  input_tokens: number;
  output_tokens: number;
  cost_microusd?: number;
};

export type P0ModelTurnResponse = {
  kind: "TOOL_CALLS";
  calls: P0AgentToolCall[];
  usage: P0ModelUsage;
} | {
  kind: "YIELD";
  message: string;
  usage: P0ModelUsage;
};

export interface P0ModelAdapter {
  readonly adapter_id: string;
  turn(request: P0ModelTurnRequest): Promise<P0ModelTurnResponse>;
}

export type P0AgentApplicationEvaluation = {
  status: "CONTINUE";
  stop_reason: null;
} | {
  status: "STOP";
  stop_reason: P0AgentStopReason;
};

export interface P0AgentApplicationAuthority {
  contract(ownerKey: string, objectiveKind: P0AgentObjectiveKind): Promise<P0AgentApplicationContract>;
  executeTool(input: {
    owner_key: string;
    run_id: string;
    objective: P0AgentApplicationContract["objective"];
    authority: P0AgentApplicationContract["authority"];
    call: P0AgentToolCall;
    observation_sequence: number;
  }): Promise<{
    observation: P0ValidatedObservation;
    contract: P0AgentApplicationContract;
  }>;
  evaluate(input: {
    owner_key: string;
    run_id: string;
    objective: P0AgentApplicationContract["objective"];
    authority: P0AgentApplicationContract["authority"];
    observation_count: number;
    last_observation: P0ValidatedObservation | null;
  }): Promise<P0AgentApplicationEvaluation>;
}

export type P0AgentBudgetLimits = {
  max_model_calls: number;
  max_tool_calls: number;
  max_input_tokens: number;
  max_output_tokens: number;
  max_elapsed_ms: number;
  max_cost_microusd: number;
};

export type P0AgentBudgetUsage = {
  model_calls: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  elapsed_ms: number;
  cost_microusd: number;
};

export type P0AgentBudgetState = {
  limits: P0AgentBudgetLimits;
  usage: P0AgentBudgetUsage;
  remaining: P0AgentBudgetLimits;
};

export type P0AgentCheckpoint = {
  sequence: number;
  kind: "START" | "MODEL_CALL_INTENT" | "MODEL_TURN" | "TOOL_OBSERVATION" | "COMPACTION" | "STOP";
  application_revision: number;
  authority_digest: string;
  prior_outcomes_digest: string;
  observation_count: number;
  budget_usage: P0AgentBudgetUsage;
  recorded_at: string;
};

export type P0AgentRunState = {
  schema_version: typeof P0_AGENT_RUN_SCHEMA;
  contract: {
    name: typeof P0_AGENT_RUNTIME_CONTRACT;
    version: typeof P0_AGENT_RUNTIME_VERSION;
  };
  run_id: string;
  version: number;
  owner_key: string;
  objective: P0AgentApplicationContract["objective"];
  policy: P0AgentApplicationContract["policy"];
  authority: P0AgentApplicationContract["authority"];
  tools: P0AgentToolDefinition[];
  model_adapter_id: string;
  status: "RUNNING" | "STOPPED" | "COMPLETED";
  stop_reason: P0AgentStopReason | null;
  budget: P0AgentBudgetState;
  checkpoints: P0AgentCheckpoint[];
  observations: P0ValidatedObservation[];
  compaction: {
    through_observation_sequence: number;
    summary: string;
    compacted_at: string;
  } | null;
  created_at: string;
  updated_at: string;
};

export interface P0AgentRunStore {
  load(runId: string): Promise<P0AgentRunState | null>;
  loadCurrent?(ownerKey: string): Promise<P0AgentRunState | null>;
  initialize(state: P0AgentRunState): Promise<boolean>;
  compareAndSwap(runId: string, expectedVersion: number, state: P0AgentRunState): Promise<boolean>;
}

const DEFAULT_BUDGETS: P0AgentBudgetLimits = {
  max_model_calls: 8,
  max_tool_calls: 12,
  max_input_tokens: 80_000,
  max_output_tokens: 16_000,
  max_elapsed_ms: 120_000,
  max_cost_microusd: 100_000,
};

const TOOL_PERMISSIONS = new Set<P0AgentToolPermission>([
  "P0_APPLICATION_READ",
  "P0_PROVIDER_READ",
  "P0_LOCAL_DRAFT_WRITE",
  "P0_APPROVED_DISPATCH",
  "P0_OBSERVATION_RECORD",
]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validIso(value: string) {
  return Number.isFinite(Date.parse(value));
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function requireText(value: unknown, label: string, maximum = 2_000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", `${label} is invalid.`);
  }
}

function assertApplicationContract(
  value: P0AgentApplicationContract,
  expectedObjective?: P0AgentObjectiveKind,
) {
  if (value?.schema_version !== P0_AGENT_APPLICATION_CONTRACT_SCHEMA) {
    throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", "Application agent contract schema is invalid.");
  }
  if (expectedObjective && value.objective?.kind !== expectedObjective) {
    throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", "Application returned a different objective.");
  }
  requireText(value.objective?.statement, "Agent objective");
  requireText(value.policy?.version, "Agent policy version", 200);
  requireText(value.policy?.instruction, "Agent policy instruction", 4_000);
  if (!nonNegativeInteger(value.authority?.application_revision)) {
    throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", "Application revision is invalid.");
  }
  requireText(value.authority?.authority_digest, "Authority digest", 500);
  requireText(value.authority?.prior_outcomes_digest, "Prior outcomes digest", 500);
  if (!validIso(value.authority?.observed_at) || !validIso(value.authority?.fresh_until)) {
    throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", "Authority freshness is invalid.");
  }
  if (!Array.isArray(value.tools) || !Array.isArray(value.policy.allowed_tools)) {
    throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", "Allowed tools are invalid.");
  }
  const toolNames = value.tools.map((tool) => tool.name);
  if (new Set(toolNames).size !== toolNames.length || JSON.stringify(toolNames) !== JSON.stringify(value.policy.allowed_tools)) {
    throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", "Tool registry differs from application policy.");
  }
  const allowedPermissions = new Set(value.policy.allowed_permissions);
  for (const tool of value.tools) {
    if (!/^p0_[a-z0-9_]+$/u.test(tool.name)) {
      throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", "Tool name is outside the P0 namespace.");
    }
    requireText(tool.description, `Tool ${tool.name} description`, 1_000);
    if (!TOOL_PERMISSIONS.has(tool.permission) || !allowedPermissions.has(tool.permission)) {
      throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", `Tool ${tool.name} permission is not allowed.`);
    }
    const schema = tool.input_schema;
    if (schema?.type !== "object" || schema.additionalProperties !== false) {
      throw new P0AgentRuntimeError("P0_AGENT_CONTRACT_INVALID", `Tool ${tool.name} must use a closed object schema.`);
    }
  }
}

function assertFresh(contract: P0AgentApplicationContract, nowValue: string) {
  if (Date.parse(contract.authority.fresh_until) <= Date.parse(nowValue)) {
    throw new P0AgentRuntimeError("P0_AGENT_AUTHORITY_STALE", "Application authority is stale.");
  }
}

function validateScalar(value: JsonValue | undefined, schema: Record<string, JsonValue>) {
  if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) return false;
    if (typeof schema.minimum === "number" && Number(value) < schema.minimum) return false;
    return true;
  }
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "boolean") return typeof value === "boolean";
  return true;
}

function validateArguments(call: P0AgentToolCall, definition: P0AgentToolDefinition) {
  if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) return false;
  const schema = definition.input_schema;
  const properties = (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties))
    ? schema.properties as Record<string, Record<string, JsonValue>>
    : {};
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  if (required.some((key) => !Object.hasOwn(call.arguments, key))) return false;
  if (Object.keys(call.arguments).some((key) => !Object.hasOwn(properties, key))) return false;
  return Object.entries(call.arguments).every(([key, value]) => validateScalar(value, properties[key] ?? {}));
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => isJsonValue(item, depth + 1));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.entries(value);
  return entries.length <= 256
    && entries.every(([key, item]) => key.length <= 255 && isJsonValue(item, depth + 1));
}

function assertObservation(
  observation: P0ValidatedObservation,
  call: P0AgentToolCall,
  sequence: number,
  contract: P0AgentApplicationContract,
) {
  if (observation?.schema_version !== P0_AGENT_OBSERVATION_SCHEMA
    || observation.sequence !== sequence
    || observation.tool_call_id !== call.id
    || observation.tool_name !== call.name) {
    throw new P0AgentRuntimeError("P0_AGENT_OBSERVATION_INVALID", "Tool observation identity is invalid.");
  }
  if (!["TRUSTED_APPLICATION", "UNTRUSTED_EVIDENCE"].includes(observation.trust)) {
    throw new P0AgentRuntimeError("P0_AGENT_OBSERVATION_INVALID", "Tool observation trust is invalid.");
  }
  if (typeof observation.summary !== "string" || !observation.summary.trim() || observation.summary.length > 4_000) {
    throw new P0AgentRuntimeError("P0_AGENT_OBSERVATION_INVALID", "Tool observation summary is invalid.");
  }
  if (!observation.facts || typeof observation.facts !== "object" || Array.isArray(observation.facts)
    || !isJsonValue(observation.facts) || JSON.stringify(observation.facts).length > 64_000) {
    throw new P0AgentRuntimeError("P0_AGENT_OBSERVATION_INVALID", "Tool observation facts are invalid or oversized.");
  }
  if (!Array.isArray(observation.source_references)
    || observation.source_references.length < 1
    || observation.source_references.length > 64
    || observation.source_references.some((source) => {
      const keys = source && typeof source === "object" ? Object.keys(source).sort() : [];
      return JSON.stringify(keys) !== JSON.stringify(["locator", "observed_at", "source_kind"])
        || typeof source.source_kind !== "string" || !source.source_kind.trim() || source.source_kind.length > 200
        || typeof source.locator !== "string" || !source.locator.trim() || source.locator.length > 2_000
        || typeof source.observed_at !== "string" || !validIso(source.observed_at);
    })) {
    throw new P0AgentRuntimeError("P0_AGENT_OBSERVATION_INVALID", "Tool source references are invalid.");
  }
  if (!validIso(observation.observed_at)) {
    throw new P0AgentRuntimeError("P0_AGENT_OBSERVATION_INVALID", "Tool observation timestamp is invalid.");
  }
  if (observation.application_revision !== contract.authority.application_revision
    || observation.authority_digest !== contract.authority.authority_digest
    || observation.prior_outcomes_digest !== contract.authority.prior_outcomes_digest) {
    throw new P0AgentRuntimeError("P0_AGENT_OBSERVATION_INVALID", "Tool observation is not bound to application authority.");
  }
}

function budgetState(limits: P0AgentBudgetLimits): P0AgentBudgetState {
  const usage: P0AgentBudgetUsage = {
    model_calls: 0,
    tool_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    elapsed_ms: 0,
    cost_microusd: 0,
  };
  return { limits: clone(limits), usage, remaining: clone(limits) };
}

function recomputeBudget(state: P0AgentRunState) {
  const usage = state.budget.usage;
  const limits = state.budget.limits;
  state.budget.remaining = {
    max_model_calls: Math.max(0, limits.max_model_calls - usage.model_calls),
    max_tool_calls: Math.max(0, limits.max_tool_calls - usage.tool_calls),
    max_input_tokens: Math.max(0, limits.max_input_tokens - usage.input_tokens),
    max_output_tokens: Math.max(0, limits.max_output_tokens - usage.output_tokens),
    max_elapsed_ms: Math.max(0, limits.max_elapsed_ms - usage.elapsed_ms),
    max_cost_microusd: Math.max(0, limits.max_cost_microusd - usage.cost_microusd),
  };
}

function elapsedBetween(startedAt: string, finishedAt: string) {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

async function coordinatorRunId(ownerKey: string, contract: P0AgentApplicationContract) {
  const material = JSON.stringify({
    owner_key: ownerKey,
    objective: contract.objective.kind,
    application_revision: contract.authority.application_revision,
    authority_digest: contract.authority.authority_digest,
    prior_outcomes_digest: contract.authority.prior_outcomes_digest,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return `p0-agent:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function checkpoint(
  state: P0AgentRunState,
  kind: P0AgentCheckpoint["kind"],
  nowValue: string,
): P0AgentCheckpoint {
  return {
    sequence: state.checkpoints.length + 1,
    kind,
    application_revision: state.authority.application_revision,
    authority_digest: state.authority.authority_digest,
    prior_outcomes_digest: state.authority.prior_outcomes_digest,
    observation_count: state.observations.length,
    budget_usage: clone(state.budget.usage),
    recorded_at: nowValue,
  };
}

function stopReason(
  code: P0AgentStopReasonCode,
  message: string,
  resumable = false,
  resumeAt?: string,
): P0AgentStopReason {
  return { code, message, resumable, ...(resumeAt ? { resume_at: resumeAt } : {}) };
}

function exceededTokenOrTimeBudget(state: P0AgentRunState) {
  const { limits, usage } = state.budget;
  const exhausted = [
    usage.input_tokens > limits.max_input_tokens ? "input-token" : null,
    usage.output_tokens > limits.max_output_tokens ? "output-token" : null,
    usage.elapsed_ms >= limits.max_elapsed_ms ? "elapsed-time" : null,
    usage.cost_microusd > limits.max_cost_microusd ? "model-cost" : null,
  ].filter(Boolean);
  return exhausted.length ? exhausted.join(", ") : null;
}

function nextBudgetBlock(state: P0AgentRunState, operation: "MODEL" | "TOOL") {
  const { limits, usage } = state.budget;
  if (usage.elapsed_ms >= limits.max_elapsed_ms) return "elapsed-time";
  if (usage.input_tokens >= limits.max_input_tokens) return "input-token";
  if (usage.output_tokens >= limits.max_output_tokens) return "output-token";
  if (usage.cost_microusd >= limits.max_cost_microusd) return "model-cost";
  if (operation === "MODEL" && usage.model_calls >= limits.max_model_calls) return "model-call";
  if (operation === "MODEL" && usage.tool_calls >= limits.max_tool_calls) return "tool-call";
  if (operation === "TOOL" && usage.tool_calls >= limits.max_tool_calls) return "tool-call";
  return null;
}

function assertBudgets(limits: P0AgentBudgetLimits) {
  const keys: Array<keyof P0AgentBudgetLimits> = [
    "max_model_calls",
    "max_tool_calls",
    "max_input_tokens",
    "max_output_tokens",
    "max_elapsed_ms",
    "max_cost_microusd",
  ];
  if (!limits || Object.keys(limits).length !== keys.length) {
    throw new P0AgentRuntimeError("P0_AGENT_BUDGET_INVALID", "Durable budget shape is invalid.");
  }
  for (const key of keys) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new P0AgentRuntimeError("P0_AGENT_BUDGET_INVALID", `${key} must be a positive safe integer.`);
    }
  }
}

function sameContractControlPlane(
  state: P0AgentRunState,
  contract: P0AgentApplicationContract,
) {
  return JSON.stringify(contract.objective) === JSON.stringify(state.objective)
    && JSON.stringify(contract.policy) === JSON.stringify(state.policy)
    && JSON.stringify(contract.tools) === JSON.stringify(state.tools);
}

export function sameP0AgentAuthorityIdentity(
  left: P0AgentApplicationContract["authority"],
  right: P0AgentApplicationContract["authority"],
) {
  return left.application_revision === right.application_revision
    && left.authority_digest === right.authority_digest
    && left.prior_outcomes_digest === right.prior_outcomes_digest;
}

function compactObservations(state: P0AgentRunState, nowValue: string) {
  const through = state.observations.at(-1)?.sequence ?? 0;
  const summary = state.observations
    .map((item) => {
      const sources = item.source_references.map((source) => source.locator).join(", ");
      return `#${item.sequence} [${item.trust}] ${item.tool_name}: ${item.summary}${sources ? ` Sources: ${sources}` : ""}`;
    })
    .join("\n")
    .slice(0, 12_000);
  state.compaction = {
    through_observation_sequence: through,
    summary,
    compacted_at: nowValue,
  };
}

export type P0AgentOwnerProjection = {
  status: "working" | "waiting" | "complete" | "blocked";
  progress: {
    completed: number;
    total: number;
    label: string;
  };
  card: {
    kind: "agent-activity" | "finding" | "problem" | "human-decision-gate";
    title: string;
    body: string;
  };
  nextBusinessStep: string;
};

export function projectP0AgentRunForOwner(state: Pick<P0AgentRunState, "status" | "stop_reason" | "observations" | "budget">): P0AgentOwnerProjection {
  const completed = Math.min(state.observations.length, 4);
  const total = Math.max(1, Math.min(4, completed + (state.status === "COMPLETED" ? 0 : 1)));
  const code = state.stop_reason?.code;
  if (["MATERIAL_DECISION_REQUIRED", "CRITICAL_DECISION_REQUIRED", "EXACT_WRITE_AUTHORITY_REQUIRED"].includes(code ?? "")) {
    return {
      status: "blocked",
      progress: { completed, total, label: "Безопасное исследование завершено до решения владельца" },
      card: {
        kind: "human-decision-gate",
        title: "Подготовлено существенное решение",
        body: "Агент собрал доступные факты и остановился только на границе бизнес-решения или полномочия.",
      },
      nextBusinessStep: "Рассмотреть подготовленную рекомендацию и её последствия.",
    };
  }
  if (state.status === "COMPLETED") {
    return {
      status: "complete",
      progress: { completed, total: Math.max(1, completed), label: "Текущий бизнес-вывод подготовлен" },
      card: {
        kind: "finding",
        title: "Агент подготовил следующий бизнес-шаг",
        body: "Вывод проверен trusted application и связан с текущим состоянием пути владельца.",
      },
      nextBusinessStep: "Продолжить по показанному бизнес-шагу.",
    };
  }
  if (state.stop_reason?.resumable) {
    return {
      status: "waiting",
      progress: { completed, total, label: "Безопасные источники проверяются" },
      card: {
        kind: "agent-activity",
        title: "Агент ожидает источник",
        body: "Очередь и повторное чтение продолжатся автоматически в пределах сохранённых ограничений.",
      },
      nextBusinessStep: "Агент продолжит после ответа источника.",
    };
  }
  if (state.status === "STOPPED") {
    return {
      status: "blocked",
      progress: { completed, total, label: "Работа безопасно остановлена" },
      card: {
        kind: "problem",
        title: "Агент обнаружил ограничение",
        body: "Продолжение остановлено без изменения бизнес-истины или полномочий.",
      },
      nextBusinessStep: "Проверить показанную бизнес-проблему.",
    };
  }
  return {
    status: "working",
    progress: { completed, total, label: "Агент продолжает разрешённое исследование" },
    card: {
      kind: "agent-activity",
      title: "Агент продолжает исследование",
      body: "Разрешённые безопасные чтения выполняются автоматически.",
    },
    nextBusinessStep: "Дождаться следующего бизнес-вывода.",
  };
}

export class P0AgentRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "P0AgentRuntimeError";
    this.code = code;
  }
}

export class P0AgentRuntime {
  private readonly application: P0AgentApplicationAuthority;
  private readonly model: P0ModelAdapter;
  private readonly store: P0AgentRunStore;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor({
    application,
    model,
    store,
    now = () => new Date().toISOString(),
    createId = () => crypto.randomUUID(),
  }: {
    application: P0AgentApplicationAuthority;
    model: P0ModelAdapter;
    store: P0AgentRunStore;
    now?: () => string;
    createId?: () => string;
  }) {
    this.application = application;
    this.model = model;
    this.store = store;
    this.now = now;
    this.createId = createId;
  }

  private async save(state: P0AgentRunState) {
    const expectedVersion = state.version;
    const nowValue = this.now();
    recomputeBudget(state);
    state.updated_at = nowValue;
    state.version += 1;
    if (!await this.store.compareAndSwap(state.run_id, expectedVersion, state)) {
      state.version = expectedVersion;
      throw new P0AgentRuntimeError("P0_AGENT_RUN_CONFLICT", "Agent run changed concurrently.");
    }
  }

  private async stop(state: P0AgentRunState, reason: P0AgentStopReason) {
    state.status = reason.code === "COMPLETED" ? "COMPLETED" : "STOPPED";
    state.stop_reason = clone(reason);
    state.checkpoints.push(checkpoint(state, "STOP", this.now()));
    await this.save(state);
    return clone(state);
  }

  private async evaluate(state: P0AgentRunState) {
    const startedAt = this.now();
    const result = await this.application.evaluate({
      owner_key: state.owner_key,
      run_id: state.run_id,
      objective: clone(state.objective),
      authority: clone(state.authority),
      observation_count: state.observations.length,
      last_observation: clone(state.observations.at(-1) ?? null),
    });
    state.budget.usage.elapsed_ms += elapsedBetween(startedAt, this.now());
    if (result.status === "STOP") return this.stop(state, result.stop_reason);
    return null;
  }

  private modelRequest(state: P0AgentRunState): P0ModelTurnRequest {
    const compactedThrough = state.compaction?.through_observation_sequence ?? 0;
    return {
      contract: clone(state.contract),
      run_id: state.run_id,
      objective: clone(state.objective),
      policy: clone(state.policy),
      authority: clone(state.authority),
      tools: clone(state.tools),
      checkpoint: {
        sequence: state.checkpoints.length,
        compacted_summary: state.compaction?.summary ?? null,
      },
      observations: clone(state.observations.filter((item) => item.sequence > compactedThrough).slice(-12)),
      budget: clone(state.budget),
    };
  }

  private async refreshAuthority(state: P0AgentRunState) {
    let contract: P0AgentApplicationContract;
    const startedAt = this.now();
    try {
      contract = await this.application.contract(state.owner_key, state.objective.kind);
      assertApplicationContract(contract, state.objective.kind);
      assertFresh(contract, this.now());
    } catch (error) {
      state.budget.usage.elapsed_ms += elapsedBetween(startedAt, this.now());
      return this.stop(state, stopReason(
        "RESUME_PRECONDITION_FAILED",
        error instanceof Error ? error.message : "Application authority could not be refreshed.",
      ));
    }
    state.budget.usage.elapsed_ms += elapsedBetween(startedAt, this.now());
    if (!sameContractControlPlane(state, contract) || !sameP0AgentAuthorityIdentity(state.authority, contract.authority)) {
      return this.stop(state, stopReason(
        "RESUME_PRECONDITION_FAILED",
        "Application revision, authority, policy, objective, prior outcomes, or tool permissions changed.",
      ));
    }
    state.authority = clone(contract.authority);
    return null;
  }

  private async drive(state: P0AgentRunState): Promise<P0AgentRunState> {
    while (true) {
      const refreshStop = await this.refreshAuthority(state);
      if (refreshStop) return refreshStop;
      const authoritativeStop = await this.evaluate(state);
      if (authoritativeStop) return authoritativeStop;

      recomputeBudget(state);
      const modelBudgetBlock = nextBudgetBlock(state, "MODEL");
      if (modelBudgetBlock) {
        return this.stop(state, stopReason(
          "BUDGET_EXHAUSTED",
          `The durable ${modelBudgetBlock} budget has no capacity for another model turn.`,
        ));
      }

      state.budget.usage.model_calls += 1;
      state.checkpoints.push(checkpoint(state, "MODEL_CALL_INTENT", this.now()));
      await this.save(state);

      let turn: P0ModelTurnResponse;
      const modelStartedAt = this.now();
      try {
        turn = await this.model.turn(this.modelRequest(state));
      } catch (error) {
        const failedAt = this.now();
        state.budget.usage.elapsed_ms += elapsedBetween(modelStartedAt, failedAt);
        return this.stop(state, stopReason(
          "TEMPORARY_PROVIDER_FAILURE",
          error instanceof Error ? error.message : "The neural model provider is temporarily unavailable.",
          true,
          new Date(Date.parse(failedAt) + 30_000).toISOString(),
        ));
      }
      const modelFinishedAt = this.now();
      state.budget.usage.elapsed_ms += elapsedBetween(modelStartedAt, modelFinishedAt);
      const inputTokens = Number(turn.usage?.input_tokens ?? 0);
      const outputTokens = Number(turn.usage?.output_tokens ?? 0);
      const costMicrousd = Number(turn.usage?.cost_microusd ?? 0);
      state.budget.usage.input_tokens += Number.isFinite(inputTokens) ? Math.max(0, Math.trunc(inputTokens)) : 0;
      state.budget.usage.output_tokens += Number.isFinite(outputTokens) ? Math.max(0, Math.trunc(outputTokens)) : 0;
      state.budget.usage.cost_microusd += Number.isFinite(costMicrousd) ? Math.max(0, Math.trunc(costMicrousd)) : 0;
      recomputeBudget(state);
      state.checkpoints.push(checkpoint(state, "MODEL_TURN", this.now()));
      await this.save(state);

      const exhaustedAfterModel = exceededTokenOrTimeBudget(state);
      if (exhaustedAfterModel) {
        return this.stop(state, stopReason(
          "BUDGET_EXHAUSTED",
          `The durable ${exhaustedAfterModel} budget was exhausted before tool execution.`,
        ));
      }

      if (turn.kind !== "TOOL_CALLS" || turn.calls.length !== 1) {
        return this.stop(state, stopReason(
          "POLICY_SAFETY_BLOCKED",
          "The model did not return exactly one application-authorized typed tool call.",
        ));
      }
      const call = turn.calls[0];
      const definition = state.tools.find((tool) => tool.name === call.name);
      if (!definition || !state.policy.allowed_tools.includes(call.name)) {
        return this.stop(state, stopReason(
          "POLICY_SAFETY_BLOCKED",
          `Tool ${call.name || "<missing>"} is not exposed by the trusted P0 application.`,
        ));
      }
      if (!validateArguments(call, definition)) {
        return this.stop(state, stopReason(
          "POLICY_SAFETY_BLOCKED",
          `Tool ${call.name} arguments do not match its closed schema.`,
        ));
      }
      recomputeBudget(state);
      const toolBudgetBlock = nextBudgetBlock(state, "TOOL");
      if (toolBudgetBlock) {
        return this.stop(state, stopReason(
          "BUDGET_EXHAUSTED",
          `The durable ${toolBudgetBlock} budget has no capacity for another tool call.`,
        ));
      }

      const nextSequence = state.observations.length + 1;
      let toolResult: Awaited<ReturnType<P0AgentApplicationAuthority["executeTool"]>>;
      const toolStartedAt = this.now();
      try {
        toolResult = await this.application.executeTool({
          owner_key: state.owner_key,
          run_id: state.run_id,
          objective: clone(state.objective),
          authority: clone(state.authority),
          call: clone(call),
          observation_sequence: nextSequence,
        });
      } catch (error) {
        const failedAt = this.now();
        state.budget.usage.elapsed_ms += elapsedBetween(toolStartedAt, failedAt);
        return this.stop(state, stopReason(
          "REPEATED_SAFE_READ_FAILURE",
          error instanceof Error ? error.message : "The trusted P0 tool failed.",
          true,
          new Date(Date.parse(failedAt) + 30_000).toISOString(),
        ));
      }
      state.budget.usage.elapsed_ms += elapsedBetween(toolStartedAt, this.now());
      try {
        assertApplicationContract(toolResult.contract, state.objective.kind);
        assertFresh(toolResult.contract, this.now());
        assertObservation(toolResult.observation, call, nextSequence, toolResult.contract);
      } catch (error) {
        return this.stop(state, stopReason(
          "POLICY_SAFETY_BLOCKED",
          error instanceof Error ? error.message : "Trusted tool output validation failed.",
        ));
      }
      if (!sameContractControlPlane(state, toolResult.contract)) {
        return this.stop(state, stopReason(
          "POLICY_SAFETY_BLOCKED",
          "Tool output attempted to alter the objective, trusted policy, or tool permissions.",
        ));
      }
      state.authority = clone(toolResult.contract.authority);
      state.tools = clone(toolResult.contract.tools);
      state.observations.push(clone(toolResult.observation));
      state.budget.usage.tool_calls += 1;
      recomputeBudget(state);
      state.checkpoints.push(checkpoint(state, "TOOL_OBSERVATION", this.now()));
      await this.save(state);
    }
  }

  async coordinate({
    owner_key: ownerKey,
    budgets = DEFAULT_BUDGETS,
  }: {
    owner_key: string;
    budgets?: P0AgentBudgetLimits;
  }) {
    requireText(ownerKey, "Agent owner key", 500);
    assertBudgets(budgets);
    const concurrentWinner = async (error: unknown, runId?: string) => {
      if (!(error instanceof P0AgentRuntimeError) || error.code !== "P0_AGENT_RUN_CONFLICT") throw error;
      const winner = (runId ? await this.store.load(runId) : null)
        ?? await this.store.loadCurrent?.(ownerKey)
        ?? null;
      if (!winner || winner.owner_key !== ownerKey || winner.objective.kind !== "COORDINATE_OWNER_JOURNEY") throw error;
      return clone(winner);
    };
    const startCurrent = async () => {
      const contract = await this.application.contract(ownerKey, "COORDINATE_OWNER_JOURNEY");
      assertApplicationContract(contract, "COORDINATE_OWNER_JOURNEY");
      const runId = await coordinatorRunId(ownerKey, contract);
      try {
        return await this.start({
          owner_key: ownerKey,
          objective_kind: "COORDINATE_OWNER_JOURNEY",
          budgets,
          run_id: runId,
        });
      } catch (error) {
        return concurrentWinner(error, runId);
      }
    };
    const current = await this.store.loadCurrent?.(ownerKey) ?? null;
    if (!current || current.schema_version !== P0_AGENT_RUN_SCHEMA
      || current.objective.kind !== "COORDINATE_OWNER_JOURNEY") {
      return startCurrent();
    }

    if (current.status === "COMPLETED" || current.stop_reason?.resumable === false) {
      const latest = await this.application.contract(ownerKey, "COORDINATE_OWNER_JOURNEY");
      assertApplicationContract(latest, "COORDINATE_OWNER_JOURNEY");
      if (sameContractControlPlane(current, latest) && sameP0AgentAuthorityIdentity(current.authority, latest.authority)) {
        return clone(current);
      }
      return startCurrent();
    }

    const resumeAt = current.stop_reason?.resume_at;
    if (resumeAt && Date.parse(resumeAt) > Date.parse(this.now())) return clone(current);
    const compact = current.observations.length > (current.compaction?.through_observation_sequence ?? 0);
    let resumed: P0AgentRunState;
    try {
      resumed = await this.resume({ owner_key: ownerKey, run_id: current.run_id, compact });
    } catch (error) {
      return concurrentWinner(error, current.run_id);
    }
    if (resumed.stop_reason?.code !== "RESUME_PRECONDITION_FAILED") return resumed;
    return startCurrent();
  }

  async start({
    owner_key: ownerKey,
    objective_kind: objectiveKind,
    budgets = DEFAULT_BUDGETS,
    run_id: requestedRunId,
  }: {
    owner_key: string;
    objective_kind: P0AgentObjectiveKind;
    budgets?: P0AgentBudgetLimits;
    run_id?: string;
  }) {
    requireText(ownerKey, "Agent owner key", 500);
    assertBudgets(budgets);
    const contract = await this.application.contract(ownerKey, objectiveKind);
    assertApplicationContract(contract, objectiveKind);
    const timestamp = this.now();
    assertFresh(contract, timestamp);
    const runId = requestedRunId ?? this.createId();
    requireText(runId, "Agent run ID", 500);
    const state: P0AgentRunState = {
      schema_version: P0_AGENT_RUN_SCHEMA,
      contract: { name: P0_AGENT_RUNTIME_CONTRACT, version: P0_AGENT_RUNTIME_VERSION },
      run_id: runId,
      version: 0,
      owner_key: ownerKey,
      objective: clone(contract.objective),
      policy: clone(contract.policy),
      authority: clone(contract.authority),
      tools: clone(contract.tools),
      model_adapter_id: this.model.adapter_id,
      status: "RUNNING",
      stop_reason: null,
      budget: budgetState(budgets),
      checkpoints: [],
      observations: [],
      compaction: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    state.checkpoints.push(checkpoint(state, "START", timestamp));
    if (!await this.store.initialize(state)) {
      throw new P0AgentRuntimeError("P0_AGENT_RUN_CONFLICT", "Agent run ID already exists.");
    }
    return this.drive(state);
  }

  async resume({
    owner_key: ownerKey,
    run_id: runId,
    compact = false,
  }: {
    owner_key: string;
    run_id: string;
    compact?: boolean;
  }) {
    requireText(ownerKey, "Agent owner key", 500);
    requireText(runId, "Agent run ID", 500);
    const state = await this.store.load(runId);
    if (!state || state.schema_version !== P0_AGENT_RUN_SCHEMA) {
      throw new P0AgentRuntimeError("P0_AGENT_RUN_NOT_FOUND", "Durable agent run was not found.");
    }
    if (state.owner_key !== ownerKey) {
      throw new P0AgentRuntimeError("P0_AGENT_RUN_NOT_FOUND", "Durable agent run was not found.");
    }
    if (state.status === "COMPLETED" || state.stop_reason?.resumable === false) return clone(state);
    if (state.model_adapter_id !== this.model.adapter_id) {
      return this.stop(state, stopReason(
        "RESUME_PRECONDITION_FAILED",
        "The configured model adapter differs from the durable run adapter.",
      ));
    }

    const refreshStop = await this.refreshAuthority(state);
    if (refreshStop) return refreshStop;
    recomputeBudget(state);
    const budgetBlock = nextBudgetBlock(state, "MODEL");
    if (budgetBlock) {
      return this.stop(state, stopReason(
        "BUDGET_EXHAUSTED",
        `The durable ${budgetBlock} budget has no capacity for restart.`,
      ));
    }
    if (compact) {
      compactObservations(state, this.now());
      state.checkpoints.push(checkpoint(state, "COMPACTION", this.now()));
      await this.save(state);
    }
    state.status = "RUNNING";
    state.stop_reason = null;
    await this.save(state);
    return this.drive(state);
  }
}
