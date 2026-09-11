import { createBoundedCompetitorCandidateSet, type CompetitorCandidateSet } from "./competitor-research.ts";
import { collectedCompetitorMatrix } from "./public-competitor-refresh-collector.ts";
import { COMPETITOR_TARGET_COUNT, type CompetitorRankingAgent, type CompetitorRanking, type CompetitorResearchCoverage } from "./competitor-ranking.ts";
import type { BusinessModel, SiteAnalysis } from "./p0-application.ts";
import {
  type PipelineCurrentProducts,
  type PipelineCurrentProductStore,
  type PipelineJsonRecord,
} from "./pipeline-current-products.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";
import type { CompetitorDiscovery, CompetitorDiscoveryAgent } from "./competitor-discovery.ts";
import {
  COMPETITOR_ASSESSMENT_SCHEMA,
  competitorAssessmentMatchesScope,
  isFirstPartyCompetitorUrl,
  pipelineCompetitorComparisonScope,
  type CompetitorComparisonScope,
} from "./competitor-comparison.ts";

export const PIPELINE_COMPETITOR_EVIDENCE_REFRESH_SCHEMA = "p0-pipeline-competitor-evidence-refresh-v1";

export class PipelineCompetitorRefreshTimeoutError extends Error {
  readonly code: "COMPETITOR_DISCOVERY_TIMEOUT" | "COMPETITOR_COLLECTION_TIMEOUT" | "COMPETITOR_ANALYST_TIMEOUT" | "COMPETITOR_RANKING_TIMEOUT";

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
  signal?: AbortSignal;
};

export type PipelineCompetitorCollection = {
  evidencePackId: string;
  competitorMatrix: PipelineJsonRecord;
  competitorObservations: PipelineJsonRecord[];
  financialCompetitorIntelligence: PipelineJsonRecord;
  collectionFailures?: Array<{ competitor: string; url: string; code: string; reason: string }>;
};

export type PipelineCompetitiveRelation = "DIRECT_COMPETITOR" | "SUBSTITUTE_COMPETITOR" | "NOT_COMPETITOR" | "UNAVAILABLE";

export type PipelineCompetitorAssessment = {
  schema_version: typeof COMPETITOR_ASSESSMENT_SCHEMA;
  comparison_scope: CompetitorComparisonScope;
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
  signal?: AbortSignal;
  collection: PipelineCompetitorCollection;
  businessGoal: { desiredOutcome: string; qualifiedAction: string };
  comparisonScope: CompetitorComparisonScope;
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
  competitor_discovery?: CompetitorDiscovery | null;
  competitor_ranking?: CompetitorRanking | null;
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

function boundedTimeout(value: unknown, fallback: number | null) {
  if (value == null && fallback === null) return null;
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 300_000) {
    throw new Error("Competitor refresh timeout must be between 1 and 300000 milliseconds.");
  }
  return parsed;
}

async function withinDeadline<T>(
  work: Promise<T>,
  timeoutMs: number | null,
  code: PipelineCompetitorRefreshTimeoutError["code"],
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    return await Promise.race([
      work,
      ...(signal ? [new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      })] : []),
      ...(timeoutMs === null ? [] : [new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new PipelineCompetitorRefreshTimeoutError(
          code,
          `${label} не завершён за ${timeoutMs} мс; поздний результат отброшен без сохранения.`,
        )), timeoutMs);
      })]),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
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

