import {
  competitorAssessmentMatchesScope,
  isFirstPartyCompetitorUrl,
  type CompetitorComparisonScope,
} from "./competitor-comparison.ts";
import { competitorRankingMatchesEvidence, type CompetitorDossier, type CompetitorResearchCoverage, type CompetitorRanking } from "./competitor-ranking.ts";
import type { PipelineCompetitorAssessment } from "./pipeline-competitor-refresh.ts";

export type OwnerCompetitorAnalysis = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  competitorStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  assessmentStatus: "CURRENT" | "REQUIRED";
  financialStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  candidateCount: number;
  observedOfferCount: number;
  research?: {
    coverage: CompetitorResearchCoverage;
    searchQueries: string[];
    exclusions: Array<{ name: string; relation: string; reason: string }>;
  } | null;
  competitors: Array<{
    name: string;
    rationale: string;
    observedOffer: string;
    publishedPrice: string | null;
    landingUrl: string;
    observationStatus: "OBSERVED" | "UNAVAILABLE";
    observedAt: string | null;
    evidenceQuote: string | null;
    observationScope: string | null;
    limitations: string[];
    competitiveRelation: "DIRECT_COMPETITOR" | "SUBSTITUTE_COMPETITOR" | null;
    analysis?: CompetitorDossier | null;
  }>;
  financialProfiles: Array<{
    name: string;
    role: "COMPANY" | "COMPETITOR" | "COMPANY_COMPETITOR";
    reportingYear: number | null;
    revenueRub: string | null;
    netProfitRub: string | null;
    bfoUrl: string | null;
    rusprofileUrl: string | null;
  }>;
  summary: string;
  limitations: string[];
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

function competitiveRelation(value: unknown): "DIRECT_COMPETITOR" | "SUBSTITUTE_COMPETITOR" | null {
  return value === "DIRECT_COMPETITOR" || value === "SUBSTITUTE_COMPETITOR" ? value : null;
}

function host(value: unknown) {
  try { return new URL(text(value)).hostname.toLowerCase().replace(/^www\./u, ""); } catch { return ""; }
}

function financialStatus(value: unknown): OwnerCompetitorAnalysis["financialStatus"] {
  return value === "AVAILABLE" ? "AVAILABLE" : value === "PARTIAL" ? "PARTIAL" : "UNAVAILABLE";
}

function latestObservation(profile: JsonRecord, metric: string) {
  return list(profile.observations)
    .map(record)
    .filter((observation) => observation.metric === metric && observation.status === "AVAILABLE" && text(observation.value_rub))
    .sort((left, right) => Number(right.reporting_year) - Number(left.reporting_year))[0] ?? null;
}

function rusprofileUrl(financialRecord: JsonRecord) {
  const prefix = "RUSPROFILE_CROSS_CHECK:";
  const flag = list(record(financialRecord.quality).flags).map(text).find((item) => item.startsWith(prefix));
  return flag ? flag.slice(prefix.length) : null;
}

