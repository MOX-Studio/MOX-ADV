import type { CampaignDesignContentSource } from "./campaign-design-content.ts";

export const SEARCH_SEMANTICS_SCHEMA = "campaign-search-semantics-v1";
export const SEARCH_CATALOG_LIMIT = 1_000;
export type SearchIntent = "TARGET_ACTION" | "COMMERCIAL" | "BRAND" | "GENERAL" | "AMBIGUOUS";
export const SEARCH_INTENT_LABELS: Record<SearchIntent, string> = {
  TARGET_ACTION: "Целевое действие", COMMERCIAL: "Коммерческий интерес", BRAND: "Брендовый интерес",
  GENERAL: "Общий интерес", AMBIGUOUS: "Неоднозначное намерение",
};
export type SearchFrequency = {
  count: number;
  observation_id: string;
  source: string;
  observed_at: string;
  region_ids: number[];
  regions: string[];
  device: string | null;
  operator_profile: string | null;
  window: string | null;
  scope_fingerprint: string | null;
};
export type SearchAdmission = {
  source_ref: string;
  phrase: string | null;
  disposition: "FORWARDED" | "EXCLUDED" | "CAPACITY_OMITTED" | "DUPLICATE";
  reason: string;
};
export type SearchCoverageGroup = { group_id: string; cluster_id: string; intent_hint: SearchIntent; source_refs: string[] };
export type SearchCoverageDecision = {
  group_id: string;
  disposition: "INCLUDED" | "EXCLUDED" | "NEEDS_RESEARCH";
  rationale: string;
};
export type SearchSemanticsAudit = {
  schema_version: typeof SEARCH_SEMANTICS_SCHEMA;
  status: "REVIEWED" | "NEEDS_RESEARCH" | "NOT_REVIEWED";
  trace: { observed: number; admitted: number; forwarded: number; selected: number; capacity_omitted: number };
  admission: SearchAdmission[];
  groups: Array<SearchCoverageGroup & { decision: SearchCoverageDecision | null }>;
  keywords: Array<{ phrase: string; source_refs: string[]; intent: SearchIntent | null; rationale: string | null; frequency: SearchFrequency | null }>;
  gaps: string[];
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
// Matching observations must preserve operators, word order and ё; no broad-to-exact substitution.
export const searchPhraseIdentity = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim();

function observationWindow(value: unknown): string | null {
  const raw = text(value);
  if (raw === "rolling_last_30_days") return raw;
  const ranges = [...new Set([...raw.matchAll(/\d{2}\.\d{2}\.\d{4}\s*[–—-]\s*\d{2}\.\d{2}\.\d{4}/gu)]
    .map(([range]) => range.replace(/\s*[–—-]\s*/u, " — ")))];
  return ranges.length ? ranges.join(" / ") : null;
}

export function observationFrequency(row: Record<string, unknown>, frequency: Record<string, unknown>): SearchFrequency {
  const scopes = list(frequency.scopes).map(record);
  const scope = scopes.find((item) => item.scope_fingerprint === row.scope_fingerprint) ?? (scopes.length === 1 ? scopes[0] : {});
  return {
    count: Number(row.count), observation_id: text(row.observation_id), source: text(record(row.provider_provenance).source),
    observed_at: text(row.observed_at), region_ids: list(row.region_ids).map(Number), regions: list(row.region_names).map(text),
    device: text(row.device) || null, operator_profile: text(row.operator_profile ?? scope.operator_profile) || null,
    window: observationWindow(row.declared_window ?? frequency.declared_window), scope_fingerprint: text(row.scope_fingerprint) || null,
  };
}

/** A conservative hint for diversification, NOT a factual intent classification or an automatic negative. */
export function searchIntentHint(phrase: string, qualifiedAction: string, brands: string[] = []): SearchIntent {
  const value = searchPhraseIdentity(phrase);
  const action = searchPhraseIdentity(qualifiedAction);
  const exhibitionSale = /стенд|экспонент/u.test(action);
  if (exhibitionSale && /затрат|бухгалтер|проводк|посетител|билет|как добраться|способы участия/u.test(value)) return "AMBIGUOUS";
  if (/(?:^|\s)(?:принял|примет|участвовал|фото|новости|реферат)(?:\s|$)/u.test(value)) return "AMBIGUOUS";
  if (exhibitionSale && /стенд|экспонент/u.test(value)) return "TARGET_ACTION";
  if (/купить|заказать|забронировать|записаться/u.test(value)) return "TARGET_ACTION";
  if (/стоимост|(?:^|\s)цен[аыуе](?:\s|$)|расценк|тариф/u.test(value)) return "COMMERCIAL";
  if (brands.some((brand) => brand && value.includes(searchPhraseIdentity(brand)))) return "BRAND";
  return "GENERAL";
}

function priority(source: CampaignDesignContentSource) {
  return ["TARGET_ACTION", "COMMERCIAL", "BRAND", "GENERAL", "AMBIGUOUS"].indexOf(source.demand?.intent_hint ?? "GENERAL");
}

/** Preserve every ordinary corpus. At the explicit resource boundary, diversify before filling slots. */
export function rankSearchSources(sources: CampaignDesignContentSource[], limit = SEARCH_CATALOG_LIMIT) {
  const buckets = new Map<string, CampaignDesignContentSource[]>();
  for (const source of sources) {
    const demand = source.demand;
    const key = JSON.stringify([demand?.cluster_id, demand?.intent_hint, demand?.frequency?.scope_fingerprint, demand?.frequency?.window]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(source);
    buckets.set(key, bucket);
  }
  // Frequency is compared only within a common cluster, intent and observation scope.
  for (const bucket of buckets.values()) bucket.sort((a, b) => (b.demand?.frequency?.count ?? -1) - (a.demand?.frequency?.count ?? -1)
    || a.source_ref.localeCompare(b.source_ref));
  const ordered = [...buckets.entries()].sort(([ak, a], [bk, b]) => priority(a[0]) - priority(b[0]) || ak.localeCompare(bk));
  const result: CampaignDesignContentSource[] = [];
  for (let depth = 0; ordered.some(([, bucket]) => depth < bucket.length); depth++) {
    for (const [, bucket] of ordered) if (bucket[depth] && result.length < limit) result.push(bucket[depth]);
    if (result.length >= limit) break;
  }
  return result;
}

export function searchCoverageGroups(sources: CampaignDesignContentSource[]): SearchCoverageGroup[] {
  const buckets = new Map<string, Omit<SearchCoverageGroup, "group_id">>();
  for (const source of sources.filter((item) => item.purpose === "DEMAND")) {
    const cluster = source.demand?.cluster_id || "observed-history";
    const intent = source.demand?.intent_hint ?? "GENERAL";
    const key = JSON.stringify([cluster, intent]);
    const bucket = buckets.get(key) ?? { cluster_id: cluster, intent_hint: intent, source_refs: [] };
    bucket.source_refs.push(source.source_ref);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([, group], index) => ({ group_id: `intent-${index + 1}`, ...group }));
}

export function searchCoverageSchema(groups: SearchCoverageGroup[]) {
  return {
    type: "array", minItems: groups.length, maxItems: groups.length,
    items: { type: "object", properties: {
      group_id: { type: "string", enum: groups.map((group) => group.group_id) },
      disposition: { type: "string", enum: ["INCLUDED", "EXCLUDED", "NEEDS_RESEARCH"] },
      rationale: { type: "string", minLength: 20, maxLength: 1_000 },
    }, required: ["group_id", "disposition", "rationale"], additionalProperties: false },
  };
}

type SelectedKeyword = { text: string; source_refs: string[] };
export function assessSearchCoverage(input: {
  sources: CampaignDesignContentSource[]; admission: SearchAdmission[]; observed: number;
  keywords: SelectedKeyword[]; decisions: unknown; reviewed?: boolean;
}) {
  const groups = searchCoverageGroups(input.sources);
  const selected = new Set(input.keywords.flatMap((keyword) => input.sources.filter((source) => source.purpose === "DEMAND"
    && searchPhraseIdentity(source.text) === searchPhraseIdentity(keyword.text)).map((source) => source.source_ref)));
  const decisions = list(input.decisions).map(record);
  const violations: Array<{ code: string; pointer: string; message: string }> = [];
  const gap = (code: string, message: string) => violations.push({ code, pointer: "/semantic_review", message });
  if (input.reviewed !== false && (decisions.length !== groups.length || new Set(decisions.map((item) => item.group_id)).size !== decisions.length
    || decisions.some((item) => !groups.some((group) => group.group_id === item.group_id)))) gap("SEMANTIC_REVIEW_INCOMPLETE", "Review every observed intent group exactly once; missing groups cannot disappear silently.");
  const reviewedGroups = groups.map((group) => {
    const row = decisions.find((item) => item.group_id === group.group_id);
    const included = group.source_refs.some((ref) => selected.has(ref));
    const valid = row && Object.keys(row).sort().join(",") === "disposition,group_id,rationale"
      && ["INCLUDED", "EXCLUDED", "NEEDS_RESEARCH"].includes(String(row.disposition)) && text(row.rationale).length >= 20 && text(row.rationale).length <= 1_000;
    if (input.reviewed !== false) {
      if (!valid) gap("SEMANTIC_DECISION_INVALID", `Explain the business-outcome relevance and disposition of ${group.group_id}.`);
      else if ((row.disposition === "INCLUDED" && !included) || (row.disposition === "EXCLUDED" && included)) gap("SEMANTIC_SELECTION_MISMATCH", `${group.group_id}: INCLUDED needs an actual selected phrase and EXCLUDED permits none. NEEDS_RESEARCH may retain a supported partial selection without certifying coverage.`);
      if (valid && row.disposition === "NEEDS_RESEARCH") gap("SEMANTIC_RESEARCH_REQUIRED", `${group.group_id}: ${text(row.rationale)}`);
    }
    return { ...group, decision: valid ? row as unknown as SearchCoverageDecision : null };
  });
  const capacityOmitted = input.admission.filter((item) => item.disposition === "CAPACITY_OMITTED").length;
  if (capacityOmitted) gap("SEMANTIC_CAPACITY_INCOMPLETE", `${capacityOmitted} admitted observations exceed the explicit catalog budget; coverage is incomplete.`);
  if (!groups.length) gap("SEMANTIC_DEMAND_UNAVAILABLE", "No admitted observed demand. Business-source keywords have unconfirmed search frequency; further research is required.");
  const audit: SearchSemanticsAudit = {
    schema_version: SEARCH_SEMANTICS_SCHEMA,
    status: input.reviewed === false ? "NOT_REVIEWED" : violations.length ? "NEEDS_RESEARCH" : "REVIEWED",
    trace: { observed: input.observed, admitted: input.admission.filter((item) => ["FORWARDED", "CAPACITY_OMITTED"].includes(item.disposition)).length,
      forwarded: input.sources.filter((item) => item.purpose === "DEMAND").length, selected: selected.size, capacity_omitted: capacityOmitted },
    admission: input.admission, groups: reviewedGroups,
    keywords: input.keywords.map((keyword) => {
      const source = input.sources.find((source) => source.purpose === "DEMAND" && searchPhraseIdentity(source.text) === searchPhraseIdentity(keyword.text));
      const group = reviewedGroups.find((group) => source && group.source_refs.includes(source.source_ref));
      return { phrase: keyword.text, source_refs: keyword.source_refs, frequency: source?.demand?.frequency ?? null,
        intent: source?.demand?.intent_hint ?? null, rationale: group?.decision?.rationale ?? null };
    }),
    gaps: [...new Set(violations.map((item) => item.code))],
  };
  return { audit, violations };
}

/** Read-only join for both existing and newly generated Drafts. Never substitutes a seed or strips operators. */
export function keywordFrequencyObservations(snapshotValue: unknown, phrase: string, regionIds: number[]): SearchFrequency[] {
  const snapshot = record(snapshotValue);
  const frequency = record(record(snapshot.market_evidence).frequency);
  if (!["AVAILABLE", "PARTIAL"].includes(text(frequency.status)) || frequency.canonical_observation_schema !== "wordstat-canonical-observation-v1") return [];
  const rows = list(frequency.canonical_observations).map(record);
  const regions = JSON.stringify([...regionIds].sort((a, b) => a - b));
  const result: SearchFrequency[] = [];
  for (const row of rows) {
    const provider = record(row.provider_provenance);
    if (row.schema_version !== "wordstat-canonical-observation-v1" || searchPhraseIdentity(text(row.phrase)) !== searchPhraseIdentity(phrase)
      || !/^wordstat-row:[a-f\d]{64}$/u.test(text(row.observation_id)) || row.row_id !== row.observation_id || row.method !== "top_requests"
      || typeof row.count !== "number" || !Number.isFinite(row.count) || row.count < 0 || !Number.isFinite(Date.parse(text(row.observed_at)))
      || !["YANDEX_WORDSTAT_V1", "YANDEX_WORDSTAT_UI"].includes(text(provider.source)) || provider.batch_id !== frequency.snapshot_batch_id
      || !list(provider.call_ids).length || !list(provider.request_fingerprints).length || !regionIds.length
      || JSON.stringify(list(row.region_ids).map(Number).sort((a, b) => a - b)) !== regions) continue;
    const supported = list(snapshot.evidence).map(record).some((evidence) => {
      const source = list(snapshot.sources).map(record).find((source) => source.source_id === evidence.source_id);
      const metadata = record(evidence.provider_metadata);
      return source && ["VERIFIED", "PARTIAL"].includes(text(source.status))
        && source.provenance_class === (provider.source === "YANDEX_WORDSTAT_UI" ? "WORDSTAT_OFFICIAL_UI" : "WORDSTAT_OFFICIAL_API")
        && record(evidence.freshness).status === "fresh" && !list(evidence.conflicts).length
        && metadata.snapshot_batch_id === provider.batch_id && list(metadata.canonical_observation_ids).includes(row.observation_id)
        && record(evidence.source_locator).batch_id === provider.batch_id;
    });
    if (supported) result.push(observationFrequency(row, frequency));
  }
  // A conflicting count for the same scope is unknown, never the larger observation.
  return result.filter((value) => !result.some((other) => other.scope_fingerprint === value.scope_fingerprint
    && other.window === value.window && other.count !== value.count));
}
