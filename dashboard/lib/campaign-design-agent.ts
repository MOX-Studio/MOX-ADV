import type { AutonomousCampaignStrategy } from "./campaign-strategy-agent.ts";
import {
  compileDirectProjection,
  DirectProjectionCompilationError,
  type DirectFieldApplicabilityProof,
  type DirectProjectionCompilerInput,
  type DirectProjectionViolation,
} from "./direct-projection-compiler.ts";
import type { DirectCapabilitySnapshot } from "./campaign-fanout.ts";
import type { DirectProjection } from "./direct-write.ts";

export const CAMPAIGN_DESIGN_AGENT_CONTRACT = "mox-adv.p0.campaign-design-agent";
export const CAMPAIGN_DESIGN_AGENT_VERSION = "1.0.0";
export const CAMPAIGN_HYPOTHESIS_SCHEMA = "p0-campaign-hypothesis-v1";
export const COMPILED_CAMPAIGN_PAIR_SCHEMA = "p0-compiled-campaign-pair-v1";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;
const FORBIDDEN_FORECAST_KEY = /^(?:forecast_(?:clicks|conversions|cpa|profit|efficiency)|predicted_(?:clicks|conversions|cpa|profit|efficiency)|expected_(?:clicks|conversions|cpa|profit|efficiency)|(?:click|conversion|cpa|profit|efficiency)_forecast)$/iu;

export type CampaignHypothesis = {
  schema_version: typeof CAMPAIGN_HYPOTHESIS_SCHEMA;
  hypothesis_revision_id: string;
  strategy_revision_id: string;
  analytics_evidence_snapshot_id: string;
  mechanism: string;
  primary_metric: string;
  baseline: string;
  evidence_refs: string[];
  authority: {
    publication: "NOT_AUTHORIZED";
    spend: "NOT_AUTHORIZED";
    performance_promise: false;
  };
};

export type CampaignDesignCandidate = {
  hypothesis: CampaignHypothesis;
  projection: DirectProjection;
};

export type CampaignDesignEvidenceRequest = {
  kind: "EVIDENCE_REQUEST";
  requests: Array<{ code: string; description: string }>;
};

export type CampaignDesignStrategyDefect = {
  kind: "STRATEGY_DEFECT";
  defects: Array<{ code: string; description: string }>;
};

export type CampaignDesignModelResult =
  | { kind: "CANDIDATE"; candidate: CampaignDesignCandidate }
  | CampaignDesignEvidenceRequest
  | CampaignDesignStrategyDefect;

export type CampaignDesignViolation = DirectProjectionViolation & {
  source: "CAMPAIGN_DESIGN_AGENT" | "DIRECT_COMPILER";
};

export type CampaignDesignRequest = {
  contract: { name: typeof CAMPAIGN_DESIGN_AGENT_CONTRACT; version: typeof CAMPAIGN_DESIGN_AGENT_VERSION };
  attempt: 1 | 2;
  strategy: AutonomousCampaignStrategy;
  analytics_evidence: {
    snapshot_id: string;
    evidence_ids: string[];
  };
  confirmed_cost: { status: "AVAILABLE" | "UNAVAILABLE"; evidence_ref: string | null };
  violations: CampaignDesignViolation[];
  authority: {
    external_read: false;
    persistence: false;
    publication: false;
    spend: false;
  };
};

export interface CampaignDesignModel {
  readonly model_id: string;
  designCampaignPair(request: Readonly<CampaignDesignRequest>): Promise<CampaignDesignModelResult>;
}

export type CompiledCampaignPair = {
  schema_version: typeof COMPILED_CAMPAIGN_PAIR_SCHEMA;
  pair_revision_id: string;
  hypothesis: CampaignHypothesis;
  draft: Awaited<ReturnType<typeof compileDirectProjection>>;
  strategy_revision_id: string;
  analytics_evidence_snapshot_id: string;
  design: {
    model_id: string;
    attempts: 1 | 2;
    repair_violations: CampaignDesignViolation[];
  };
  economics: {
    confirmed_cost_status: "AVAILABLE" | "UNAVAILABLE";
    budget_limited: true;
    weekly_budget: number;
    effectiveness_forecast: false;
  };
};