export function projectCompetitorAnalysisForDashboard(snapshotValue: unknown, scope?: CompetitorComparisonScope): OwnerCompetitorAnalysis {
  const snapshot = record(snapshotValue);
  const matrix = record(snapshot.competitor_matrix);
  const candidateSet = record(matrix.candidate_set);
  const assessment = record(snapshot.competitor_assessment ?? record(snapshot.competitor_research).assessment);
  const currentAssessment = competitorAssessmentMatchesScope(assessment, scope);
  const discovery = record(snapshot.competitor_discovery ?? record(snapshot.competitor_research).discovery);
  const rankingValue = snapshot.competitor_ranking ?? record(snapshot.competitor_research).ranking;
  const rawCandidates = list(record(discovery.candidate_set).candidates).map((item) => ({
    competitor: text(record(item).competitor), exact_destinations: list(record(item).exact_destinations).map(text),
  }));
  const ranking = currentAssessment && scope && rankingValue
    && competitorRankingMatchesEvidence(rankingValue, scope, rawCandidates, assessment as PipelineCompetitorAssessment)
    ? rankingValue as CompetitorRanking : null;
  const rows = list(matrix.rows).map(record);
  const assessmentRelations = currentAssessment ? list(assessment.relations).map(record) : [];
  const candidates = list(candidateSet.candidates).map(record).filter((candidate) => {
    const name = text(candidate.competitor).toLocaleLowerCase("ru-RU");
    const relations = assessmentRelations.filter((item) => text(item.competitor).toLocaleLowerCase("ru-RU") === name);
    if (relations.length !== 1 || !competitiveRelation(relations[0].relation) || !scope) return false;
    const url = text(relations[0].evidence_url);
    return Boolean(url) && !isFirstPartyCompetitorUrl(url, scope)
      && list(candidate.exact_destinations).some((destination) => text(destination) === url)
      && rows.some((row) => text(row.competitor).toLocaleLowerCase("ru-RU") === name
        && text(row.exact_landing) === url && text(row.observed_offer_message));
  });
  const rawObservations = list(snapshot.competitor_observations).map(record);
  const persistedObservations: JsonRecord[] = list(snapshot.evidence).map(record)
    .filter((item) => text(item.source_id) === "competitors")
    .map((item) => ({
      observed_at: item.observed_at,
      raw_quote: record(item.raw).quote,
      scope: item.scope,
      limitations: item.limitations,
      matrix_row: record(record(item.normalized).matrix_row),
    }));
  const observationEntries = [...persistedObservations, ...rawObservations].flatMap((observation): Array<[string, JsonRecord]> => {
    const name = text(record(observation.matrix_row).competitor).toLocaleLowerCase("ru-RU");
    return name ? [[name, observation]] : [];
  });
  const observationByCompetitor = new Map<string, JsonRecord>(observationEntries);
  const relationByCompetitor = new Map(assessmentRelations.map((relation) => [
    text(relation.competitor).toLocaleLowerCase("ru-RU"),
    competitiveRelation(relation.relation),
  ]));
  const rowByCompetitor = new Map(rows.filter((row) => assessmentRelations.some((relation) =>
    text(relation.competitor).toLocaleLowerCase("ru-RU") === text(row.competitor).toLocaleLowerCase("ru-RU")
      && text(relation.evidence_url) === text(row.exact_landing)))
    .map((row) => [text(row.competitor).toLocaleLowerCase("ru-RU"), row]));
  const competitors = candidates.map((candidate) => {
    const name = text(candidate.competitor);
    const normalizedName = name.toLocaleLowerCase("ru-RU");
    const row = rowByCompetitor.get(normalizedName) ?? {};
    const observation: JsonRecord = observationByCompetitor.get(normalizedName) ?? {};
    const observationScope = record(observation.scope);
    const price = record(row.published_price);
    return {
      name,
      rationale: text(assessmentRelations.find((item) => text(item.competitor).toLocaleLowerCase("ru-RU") === normalizedName)?.rationale),
      observedOffer: text(row.observed_offer_message),
      publishedPrice: price.status === "PUBLISHED" ? text(price.value) || null : null,
      landingUrl: text(row.exact_landing) || text(list(candidate.exact_destinations)[0]),
      observationStatus: Object.keys(row).length ? "OBSERVED" as const : "UNAVAILABLE" as const,
      observedAt: text(observation.observed_at) || text(row.observation_date) || null,
      evidenceQuote: text(observation.raw_quote) || null,
      observationScope: text(observationScope.observation_scope) || null,
      limitations: list(observation.limitations).map(text).filter(Boolean),
      competitiveRelation: relationByCompetitor.get(normalizedName) ?? null,
      analysis: ranking?.candidates.find((item) => item.competitor === name) ?? null,
    };
  }).filter((candidate) => candidate.name)
    .sort((left, right) => (left.analysis?.rank ?? Number.MAX_SAFE_INTEGER) - (right.analysis?.rank ?? Number.MAX_SAFE_INTEGER));
  const observedOfferCount = competitors.filter((candidate) => candidate.observationStatus === "OBSERVED").length;
  const competitorStatus = competitors.length === 0
    ? "UNAVAILABLE" as const
    : observedOfferCount === competitors.length
      ? "AVAILABLE" as const
      : "PARTIAL" as const;

  const dossier = record(snapshot.financial_competitor_intelligence);
  const dossierFinancialStatus = financialStatus(dossier.capability_status);
  const acceptedRecords = list(dossier.accepted_records).map(record);
  const acceptedRecordById = new Map(acceptedRecords.map((item) => [text(item.record_id), item]));
  const confirmedHosts = new Set(competitors.map((competitor) => host(competitor.landingUrl)).filter(Boolean));
  const acceptedEntities = list(record(dossier.legal_perimeter).accepted_entities).map(record);
  const financialProfiles = list(dossier.profiles).map(record).filter((profile) => {
    if (profile.role === "COMPANY") return true;
    const entity = acceptedEntities.find((item) => item.entity_id === profile.entity_id);
    return list(entity?.evidence).map(record).some((item) => item.evidence_kind === "BRAND_OR_PRODUCT_RELATION"
      && item.status === "VERIFIED" && confirmedHosts.has(host(item.source_locator)));
  }).map((profile) => {
    const revenue = latestObservation(profile, "REVENUE");
    const netProfit = latestObservation(profile, "NET_PROFIT");
    const selectedRecord = acceptedRecordById.get(text(revenue?.record_id))
      ?? acceptedRecordById.get(text(netProfit?.record_id))
      ?? acceptedRecords.find((item) => text(item.entity_id) === text(profile.entity_id))
      ?? {};
    const years = [Number(revenue?.reporting_year), Number(netProfit?.reporting_year)].filter((year) => Number.isSafeInteger(year));
    const role = profile.role === "COMPANY" ? "COMPANY" as const : "COMPETITOR" as const;
    return {
      name: text(profile.legal_name),
      role,
      reportingYear: years.length ? Math.max(...years) : null,
      revenueRub: revenue ? text(revenue.value_rub) || null : null,
      netProfitRub: netProfit ? text(netProfit.value_rub) || null : null,
      bfoUrl: text(record(selectedRecord.provenance).source_locator) || null,
      rusprofileUrl: rusprofileUrl(selectedRecord),
    };
  }).filter((profile) => profile.name);

  const hasCompetitorEvidence = competitorStatus !== "UNAVAILABLE";
  const scopedFinancialStatus = financialProfiles.some((profile) => profile.role === "COMPETITOR")
    ? dossierFinancialStatus : "UNAVAILABLE" as const;
  const hasFinancialEvidence = scopedFinancialStatus !== "UNAVAILABLE";
  const status = !hasCompetitorEvidence && !hasFinancialEvidence
    ? "UNAVAILABLE" as const
    : competitorStatus === "AVAILABLE" && scopedFinancialStatus === "AVAILABLE"
      ? "AVAILABLE" as const
      : "PARTIAL" as const;
  const limitations = [...new Set([
    ...list(matrix.limitations).map(text),
    ...list(dossier.limitations).map(text),
    ...(!currentAssessment ? ["Сопоставимость предложений с текущей целью ещё не проверена."] : []),
  ].filter(Boolean))];
  const observedEntityCount = financialProfiles.filter((profile) => profile.revenueRub !== null || profile.netProfitRub !== null).length;
  const summary = !competitors.length
    ? "Конкуренты с сопоставимым предложением пока не подтверждены."
    : `Подтверждены ${observedOfferCount.toLocaleString("ru-RU")} из ${competitors.length.toLocaleString("ru-RU")} конкурентных предложений и финансовая история ${observedEntityCount.toLocaleString("ru-RU")} юридических лиц.`;
  return {
    status,
    competitorStatus,
    assessmentStatus: currentAssessment ? "CURRENT" : "REQUIRED",
    financialStatus: scopedFinancialStatus,
    candidateCount: competitors.length,
    observedOfferCount,
    research: ranking ? { coverage: structuredClone(ranking.coverage), searchQueries: list(discovery.search_queries).map(text),
      exclusions: assessmentRelations.filter((item) => !competitiveRelation(item.relation)).map((item) => ({ name: text(item.competitor), relation: text(item.relation), reason: text(item.rationale) })) } : null,
    competitors,
    financialProfiles,
    summary,
    limitations,
  };
}
