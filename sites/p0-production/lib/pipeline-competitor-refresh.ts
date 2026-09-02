import type { CompetitorCandidateSet } from "./competitor-research.ts";
import type { BusinessModel, SiteAnalysis } from "./p0-application.ts";
import {
  type PipelineCurrentProducts,
  type PipelineCurrentProductStore,
  type PipelineJsonRecord,
} from "./pipeline-current-products.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";

export const PIPELINE_COMPETITOR_EVIDENCE_REFRESH_SCHEMA = "p0-pipeline-competitor-evidence-refresh-v1";
const DEFAULT_COMPETITOR_COLLECTION_TIMEOUT_MS = 60_000;
const DEFAULT_COMPETITOR_ANALYST_TIMEOUT_MS = 90_000;

export class PipelineCompetitorRefreshTimeoutError extends Error {
  readonly code: "COMPETITOR_COLLECTION_TIMEOUT" | "COMPETITOR_ANALYST_TIMEOUT";

  constructor(code: PipelineCompetitorRefreshTimeoutError["code"], message: string) {
    super(message);
    this.name = "PipelineCompetitorRefreshTimeoutError";
    this.code = code;
  }
}

export type PipelineCompetitorCollectorInput = {
  ownerKey: string;
  model: Pick<BusinessModel, "product" | "audience" | "value" | "qualified_result" | "exclusions" | "geography" | "offer_candidates">;
  site: Pick<SiteAnalysis, "url" | "title" | "description" | "text_excerpt">;
  candidateSet: CompetitorCandidateSet | null;
  generatedAt: string;
};

export type PipelineCompetitorCollection = {
  evidencePackId: string;
  competitorMatrix: PipelineJsonRecord;
  competitorObservations: PipelineJsonRecord[];
  financialCompetitorIntelligence: PipelineJsonRecord;
};

export type PipelineCompetitiveRelation = "DIRECT_COMPETITOR" | "SUBSTITUTE_COMPETITOR" | "NOT_COMPETITOR" | "UNAVAILABLE";

export type PipelineCompetitorAssessment = {
  schema_version: "p0-pipeline-competitor-assessment-v1";
  analyst: { actor_id: string; actor_type: "AGENT"; role: "EVIDENCE_ANALYST"; model_id: string };
  objective: string;
  relations: Array<{
    competitor: string;
    relation: PipelineCompetitiveRelation;
    evidence_url: string | null;
    rationale: string;
  }>;
  summary: string;
  authority: {
    external_write: "DENIED";
    publication: "NOT_AUTHORIZED";
    impressions: 0;
    spend_micros: 0;
  };
};

export type PipelineCompetitorEvidenceCollector = (
  input: PipelineCompetitorCollectorInput,
) => Promise<PipelineCompetitorCollection | null>;

export type PipelineCompetitorEvidenceAnalyst = (input: {
  collection: PipelineCompetitorCollection;
  businessGoal: { desiredOutcome: string; qualifiedAction: string };
}) => Promise<PipelineCompetitorAssessment>;

export type PipelineCompetitorEvidenceRefresh = {
  schema_version: typeof PIPELINE_COMPETITOR_EVIDENCE_REFRESH_SCHEMA;
  revision_id: string;
  refreshed_at: string;
  source_snapshot_id: string;
  evidence_pack_id: string;
  competitor_matrix: PipelineJsonRecord;
  competitor_observations: PipelineJsonRecord[];
  financial_competitor_intelligence: PipelineJsonRecord;
  competitor_assessment: PipelineCompetitorAssessment;
  authority: {
    external_write: "DENIED";
    publication: "NOT_AUTHORIZED";
    impressions: 0;
    spend_micros: 0;
  };
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function boundedTimeout(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 180_000) {
    throw new Error("Competitor refresh timeout must be between 1 and 180000 milliseconds.");
  }
  return parsed;
}