export interface PipelineCampaignPairStore {
  saveCurrentCampaignPair(pair: Readonly<CompiledCampaignPair>): Promise<void>;
}

export type CampaignDesignPipelineResult =
  | { status: "COMPLETED"; pair: Readonly<CompiledCampaignPair> }
  | { status: "EVIDENCE_REQUEST"; evidence_request: CampaignDesignEvidenceRequest }
  | { status: "STRATEGY_DEFECT"; strategy_defect: CampaignDesignStrategyDefect }
  | { status: "TECHNICAL_FAILURE"; violations: CampaignDesignViolation[] };

export class CampaignDesignPipelineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CampaignDesignPipelineError";
    this.code = code;
  }
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

function exactKeys(value: object, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function strategyDimension(strategy: AutonomousCampaignStrategy, dimensionId: string) {
  return strategy.dimensions.find((dimension) => dimension.dimension_id === dimensionId)?.value;
}

function strategyDefect(strategy: AutonomousCampaignStrategy): CampaignDesignStrategyDefect | null {
  const required = [
    "business_goal", "campaign_focus", "advertised_offer", "target_audience", "qualified_result",
    "exclusions", "geography", "period", "landing_page", "weekly_budget", "core_message",
  ];
  const missing = required.filter((dimensionId) => {
    const value = strategyDimension(strategy, dimensionId);
    return value === null || value === undefined || (typeof value === "string" && !value.trim());
  });
  const budget = strategyDimension(strategy, "weekly_budget");
  if (!Number.isSafeInteger(budget) || Number(budget) <= 0) missing.push("weekly_budget");
  if (!text(strategy.strategy_revision_id) || strategy.status !== "AGENT_ACCEPTED") missing.push("strategy_revision_id");
  if (!missing.length) return null;
  return {
    kind: "STRATEGY_DEFECT",
    defects: [{ code: "STRATEGY_INCOMPLETE", description: `Campaign Strategy is missing valid fields: ${[...new Set(missing)].join(", ")}.` }],
  };
}

function validateIssueResult(result: CampaignDesignEvidenceRequest | CampaignDesignStrategyDefect) {
  const items = result.kind === "EVIDENCE_REQUEST" ? result.requests : result.defects;
  if (!Array.isArray(items) || items.length === 0 || items.some((item) => !item || !IDENTIFIER.test(String(item.code)) || !text(item.description))) {
    throw new CampaignDesignPipelineError("CAMPAIGN_DESIGN_RESULT_INVALID", "Campaign Design Agent returned an invalid typed issue package.");
  }
}

function forbiddenForecastPointers(value: unknown, pointer = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenForecastPointers(item, `${pointer}/${index}`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
    ...(FORBIDDEN_FORECAST_KEY.test(key) ? [`${pointer}/${key}`] : []),
    ...forbiddenForecastPointers(item, `${pointer}/${key}`),
  ]);
}

