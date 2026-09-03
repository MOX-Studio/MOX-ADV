type JsonRecord = Record<string, unknown>;

type EvidenceStatus = "VERIFIED" | "PARTIAL" | "UNAVAILABLE";
export type OwnerEvidenceFreshness = "CURRENT" | "AGING" | "STALE" | "UNKNOWN";

export type OwnerEvidenceSource = {
  id: string;
  title: string;
  kind: string;
  provenanceClass: string;
  status: EvidenceStatus;
  observedAt: string | null;
  freshness: OwnerEvidenceFreshness;
  access: string;
  scope: JsonRecord;
  facts: string[];
  limitations: string[];
  sourceUrls: string[];
};

export type OwnerEvidenceDomain = {
  id: string;
  status: EvidenceStatus;
  sourceIds: string[];
  freshness: { current: number; aging: number; stale: number; unknown: number };
  limitations: string[];
};

export type OwnerEvidenceCompanyFact = {
  id: string;
  field: string;
  value: string;
  classification: string;
  confidence: {
    quality: string;
    freshness: string;
    consistency: string;
    coverage: string;
    tier: string;
    uncertainty: string[];
  };
  sourceIds: string[];
  sourceUrls: string[];
};

export type OwnerEvidenceIntegration = {
  id: "direct" | "metrika";
  title: string;
  status: EvidenceStatus;
  observedAt: string | null;
  freshness: OwnerEvidenceFreshness;
  access: string;
  scope: JsonRecord;
  facts: string[];
  limitations: string[];
  sourceUrls: string[];
};

export type OwnerPipelineEvidenceSnapshot = {
  schemaVersion: string;
  snapshotId: string;
  generatedAt: string;
  asOf: string;
  recommendationStatus: string;
  company: {
    host: string;
    facts: OwnerEvidenceCompanyFact[];
  };
  integrations: OwnerEvidenceIntegration[];
  sources: OwnerEvidenceSource[];
  domains: OwnerEvidenceDomain[];
  summary: {
    sourcesTotal: number;
    sourcesVerified: number;
    sourcesPartial: number;
    sourcesUnavailable: number;
    claimsSupported: number;
  };
  confidence: {
    quality: string;
    freshness: string;
    consistency: string;
    coverage: string;
    uncertainty: string[];
  };
  hardBlockers: string[];
  materialUncertainties: string[];
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function strings(value: unknown) {
  return list(value).map(text).filter(Boolean);
}

function status(value: unknown): EvidenceStatus {
  return value === "VERIFIED" || value === "PARTIAL" ? value : "UNAVAILABLE";
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "Недоступно";
  if (typeof value === "string") return text(value) || "Недоступно";
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).filter((item) => item !== "Недоступно").join(", ") || "Недоступно";
  try {
    return JSON.stringify(value);
  } catch {
    return "Недоступно";
  }
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function publicUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function collectUrls(value: unknown, output: string[], depth = 0) {
  if (depth > 5) return;
  if (typeof value === "string") {
    const url = publicUrl(value);
    if (url) output.push(url);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectUrls(item, output, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as JsonRecord).slice(0, 50)) collectUrls(item, output, depth + 1);
}

function fallbackPolicyUrl(source: JsonRecord) {
  const policy = record(source.collection_policy);
  for (const key of ["allowed_host", "endpoint_host", "official_host"]) {
    const host = text(policy[key]);
    if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/iu.test(host)) {
      return `https://${host}/`;
    }
  }
  return null;
}

function freshnessForRecords(records: JsonRecord[]): OwnerEvidenceFreshness {
  const values = records.map((item) => text(record(item.freshness).status));
  if (!values.length || values.includes("unknown")) return "UNKNOWN";
  if (values.includes("stale")) return "STALE";
  if (values.includes("aging")) return "AGING";
  return values.every((value) => value === "fresh") ? "CURRENT" : "UNKNOWN";
}

function urlsForEvidence(records: JsonRecord[]) {
  const urls: string[] = [];
  for (const item of records) collectUrls(item.source_locator, urls);
  return unique(urls);
}

function gapsForSource(gaps: JsonRecord[], sourceId: string) {
  return gaps
    .filter((gap) => text(gap.source_id) === sourceId)
    .flatMap((gap) => [text(gap.description), ...strings(gap.limitations)])
    .filter(Boolean);
}

/**
 * Projects an already verified analytics snapshot for owner presentation.
 * It performs no collection, interpretation or fallback substitution.
 */
