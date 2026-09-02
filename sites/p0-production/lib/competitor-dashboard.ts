export type OwnerCompetitorAnalysis = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  competitorStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  financialStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  candidateCount: number;
  observedOfferCount: number;
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

function normalizedKey(value: unknown) {
  return text(value).toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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

export function projectCompetitorAnalysisForDashboard(snapshotValue: unknown): OwnerCompetitorAnalysis {
  const snapshot = record(snapshotValue);
  const matrix = record(snapshot.competitor_matrix);
  const candidateSet = record(matrix.candidate_set);
  const candidates = list(candidateSet.candidates).map(record);
  const rows = list(matrix.rows).map(record);
  const assessmentRelations = list(record(snapshot.competitor_assessment).relations).map(record);
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
  const observationEntries = [...rawObservations, ...persistedObservations].flatMap((observation): Array<[string, JsonRecord]> => {
    const name = text(record(observation.matrix_row).competitor).toLocaleLowerCase("ru-RU");
    return name ? [[name, observation]] : [];
  });
  const observationByCompetitor = new Map<string, JsonRecord>(observationEntries);
  const relationByCompetitor = new Map(assessmentRelations.map((relation) => [
    text(relation.competitor).toLocaleLowerCase("ru-RU"),
    competitiveRelation(relation.relation),
  ]));
  const rowByCompetitor = new Map(rows.map((row) => [text(row.competitor).toLocaleLowerCase("ru-RU"), row]));
  const competitors = candidates.map((candidate) => {
    const name = text(candidate.competitor);
    const normalizedName = name.toLocaleLowerCase("ru-RU");
    const row = rowByCompetitor.get(normalizedName) ?? {};
    const observation: JsonRecord = observationByCompetitor.get(normalizedName) ?? {};
    const observationScope = record(observation.scope);
    const price = record(row.published_price);
    return {
      name,
      rationale: text(candidate.rationale),
      observedOffer: text(row.observed_offer_message),
      publishedPrice: price.status === "PUBLISHED" ? text(price.value) || null : null,
      landingUrl: text(row.exact_landing) || text(list(candidate.exact_destinations)[0]),
      observationStatus: Object.keys(row).length ? "OBSERVED" as const : "UNAVAILABLE" as const,
      observedAt: text(observation.observed_at) || text(row.observation_date) || null,
      evidenceQuote: text(observation.raw_quote) || null,
      observationScope: text(observationScope.observation_scope) || null,
      limitations: list(observation.limitations).map(text).filter(Boolean),
      competitiveRelation: relationByCompetitor.get(normalizedName) ?? null,
    };
  }).filter((candidate) => candidate.name);
  const competitorStatus = candidates.length === 0
    ? "UNAVAILABLE" as const
    : rows.length >= candidates.length
      ? "AVAILABLE" as const
      : "PARTIAL" as const;

  const dossier = record(snapshot.financial_competitor_intelligence);
  const dossierFinancialStatus = financialStatus(dossier.capability_status);
  const acceptedRecords = list(dossier.accepted_records).map(record);
  const acceptedRecordById = new Map(acceptedRecords.map((item) => [text(item.record_id), item]));
  const financialProfiles = list(dossier.profiles).map(record).map((profile) => {
    const revenue = latestObservation(profile, "REVENUE");
    const netProfit = latestObservation(profile, "NET_PROFIT");
    const selectedRecord = acceptedRecordById.get(text(revenue?.record_id))
      ?? acceptedRecordById.get(text(netProfit?.record_id))
      ?? acceptedRecords.find((item) => text(item.entity_id) === text(profile.entity_id))
      ?? {};
    const years = [Number(revenue?.reporting_year), Number(netProfit?.reporting_year)].filter((year) => Number.isSafeInteger(year));
    const entityKey = normalizedKey(text(profile.entity_id).replace(/^(?:company|competitor)-/u, "").replace(/-/gu, " "));
    const companyHasCompetitiveOffer = profile.role === "COMPANY" && assessmentRelations.some((relation) => {
      const relationKind = competitiveRelation(relation.relation);
      return relationKind !== null && entityKey && normalizedKey(relation.competitor).includes(entityKey);
    });
    const role = companyHasCompetitiveOffer
      ? "COMPANY_COMPETITOR" as const
      : profile.role === "COMPANY" ? "COMPANY" as const : "COMPETITOR" as const;
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
  const hasFinancialEvidence = dossierFinancialStatus !== "UNAVAILABLE";
  const status = !hasCompetitorEvidence && !hasFinancialEvidence
    ? "UNAVAILABLE" as const
    : competitorStatus === "AVAILABLE" && dossierFinancialStatus === "AVAILABLE"
      ? "AVAILABLE" as const
      : "PARTIAL" as const;
  const limitations = [...new Set([
    ...list(matrix.limitations).map(text),
    ...list(dossier.limitations).map(text),
  ].filter(Boolean))];
  const observedEntityCount = financialProfiles.filter((profile) => profile.revenueRub !== null || profile.netProfitRub !== null).length;
  const summary = status === "UNAVAILABLE"
    ? "Подтверждённый конкурентный набор и финансовая история пока не собраны."
    : `Подтверждены ${rows.length.toLocaleString("ru-RU")} из ${candidates.length.toLocaleString("ru-RU")} конкурентных предложений и финансовая история ${observedEntityCount.toLocaleString("ru-RU")} юридических лиц.`;
  return {
    status,
    competitorStatus,
    financialStatus: dossierFinancialStatus,
    candidateCount: candidates.length,
    observedOfferCount: rows.length,
    competitors,
    financialProfiles,
    summary,
    limitations,
  };
}