async function withinDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  code: PipelineCompetitorRefreshTimeoutError["code"],
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new PipelineCompetitorRefreshTimeoutError(
          code,
          `${label} не завершён за ${timeoutMs} мс; поздний результат отброшен без сохранения.`,
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function strategyArtifact(current: PipelineCurrentProducts) {
  const product = record(current.campaign_strategy);
  return record(product.strategy ?? product);
}

function strategyDimension(current: PipelineCurrentProducts, id: string) {
  const dimension = list(strategyArtifact(current).dimensions)
    .map(record)
    .find((item) => text(item.dimension_id) === id);
  return text(dimension?.value);
}

function projectionAt(value: unknown, pointer: string): unknown {
  return pointer.split("/").filter(Boolean).reduce<unknown>((current, segment) => {
    const container = record(current);
    return container[segment];
  }, value);
}

function landingUrl(current: PipelineCurrentProducts) {
  for (const pairValue of current.campaign_pairs) {
    const pair = record(pairValue);
    const draft = record(pair.draft ?? pair);
    const candidate = text(projectionAt(draft.publish_projection, "/direct/ad/ResponsiveAd/Href"));
    if (/^https:\/\//u.test(candidate)) return candidate;
  }
  return "https://expo.innoprom.com/";
}

function assessedCompetitorMatrix(
  collection: PipelineCompetitorCollection,
  assessment: PipelineCompetitorAssessment,
) {
  const matrix = structuredClone(collection.competitorMatrix);
  const candidateSet = record(matrix.candidate_set);
  const candidates = list(candidateSet.candidates).map(record);
  const rows = list(matrix.rows).map(record);
  const candidateNames = candidates.map((candidate) => text(candidate.competitor));
  const observedUrls = new Map(rows.map((row) => [text(row.competitor), text(row.exact_landing)]));
  if (assessment.schema_version !== "p0-pipeline-competitor-assessment-v1"
    || assessment.analyst.actor_type !== "AGENT"
    || assessment.analyst.role !== "EVIDENCE_ANALYST"
    || assessment.relations.length !== candidateNames.length) {
    throw new Error("Evidence Analyst вернул неполную классификацию конкурентного набора.");
  }
  const relations = new Map<string, PipelineCompetitorAssessment["relations"][number]>();
  for (const relation of assessment.relations) {
    const name = text(relation.competitor);
    if (!candidateNames.includes(name) || relations.has(name)) {
      throw new Error("Evidence Analyst изменил точный состав конкурентного набора.");
    }
    const observedUrl = observedUrls.get(name) ?? "";
    if (relation.relation === "UNAVAILABLE") {
      if (observedUrl || relation.evidence_url !== null) throw new Error("Недоступное предложение не может ссылаться на наблюдённую страницу.");
    } else {
      if (!observedUrl || text(relation.evidence_url) !== observedUrl) {
        throw new Error("Evidence Analyst сослался на страницу вне текущего публичного наблюдения.");
      }
    }
    relations.set(name, structuredClone(relation));
  }
  if (candidateNames.some((name) => !relations.has(name))) {
    throw new Error("Evidence Analyst пропустил кандидата конкурентного набора.");
  }
  const included = new Set([...relations.values()]
    .filter((item) => item.relation === "DIRECT_COMPETITOR" || item.relation === "SUBSTITUTE_COMPETITOR")
    .map((item) => text(item.competitor)));
  candidateSet.candidates = candidates.filter((candidate) => included.has(text(candidate.competitor)));
  matrix.candidate_set = candidateSet;
  matrix.rows = rows.filter((row) => included.has(text(row.competitor)));
  matrix.status = list(matrix.rows).length === list(candidateSet.candidates).length && list(matrix.rows).length > 0
    ? "AVAILABLE"
    : list(matrix.rows).length > 0 ? "PARTIAL" : "UNAVAILABLE";
  return matrix;
}

function collectorInput(current: PipelineCurrentProducts, generatedAt: string): PipelineCompetitorCollectorInput {
  const goal = current.goal_revision;
  const product = strategyDimension(current, "advertised_offer")
    || strategyDimension(current, "campaign_focus")
    || text(goal?.desired_outcome);
  const audience = strategyDimension(current, "target_audience");
  const qualifiedResult = strategyDimension(current, "qualified_result") || text(goal?.qualified_action);
  const value = strategyDimension(current, "core_message") || product;
  const exclusions = strategyDimension(current, "exclusions");
  const geography = strategyDimension(current, "geography") || "Россия";
  if (!product) throw new Error("Текущий продукт отсутствует; публичный анализ конкурентов нельзя обновить.");
  const url = landingUrl(current);
  const sourceSnapshot = current.competitor_evidence_refresh
    ? record(current.competitor_evidence_refresh.competitor_matrix)
    : record(current.analytics_evidence_snapshot?.competitor_matrix);
  const rawCandidateSet = record(sourceSnapshot.candidate_set);
  const candidateSet = rawCandidateSet.schema_version === "p0-bounded-competitor-research-v1"
    ? structuredClone(rawCandidateSet) as CompetitorCandidateSet
    : null;
  return {
    ownerKey: current.owner_key,
    model: {
      product,
      audience,
      value,
      qualified_result: qualifiedResult,
      exclusions,
      geography,
      offer_candidates: [{
        label: product,
        offer: product,
        audience,
        value,
        qualified_outcome: qualifiedResult,
        economics: "",
        destination: url,
        destination_status: "AVAILABLE",
        current_promotion: "UNKNOWN",
        unresolved_facts: [],
        evidence_refs: [],
        demand_cluster_ids: [],
      }],
    },
    site: {
      url,
      title: product,
      description: value,
      text_excerpt: [product, audience, qualifiedResult].filter(Boolean).join(" · "),
    },
    candidateSet,
    generatedAt,
  };
}

export async function refreshCurrentPipelineCompetitorEvidence(input: {
  store: PipelineCurrentProductStore;
  ownerKey: string;
  expectedStateRevision: number;
  collector: PipelineCompetitorEvidenceCollector;
  analyst: PipelineCompetitorEvidenceAnalyst;
  refreshedAt?: string;
  collectorTimeoutMs?: number;
  analystTimeoutMs?: number;
}) {
  const current = await input.store.loadCurrent(input.ownerKey);
  if (!current) throw new Error("Текущие проверенные данные ещё не сформированы.");
  if (current.state_revision !== input.expectedStateRevision) {
    throw new Error("Текущие данные изменились. Обновите Dashboard перед повторной проверкой конкурентов.");
  }
  if (!current.analytics_evidence_snapshot) {
    throw new Error("Сначала сформируйте текущий срез проверенных данных.");
  }
  const refreshedAt = input.refreshedAt ?? new Date().toISOString();
  const collected = await withinDeadline(
    input.collector(collectorInput(current, refreshedAt)),
    boundedTimeout(input.collectorTimeoutMs, DEFAULT_COMPETITOR_COLLECTION_TIMEOUT_MS),
    "COMPETITOR_COLLECTION_TIMEOUT",
    "Публичный сбор данных о конкурентах",
  );
  if (!collected) throw new Error("Для текущего предложения не найден ограниченный публичный набор конкурентов.");
  const assessment = await withinDeadline(input.analyst({
    collection: structuredClone(collected),
    businessGoal: {
      desiredOutcome: text(current.goal_revision?.desired_outcome),
      qualifiedAction: text(current.goal_revision?.qualified_action),
    },
  }),
  boundedTimeout(input.analystTimeoutMs, DEFAULT_COMPETITOR_ANALYST_TIMEOUT_MS),
  "COMPETITOR_ANALYST_TIMEOUT",
  "Классификация Evidence Analyst",
  );
  const competitorMatrix = assessedCompetitorMatrix(collected, assessment);
  const sourceSnapshotId = text(
    current.analytics_evidence_snapshot.snapshot_revision_id
      ?? current.analytics_evidence_snapshot.snapshot_id,
  ) || "current-evidence";
  const material = {
    refreshed_at: refreshedAt,
    source_snapshot_id: sourceSnapshotId,
    evidence_pack_id: collected.evidencePackId,
    competitor_matrix: competitorMatrix,
    competitor_observations: structuredClone(collected.competitorObservations ?? []),
    financial_competitor_intelligence: collected.financialCompetitorIntelligence,
    competitor_assessment: assessment,
  };
  const refresh: PipelineCompetitorEvidenceRefresh = {
    schema_version: PIPELINE_COMPETITOR_EVIDENCE_REFRESH_SCHEMA,
    revision_id: `competitor-evidence:${(await pipelineDigest(material)).slice(7, 31)}`,
    ...structuredClone(material),
    authority: {
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spend_micros: 0,
    },
  };
  const next: PipelineCurrentProducts = {
    ...structuredClone(current),
    state_revision: current.state_revision + 1,
    updated_at: refreshedAt,
    competitor_evidence_refresh: refresh,
    authority: {
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spend_micros: 0,
    },
  };
  if (!await input.store.compareAndSwap(input.ownerKey, current.state_revision, next)) {
    throw new Error("Текущие данные изменились во время проверки конкурентов. Обновите Dashboard.");
  }
  return structuredClone(next);
}