function validateCandidate(
  candidate: CampaignDesignCandidate,
  request: CampaignDesignRequest,
): CampaignDesignViolation[] {
  const violations: CampaignDesignViolation[] = [];
  const hypothesis = record(candidate?.hypothesis);
  if (!exactKeys(hypothesis, [
    "schema_version", "hypothesis_revision_id", "strategy_revision_id", "analytics_evidence_snapshot_id",
    "mechanism", "primary_metric", "baseline", "evidence_refs", "authority",
  ]) || hypothesis.schema_version !== CAMPAIGN_HYPOTHESIS_SCHEMA
    || !IDENTIFIER.test(String(hypothesis.hypothesis_revision_id))
    || hypothesis.strategy_revision_id !== request.strategy.strategy_revision_id
    || hypothesis.analytics_evidence_snapshot_id !== request.analytics_evidence.snapshot_id
    || !text(hypothesis.mechanism) || !text(hypothesis.primary_metric) || !text(hypothesis.baseline)
    || !Array.isArray(hypothesis.evidence_refs) || hypothesis.evidence_refs.length === 0
    || hypothesis.evidence_refs.some((reference) => !request.analytics_evidence.evidence_ids.includes(String(reference)))
    || new Set(hypothesis.evidence_refs).size !== hypothesis.evidence_refs.length
    || !exactKeys(record(hypothesis.authority), ["publication", "spend", "performance_promise"])
    || record(hypothesis.authority).publication !== "NOT_AUTHORIZED"
    || record(hypothesis.authority).spend !== "NOT_AUTHORIZED"
    || record(hypothesis.authority).performance_promise !== false) {
    violations.push({
      source: "CAMPAIGN_DESIGN_AGENT",
      code: "HYPOTHESIS_INVALID",
      pointer: "/hypothesis",
      message: "Campaign Hypothesis must be complete, evidence-linked, Strategy-bound and non-authorizing.",
    });
  }
  const lineage = record(record(candidate?.projection).lineage);
  if (lineage.strategy_revision_id !== request.strategy.strategy_revision_id
    || lineage.campaign_hypothesis_revision_id !== hypothesis.hypothesis_revision_id) {
    violations.push({
      source: "CAMPAIGN_DESIGN_AGENT",
      code: "PAIR_LINEAGE_INVALID",
      pointer: "/projection/lineage",
      message: "Campaign Draft must identify the exact Strategy and Campaign Hypothesis revisions.",
    });
  }
  if (request.confirmed_cost.status === "UNAVAILABLE") {
    const expectedBudgetMicros = Number(strategyDimension(request.strategy, "weekly_budget")) * 1_000_000;
    const campaign = record(record(candidate?.projection).direct).campaign;
    const bidding = record(record(record(campaign).UnifiedCampaign).BiddingStrategy);
    const search = record(bidding.Search);
    const clicks = record(search.WbMaximumClicks);
    if (search.BiddingStrategyType !== "WB_MAXIMUM_CLICKS"
      || Number(clicks.WeeklySpendLimit) !== expectedBudgetMicros) {
      violations.push({
        source: "CAMPAIGN_DESIGN_AGENT",
        code: "BUDGET_FALLBACK_INVALID",
        pointer: "/projection/direct/campaign/UnifiedCampaign/BiddingStrategy/Search",
        message: "Unavailable confirmed cost requires the Strategy-bounded WB_MAXIMUM_CLICKS fallback.",
      });
    }
    for (const pointer of forbiddenForecastPointers(candidate)) violations.push({
      source: "CAMPAIGN_DESIGN_AGENT",
      code: "UNSUPPORTED_EFFECTIVENESS_FORECAST",
      pointer,
      message: "The budget fallback cannot contain click, conversion, CPA, profit or effectiveness forecasts.",
    });
  }
  return violations;
}

async function compileCandidate(
  candidate: CampaignDesignCandidate,
  request: CampaignDesignRequest,
  compilerInput: Omit<DirectProjectionCompilerInput, "projection">,
) {
  const violations = validateCandidate(candidate, request);
  try {
    const draft = await compileDirectProjection({ ...compilerInput, projection: candidate.projection });
    return { draft, violations };
  } catch (error) {
    if (!(error instanceof DirectProjectionCompilationError)) throw error;
    violations.push(...error.violations.map((item) => ({ ...item, source: "DIRECT_COMPILER" as const })));
    return { draft: null, violations };
  }
}