export function projectEvidenceSnapshotForDashboard(snapshotValue: unknown): OwnerPipelineEvidenceSnapshot {
  const snapshot = record(snapshotValue);
  const scope = record(snapshot.scope);
  const summary = record(snapshot.summary);
  const overallConfidence = record(snapshot.confidence);
  const evidence = list(snapshot.evidence).map(record);
  const gaps = list(snapshot.gaps).map(record);
  const sourceRecords = list(snapshot.sources).map(record);
  const sources: OwnerEvidenceSource[] = sourceRecords.map((source) => {
    const id = text(source.source_id);
    const evidenceIds = new Set(strings(source.evidence_ids));
    const linkedRecords = evidence.filter((item) => evidenceIds.has(text(item.evidence_id)) || text(item.source_id) === id);
    const evidenceUrls = urlsForEvidence(linkedRecords);
    const policyUrl = evidenceUrls.length ? null : fallbackPolicyUrl(source);
    return {
      id,
      title: text(source.title) || id,
      kind: text(source.source_kind),
      provenanceClass: text(source.provenance_class),
      status: status(source.status),
      observedAt: text(source.observed_at) || null,
      freshness: freshnessForRecords(linkedRecords),
      access: text(source.access) || "unavailable",
      scope: structuredClone(record(source.scope)),
      facts: strings(source.facts),
      limitations: strings(source.limitations),
      sourceUrls: unique([...evidenceUrls, ...(policyUrl ? [policyUrl] : [])]),
    };
  }).filter((source) => source.id);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const evidenceById = new Map(evidence.map((item) => [text(item.evidence_id), item]));

  const companyFacts: OwnerEvidenceCompanyFact[] = list(snapshot.claims).map(record)
    .filter((claim) => text(claim.subject) === "business_model")
    .map((claim) => {
      const confidence = record(claim.confidence);
      const evidenceIds = strings(claim.evidence_ids);
      const linkedRecords = evidenceIds.map((id) => evidenceById.get(id)).filter((item): item is JsonRecord => Boolean(item));
      const sourceIds = unique(linkedRecords.map((item) => text(item.source_id)));
      return {
        id: text(claim.claim_id),
        field: text(claim.predicate),
        value: displayValue(claim.value),
        classification: text(claim.classification),
        confidence: {
          quality: text(confidence.quality),
          freshness: text(confidence.freshness),
          consistency: text(confidence.consistency),
          coverage: text(confidence.coverage),
          tier: text(confidence.tier),
          uncertainty: strings(confidence.uncertainty),
        },
        sourceIds,
        sourceUrls: urlsForEvidence(linkedRecords),
      };
    }).filter((fact) => fact.id && fact.field);

  const integrations = ([
    {
      id: "direct" as const,
      title: "Яндекс Директ",
      scopeFallback: {
        client_login: text(scope.direct_client_login),
        client_id: text(scope.direct_client_id),
      },
    },
    {
      id: "metrika" as const,
      title: "Яндекс Метрика",
      scopeFallback: {
        counter_id: text(scope.metrika_counter_id),
        goal_id: text(scope.metrika_goal_id),
      },
    },
  ]).map(({ id, title, scopeFallback }): OwnerEvidenceIntegration => {
    const source = sourceById.get(id);
    const sourceScope = source?.scope ?? {};
    return {
      id,
      title,
      status: source?.status ?? "UNAVAILABLE",
      observedAt: source?.observedAt ?? null,
      freshness: source?.freshness ?? "UNKNOWN",
      access: source?.access ?? "unavailable",
      scope: Object.fromEntries(Object.entries({ ...scopeFallback, ...sourceScope }).filter(([, value]) => text(value))),
      facts: source?.facts ?? [],
      limitations: unique([...(source?.limitations ?? []), ...gapsForSource(gaps, id)]),
      sourceUrls: source?.sourceUrls ?? [],
    };
  });

  const domains: OwnerEvidenceDomain[] = list(record(snapshot.domain_manifest).domains).map(record).map((domain) => {
    const sourceIds = strings(domain.source_ids);
    const freshness = record(domain.freshness);
    return {
      id: text(domain.domain),
      status: status(domain.status),
      sourceIds,
      freshness: {
        current: integer(freshness.current),
        aging: integer(freshness.aging),
        stale: integer(freshness.stale),
        unknown: integer(freshness.unknown),
      },
      limitations: unique(sourceIds.flatMap((id) => [
        ...(sourceById.get(id)?.limitations ?? []),
        ...gapsForSource(gaps, id),
      ])),
    };
  }).filter((domain) => domain.id);

  return {
    schemaVersion: text(snapshot.schema_version),
    snapshotId: text(snapshot.snapshot_id),
    generatedAt: text(snapshot.generated_at),
    asOf: text(snapshot.as_of),
    recommendationStatus: text(snapshot.recommendation_status),
    company: {
      host: text(scope.company_host),
      facts: companyFacts,
    },
    integrations,
    sources,
    domains,
    summary: {
      sourcesTotal: integer(summary.sources_total),
      sourcesVerified: integer(summary.sources_verified),
      sourcesPartial: integer(summary.sources_partial),
      sourcesUnavailable: integer(summary.sources_unavailable),
      claimsSupported: integer(summary.claims_supported),
    },
    confidence: {
      quality: text(overallConfidence.quality),
      freshness: text(overallConfidence.freshness),
      consistency: text(overallConfidence.consistency),
      coverage: text(overallConfidence.coverage),
      uncertainty: strings(overallConfidence.uncertainty),
    },
    hardBlockers: strings(summary.hard_blockers),
    materialUncertainties: strings(snapshot.material_uncertainties),
  };
}