export function assessedCompetitorMatrix(
  collection: PipelineCompetitorCollection,
  assessment: PipelineCompetitorAssessment,
  comparisonScope: CompetitorComparisonScope,
) {
  const matrix = structuredClone(collection.competitorMatrix);
  const candidateSet = record(matrix.candidate_set);
  const candidates = list(candidateSet.candidates).map(record);
  const rows = list(matrix.rows).map(record);
  const candidateNames = candidates.map((candidate) => text(candidate.competitor));
  const observedUrls = new Map(candidateNames.map((name) => [name, rows.filter((row) => text(row.competitor) === name).map((row) => text(row.exact_landing))]));
  if (!competitorAssessmentMatchesScope(assessment, comparisonScope)
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
    const urls = observedUrls.get(name) ?? [];
    if (!["DIRECT_COMPETITOR", "SUBSTITUTE_COMPETITOR", "NOT_COMPETITOR", "UNAVAILABLE"].includes(relation.relation)) {
      throw new Error("Evidence Analyst вернул неизвестную конкурентную роль.");
    }
    if (relation.relation === "UNAVAILABLE") {
      if (urls.length || relation.evidence_url !== null) throw new Error("Недоступное предложение не может ссылаться на наблюдённую страницу.");
    } else {
      if (!urls.includes(text(relation.evidence_url))) {
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
    .filter((item) => !isFirstPartyCompetitorUrl(item.evidence_url, comparisonScope))
    .map((item) => text(item.competitor)));
  candidateSet.candidates = candidates.filter((candidate) => included.has(text(candidate.competitor)));
  matrix.candidate_set = candidateSet;
  matrix.rows = rows.filter((row) => included.has(text(row.competitor)));
  matrix.coverage = list(matrix.coverage).map(record).filter((item) => included.has(text(item.competitor)));
  // Aggregate claims made for the original candidate set cannot describe this narrower set.
  matrix.aggregate_claims = [];
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
  // Reassessment must retain the collected candidate pool even when the previous result excluded every offer.
  const priorDiscoverySet = [
    record(record(current.competitor_evidence_refresh?.competitor_discovery).candidate_set),
    record(record(record(current.analytics_evidence_snapshot?.competitor_research).discovery).candidate_set),
  ].find((candidateSet) => candidateSet.schema_version === "p0-bounded-competitor-research-v1" && list(candidateSet.candidates).length > 0);
  const rawCandidateSet = priorDiscoverySet ?? [
    record(current.analytics_evidence_snapshot?.competitor_matrix),
    record(current.competitor_evidence_refresh?.competitor_matrix),
  ].map((matrix) => record(matrix.candidate_set)).find((candidateSet) =>
    candidateSet.schema_version === "p0-bounded-competitor-research-v1" && list(candidateSet.candidates).length > 0) ?? {};
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

/** Shared search → independent page collection → assessment for full runs and refresh. */
export async function researchPipelineCompetitors(input: {
  collectionInput: PipelineCompetitorCollectorInput;
  comparisonScope: CompetitorComparisonScope;
  collector: PipelineCompetitorEvidenceCollector;
  analyst: PipelineCompetitorEvidenceAnalyst;
  discoverer?: CompetitorDiscoveryAgent;
  rankingAgent?: CompetitorRankingAgent;
  collectorTimeoutMs?: number;
  analystTimeoutMs?: number;
  discoveryTimeoutMs?: number;
}) {
  if (input.rankingAgent && input.discoverer) return researchCompetitorTop(input as typeof input & { discoverer: CompetitorDiscoveryAgent; rankingAgent: CompetitorRankingAgent });
  const { comparisonScope } = input;
  const collectionInput = { ...input.collectionInput };
  const signal = collectionInput.signal;
  signal?.throwIfAborted();
  let discovery: CompetitorDiscovery | null = null;
  if (input.discoverer) {
    discovery = await withinDeadline(input.discoverer({
      signal,
      comparisonScope: structuredClone(comparisonScope),
      previousCandidates: collectionInput.candidateSet?.candidates.map((item) => ({ name: item.competitor, rationale: item.rationale })) ?? [],
      generatedAt: collectionInput.generatedAt,
    }), boundedTimeout(input.discoveryTimeoutMs, null), "COMPETITOR_DISCOVERY_TIMEOUT", "Поиск конкурентов Evidence Analyst", signal);
    if (!discovery.candidate_set?.candidates.length) throw new Error("Агент выполнил публичный поиск, но не нашёл подтверждаемых кандидатов для текущего предложения.");
    if (JSON.stringify(discovery.comparison_scope) !== JSON.stringify(comparisonScope)) throw new Error("Поиск конкурентов выполнен для другой цели.");
    collectionInput.candidateSet = structuredClone(discovery.candidate_set);
  }
  signal?.throwIfAborted();
  const collected = await withinDeadline(
    input.collector(collectionInput),
    boundedTimeout(input.collectorTimeoutMs, null),
    "COMPETITOR_COLLECTION_TIMEOUT",
    "Публичный сбор данных о конкурентах",
    signal,
  );
  if (!collected) throw new Error("Для текущего предложения не найден ограниченный публичный набор конкурентов.");
  signal?.throwIfAborted();
  const assessment = await withinDeadline(input.analyst({
    signal,
    collection: structuredClone(collected),
    comparisonScope: structuredClone(comparisonScope),
    businessGoal: {
      desiredOutcome: comparisonScope.desired_outcome,
      qualifiedAction: comparisonScope.qualified_action,
    },
  }),
  boundedTimeout(input.analystTimeoutMs, null),
  "COMPETITOR_ANALYST_TIMEOUT",
  "Классификация Evidence Analyst",
  signal,
  );
  signal?.throwIfAborted();
  const competitorMatrix = assessedCompetitorMatrix(collected, assessment, comparisonScope);
  const included = new Set(list(record(competitorMatrix.candidate_set).candidates).map((item) => text(record(item).competitor)));
  return {
    ...collected,
    competitorMatrix,
    competitorObservations: structuredClone((collected.competitorObservations ?? [])
      .filter((item) => included.has(text(record(item.matrix_row).competitor)))),
    assessment,
    discovery,
    ranking: null,
  };
}

function candidateIdentity(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\b20\d{2}\b/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function researchCompetitorTop(input: {
  collectionInput: PipelineCompetitorCollectorInput;
  comparisonScope: CompetitorComparisonScope;
  collector: PipelineCompetitorEvidenceCollector;
  analyst: PipelineCompetitorEvidenceAnalyst;
  discoverer: CompetitorDiscoveryAgent;
  rankingAgent: CompetitorRankingAgent;
  discoveryTimeoutMs?: number;
  collectorTimeoutMs?: number;
  analystTimeoutMs?: number;
}) {
  const { comparisonScope, collectionInput } = input;
  const signal = collectionInput.signal;
  const candidates = new Map<string, CompetitorCandidateSet["candidates"][number]>();
  const relations = new Map<string, PipelineCompetitorAssessment["relations"][number]>();
  const observations = new Map<string, PipelineJsonRecord>();
  const attemptedUrls = new Set<string>();
  const discoveries: CompetitorDiscovery[] = [];
  const failures: NonNullable<PipelineCompetitorCollection["collectionFailures"]> = [];
  let lastCollection: PipelineCompetitorCollection | null = null;
  let lastAssessment: PipelineCompetitorAssessment | null = null;
  let stopReason: CompetitorResearchCoverage["stop_reason"] = "RESEARCH_LIMIT_REACHED";
  const confirmed = () => [...relations.values()].filter((item) => ["DIRECT_COMPETITOR", "SUBSTITUTE_COMPETITOR"].includes(item.relation)
    && !isFirstPartyCompetitorUrl(item.evidence_url, comparisonScope));
  for (let round = 1; ; round += 1) {
    signal?.throwIfAborted();
    const discovery = await withinDeadline(input.discoverer({ signal, comparisonScope: structuredClone(comparisonScope), generatedAt: collectionInput.generatedAt,
      previousCandidates: collectionInput.candidateSet?.candidates.map((item) => ({ name: item.competitor, rationale: item.rationale })) ?? [],
      researchRequest: { round, targetConfirmed: COMPETITOR_TARGET_COUNT, confirmedNames: confirmed().map((item) => item.competitor),
        priorSearchQueries: discoveries.flatMap((item) => item.search_queries),
        reviewedCandidates: [...relations.values()].map((item) => ({ name: item.competitor, relation: item.relation, reason: item.rationale })) },
    }), boundedTimeout(input.discoveryTimeoutMs, null), "COMPETITOR_DISCOVERY_TIMEOUT", "Расширенный поиск конкурентов", signal);
    if (JSON.stringify(discovery.comparison_scope) !== JSON.stringify(comparisonScope)) throw new Error("Поиск конкурентов выполнен для другой цели.");
    discoveries.push(discovery);
    const batch: CompetitorCandidateSet["candidates"][number][] = [];
    // Known contenders are refreshed as part of the pool, not merely mentioned
    // to the model. Otherwise each run would replace the top with novel names.
    const proposed = [...(round === 1 ? collectionInput.candidateSet?.candidates ?? [] : []), ...discovery.candidate_set?.candidates ?? []];
    for (const candidate of proposed) {
      const identity = candidateIdentity(candidate.competitor);
      const previous = [...candidates.values()].find((item) => candidateIdentity(item.competitor) === identity
        || item.exact_destinations.some((url) => candidate.exact_destinations.includes(url)));
      if (previous && confirmed().some((item) => item.competitor === previous.competitor)) continue;
      const name = previous?.competitor ?? candidate.competitor;
      const freshUrls = candidate.exact_destinations.filter((url) => !attemptedUrls.has(url) && !isFirstPartyCompetitorUrl(url, comparisonScope));
      if (!freshUrls.length) continue;
      const batchIndex = batch.findIndex((item) => item.competitor === name);
      const replacement = { ...candidate, competitor: name,
        exact_destinations: [...new Set([...freshUrls, ...(batchIndex >= 0 ? batch[batchIndex].exact_destinations : [])])].slice(0, 3) };
      candidates.set(name, replacement);
      if (batchIndex >= 0) batch[batchIndex] = replacement;
      else batch.push(replacement);
    }
    if (!batch.length) { stopReason = "SEARCH_EXHAUSTED"; break; }
    signal?.throwIfAborted();
    for (const candidate of batch) for (const url of candidate.exact_destinations) attemptedUrls.add(url);
    const candidateSet = createBoundedCompetitorCandidateSet({ rule: `Публичные кандидаты для ${comparisonScope.advertised_offer.slice(0, 700)}`,
      candidates: batch.map((item) => ({ competitor: item.competitor, rationale: item.rationale, exactDestinations: item.exact_destinations })) });
    const collected = await withinDeadline(input.collector({ ...collectionInput, candidateSet }),
      boundedTimeout(input.collectorTimeoutMs, null), "COMPETITOR_COLLECTION_TIMEOUT", "Чтение страниц участия конкурентов", signal);
    if (!collected) throw new Error("Публичный сбор конкурентов не вернул результат.");
    signal?.throwIfAborted();
    const assessment = await withinDeadline(input.analyst({ signal, collection: collected, comparisonScope,
      businessGoal: { desiredOutcome: comparisonScope.desired_outcome, qualifiedAction: comparisonScope.qualified_action } }),
      boundedTimeout(input.analystTimeoutMs, null), "COMPETITOR_ANALYST_TIMEOUT", "Проверка сопоставимости конкурентов", signal);
    assessedCompetitorMatrix(collected, assessment, comparisonScope);
    lastCollection = collected;
    lastAssessment = assessment;
    // A reconsidered candidate replaces its earlier failed or insufficient page set.
    for (const candidate of batch) {
      for (const key of observations.keys()) if (key.startsWith(`${candidate.competitor}\n`)) observations.delete(key);
    }
    for (const observation of collected.competitorObservations) {
      const row = record(observation.matrix_row);
      observations.set(`${text(row.competitor)}\n${text(row.exact_landing)}`, observation);
    }
    for (const relation of assessment.relations) relations.set(relation.competitor, relation);
    failures.push(...collected.collectionFailures ?? []);
    if (confirmed().length >= COMPETITOR_TARGET_COUNT) { stopReason = "TARGET_REACHED"; break; }
  }
  signal?.throwIfAborted();
  if (!lastCollection || !lastAssessment) throw new Error("Расширенный поиск не нашёл проверяемых публичных предложений.");
  const candidateSet = createBoundedCompetitorCandidateSet({ rule: `Сопоставимые предложения для ${comparisonScope.advertised_offer.slice(0, 600)}; поиск по нескольким сегментам и источникам`,
    candidates: [...candidates.values()].map((item) => ({ competitor: item.competitor, rationale: item.rationale, exactDestinations: item.exact_destinations })) });
  const rawCollection: PipelineCompetitorCollection = { ...lastCollection,
    competitorMatrix: collectedCompetitorMatrix(candidateSet, [...observations.values()]) as unknown as PipelineJsonRecord,
    competitorObservations: [...observations.values()], collectionFailures: failures,
    evidencePackId: `competitor-research:${(await pipelineDigest({ candidateSet, observations: [...observations.values()], generatedAt: collectionInput.generatedAt })).slice(7, 31)}` };
  const assessment: PipelineCompetitorAssessment = { ...lastAssessment, relations: [...relations.values()], summary: "Сопоставимость проверена по публичным предложениям для текущей покупки и пересекающихся сегментов клиентов." };
  const matrix = assessedCompetitorMatrix(rawCollection, assessment, comparisonScope);
  const acceptedNames = new Set(list(record(matrix.candidate_set).candidates).map((item) => text(record(item).competitor)));
  const collection: PipelineCompetitorCollection = { ...rawCollection, competitorMatrix: matrix,
    competitorObservations: [...observations.values()].filter((item) => acceptedNames.has(text(record(item.matrix_row).competitor))) };
  const coverage: CompetitorResearchCoverage = {
    target_count: COMPETITOR_TARGET_COUNT, discovered_count: candidates.size,
    observed_count: new Set([...observations.values()].map((item) => text(record(item.matrix_row).competitor))).size,
    confirmed_count: acceptedNames.size, excluded_count: [...relations.values()].filter((item) => item.relation === "NOT_COMPETITOR").length,
    unavailable_count: [...relations.values()].filter((item) => item.relation === "UNAVAILABLE").length,
    rounds: discoveries.length, target_met: acceptedNames.size >= COMPETITOR_TARGET_COUNT, stop_reason: stopReason,
  };
  const ranking = acceptedNames.size ? await withinDeadline(input.rankingAgent({ comparisonScope, collection, assessment, coverage, generatedAt: collectionInput.generatedAt, signal }),
    null, "COMPETITOR_RANKING_TIMEOUT", "Анализ и ранжирование конкурентов", signal) : null;
  const discovery: CompetitorDiscovery = { ...discoveries[0], candidate_set: candidateSet,
    search_queries: [...new Set(discoveries.flatMap((item) => item.search_queries))],
    source_evidence: discoveries.flatMap((item) => item.source_evidence),
    summary: `Расширенный поиск: ${candidates.size} кандидатов, ${acceptedNames.size} подтверждённых, ${discoveries.length} прохода.`,
  };
  return { ...collection, assessment, discovery, ranking };
}

export async function refreshCurrentPipelineCompetitorEvidence(input: {
  store: PipelineCurrentProductStore;
  ownerKey: string;
  expectedStateRevision: number;
  collector: PipelineCompetitorEvidenceCollector;
  analyst: PipelineCompetitorEvidenceAnalyst;
  discoverer?: CompetitorDiscoveryAgent;
  rankingAgent?: CompetitorRankingAgent;
  refreshedAt?: string;
  collectorTimeoutMs?: number;
  analystTimeoutMs?: number;
  discoveryTimeoutMs?: number;
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
  const comparisonScope = pipelineCompetitorComparisonScope(current);
  const collected = await researchPipelineCompetitors({
    ...input, comparisonScope, collectionInput: collectorInput(current, refreshedAt),
  });
  const sourceSnapshotId = text(
    current.analytics_evidence_snapshot.snapshot_revision_id
      ?? current.analytics_evidence_snapshot.snapshot_id,
  ) || "current-evidence";
  const material = {
    refreshed_at: refreshedAt,
    source_snapshot_id: sourceSnapshotId,
    evidence_pack_id: collected.evidencePackId,
    competitor_matrix: collected.competitorMatrix,
    competitor_observations: collected.competitorObservations,
    financial_competitor_intelligence: collected.financialCompetitorIntelligence,
    competitor_assessment: collected.assessment,
    competitor_discovery: collected.discovery,
    competitor_ranking: collected.ranking,
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
    const latest = await input.store.loadCurrent(input.ownerKey);
    const latestSnapshotId = text(latest?.analytics_evidence_snapshot?.snapshot_revision_id
      ?? latest?.analytics_evidence_snapshot?.snapshot_id) || "current-evidence";
    if (!latest || latestSnapshotId !== sourceSnapshotId
      || JSON.stringify(pipelineCompetitorComparisonScope(latest)) !== JSON.stringify(comparisonScope)) {
      throw new Error("Цель или предложение изменились во время поиска конкурентов. Повторите проверку для текущей цели.");
    }
    // Campaign generation may advance unrelated products during public research. Preserve all of them.
    const rebased: PipelineCurrentProducts = {
      ...structuredClone(latest),
      state_revision: latest.state_revision + 1,
      updated_at: new Date().toISOString(),
      competitor_evidence_refresh: structuredClone(refresh),
    };
    if (!await input.store.compareAndSwap(input.ownerKey, latest.state_revision, rebased)) {
      throw new Error("Текущие данные повторно изменились во время сохранения конкурентов. Обновите Dashboard.");
    }
    return structuredClone(rebased);
  }
  return structuredClone(next);
}