async function digest(value: unknown) {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(result)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

export async function runCampaignDesignPipeline(input: {
  strategy: AutonomousCampaignStrategy;
  analytics_evidence: { snapshot_id: string; evidence_ids: string[] };
  confirmed_cost: { status: "AVAILABLE" | "UNAVAILABLE"; evidence_ref: string | null };
  capability_snapshot: DirectCapabilitySnapshot;
  allowed_landing_hosts: string[];
  applicability_proofs: DirectFieldApplicabilityProof[];
  model: CampaignDesignModel;
  store: PipelineCampaignPairStore;
}): Promise<CampaignDesignPipelineResult> {
  const defect = strategyDefect(input.strategy);
  if (defect) return { status: "STRATEGY_DEFECT", strategy_defect: defect };
  if (!text(input.analytics_evidence.snapshot_id) || input.analytics_evidence.evidence_ids.length === 0) {
    return {
      status: "EVIDENCE_REQUEST",
      evidence_request: { kind: "EVIDENCE_REQUEST", requests: [{ code: "HYPOTHESIS_EVIDENCE_REQUIRED", description: "Campaign Hypothesis requires at least one exact evidence reference." }] },
    };
  }
  if (!input.model || !text(input.model.model_id)) throw new CampaignDesignPipelineError("CAMPAIGN_DESIGN_MODEL_INVALID", "Campaign Design Agent identity is required.");

  const immutable = clone({
    strategy: input.strategy,
    analytics_evidence: input.analytics_evidence,
    confirmed_cost: input.confirmed_cost,
    capability_snapshot: input.capability_snapshot,
    allowed_landing_hosts: input.allowed_landing_hosts,
    applicability_proofs: input.applicability_proofs,
  });
  const compilerInput = {
    capability_snapshot: immutable.capability_snapshot,
    allowed_landing_hosts: immutable.allowed_landing_hosts,
    applicability_proofs: immutable.applicability_proofs,
  };
  let repairViolations: CampaignDesignViolation[] = [];
  for (const attempt of [1, 2] as const) {
    const request = deepFreeze({
      contract: { name: CAMPAIGN_DESIGN_AGENT_CONTRACT, version: CAMPAIGN_DESIGN_AGENT_VERSION },
      attempt,
      strategy: immutable.strategy,
      analytics_evidence: immutable.analytics_evidence,
      confirmed_cost: immutable.confirmed_cost,
      violations: clone(repairViolations),
      authority: { external_read: false, persistence: false, publication: false, spend: false },
    } satisfies CampaignDesignRequest);
    const result = clone(await input.model.designCampaignPair(request));
    if (result.kind === "EVIDENCE_REQUEST") {
      validateIssueResult(result);
      return { status: "EVIDENCE_REQUEST", evidence_request: result };
    }
    if (result.kind === "STRATEGY_DEFECT") {
      validateIssueResult(result);
      return { status: "STRATEGY_DEFECT", strategy_defect: result };
    }
    if (result.kind !== "CANDIDATE" || !result.candidate) throw new CampaignDesignPipelineError("CAMPAIGN_DESIGN_RESULT_INVALID", "Campaign Design Agent result does not match the closed contract.");
    const compiled = await compileCandidate(result.candidate, request, compilerInput);
    if (compiled.draft && compiled.violations.length === 0) {
      const identity = {
        hypothesis: result.candidate.hypothesis,
        publish_fingerprint: compiled.draft.publish_fingerprint,
        strategy_revision_id: immutable.strategy.strategy_revision_id,
        analytics_evidence_snapshot_id: immutable.analytics_evidence.snapshot_id,
      };
      const pair: CompiledCampaignPair = {
        schema_version: COMPILED_CAMPAIGN_PAIR_SCHEMA,
        pair_revision_id: `campaign-pair:${(await digest(identity)).slice(7, 31)}`,
        hypothesis: result.candidate.hypothesis,
        draft: compiled.draft,
        strategy_revision_id: immutable.strategy.strategy_revision_id,
        analytics_evidence_snapshot_id: immutable.analytics_evidence.snapshot_id,
        design: { model_id: input.model.model_id, attempts: attempt, repair_violations: clone(repairViolations) },
        economics: {
          confirmed_cost_status: immutable.confirmed_cost.status,
          budget_limited: true,
          weekly_budget: Number(strategyDimension(immutable.strategy, "weekly_budget")),
          effectiveness_forecast: false,
        },
      };
      const frozen = deepFreeze(pair);
      await input.store.saveCurrentCampaignPair(frozen);
      return { status: "COMPLETED", pair: frozen };
    }
    repairViolations = compiled.violations;
  }
  return { status: "TECHNICAL_FAILURE", violations: repairViolations };
}
