import JSONbigFactory from "json-bigint";

const JSONbig = JSONbigFactory({ useNativeBigInt: true });

export const MARKET_EVIDENCE_CONTRACT = "demand-cost-packing-v1";
export const WORDSTAT_BATCH_SCHEMA = "wordstat-observation-batch-v1";
export const WORDSTAT_API_HOST = "api.wordstat.yandex.net";
export const WORDSTAT_ENDPOINTS = {
  top_requests: `https://${WORDSTAT_API_HOST}/v1/topRequests`,
  dynamics: `https://${WORDSTAT_API_HOST}/v1/dynamics`,
  regions: `https://${WORDSTAT_API_HOST}/v1/regions`,
} as const;

const WORDSTAT_METHODS = ["top_requests", "dynamics", "regions"] as const;
const WORDSTAT_DEVICES = new Set(["all", "desktop", "phone", "tablet"]);
const WORDSTAT_MAXIMUM_SEEDS = 8;
const WORDSTAT_MAXIMUM_PROVIDER_CALLS = 24;

export const WORDSTAT_SCOPE_ENDPOINT = `https://${WORDSTAT_API_HOST}/v1/getRegionsTree`;

export class WordstatScopeError extends Error {
  readonly code: "WORDSTAT_SCOPE_INVALID" | "WORDSTAT_BATCH_LIMIT_EXCEEDED";

  constructor(code: "WORDSTAT_SCOPE_INVALID" | "WORDSTAT_BATCH_LIMIT_EXCEEDED", message: string) {
    super(message);
    this.name = "WordstatScopeError";
    this.code = code;
  }
}

export function validateWordstatProviderScope(input: {
  regionIds: unknown[];
  regionNames: unknown[];
  device: unknown;
}) {
  if (!WORDSTAT_DEVICES.has(String(input.device))) {
    throw new WordstatScopeError("WORDSTAT_SCOPE_INVALID", "Wordstat device scope is invalid.");
  }
  const regionIds = input.regionIds.map(Number);
  const regionNames = input.regionNames.map(normalizedText);
  if (!regionIds.length
    || regionNames.length !== regionIds.length
    || regionIds.some((item) => !Number.isSafeInteger(item) || item <= 0)
    || new Set(regionIds).size !== regionIds.length
    || regionNames.some((item) => !item)) {
    throw new WordstatScopeError("WORDSTAT_SCOPE_INVALID", "Wordstat regions require unique positive IDs with exact non-empty names.");
  }
  return {
    regionIds,
    regionNames,
    device: String(input.device) as WordstatSeed["device"],
  };
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type WordstatMethod = typeof WORDSTAT_METHODS[number];
export type WordstatOperatorProfile = "BROAD_CONTAINING" | "FIXED_WORD_COUNT" | "FIXED_ORDER_FORM" | "DYNAMICS_BROAD";
export type WordstatSeed = {
  seed_id: string;
  cluster_id: string;
  phrase: string;
  dynamics_phrase: string;
  dynamics_period: "monthly" | "weekly" | "daily";
  dynamics_from_date: string;
  dynamics_to_date: string;
  operator_profile: Exclude<WordstatOperatorProfile, "DYNAMICS_BROAD">;
  region_ids: number[];
  region_names: string[];
  device: "all" | "desktop" | "phone" | "tablet";
};
export type WordstatCall = {
  call_id: string;
  batch_id: string;
  seed_id: string;
  cluster_id: string;
  method: WordstatMethod;
  endpoint: string;
  requested_at: string;
  status: "AVAILABLE" | "UNAVAILABLE";
  operator_profile: WordstatOperatorProfile;
  canonical_phrase: string;
  period: WordstatSeed["dynamics_period"] | null;
  from_date: string | null;
  to_date: string | null;
  scope: {
    region_ids: number[];
    region_names: string[];
    device: WordstatSeed["device"];
    region_filter_applied: boolean;
  };
  request_fingerprint: string;
  rows: Array<Record<string, unknown>>;
  gaps: Array<{ code: string; detail: string; retry_after_seconds: number | null }>;
};
export type WordstatObservationBatch = {
  schema_version: typeof WORDSTAT_BATCH_SCHEMA;
  source: "YANDEX_WORDSTAT_V1";
  batch_id: string;
  batch_started_at: string;
  batch_finished_at: string;
  declared_window: "rolling_last_30_days";
  source_window_end: "undisclosed_by_api";
  calls: WordstatCall[];
};

export const DEMAND_COST_RESEARCH_PLAN_SCHEMA = "demand-cost-research-plan-v1";
export type DemandSeedDimension = "OFFER_LANGUAGE" | "CUSTOMER_PROBLEM" | "HIGH_INTENT_ACTION" | "BRAND" | "NON_BRAND";
export type DemandCostResearchPlan = {
  schema_version: typeof DEMAND_COST_RESEARCH_PLAN_SCHEMA;
  plan_id: string;
  generated_at: string;
  quota: {
    maximum_seed_formulations: 8;
    maximum_provider_calls: 24;
    planned_seed_formulations: number;
    planned_provider_calls: number;
  };
  scope: {
    regions: Array<{ id: number; name: string }>;
    devices: WordstatSeed["device"][];
    seasonality: {
      business_context: string | null;
      method: "MONTHLY_DYNAMICS_SAME_PERIOD";
      from_date: string;
      to_date: string;
    };
  };
  exclusions: string[];
  dimensions: Array<{
    dimension: DemandSeedDimension;
    status: "PLANNED" | "UNAVAILABLE";
    formulation_count: number;
    limitation: string | null;
  }>;
  seeds: Array<WordstatSeed & { dimension: DemandSeedDimension }>;
  comparable_cost_scope: {
    required_direct_audit: "COMPLETE";
    phrase: "EXACT";
    geography: "SAME_REGION_SET";
    placement: "SEARCH_RESULTS";
    strategy: "WB_MAXIMUM_CLICKS";
    season: "CURRENT_AUDIT_WINDOW";
    minimum_click_sample: number;
    sources: ["KEYWORDBIDS_V5_CURRENT_PROXY", "DIRECT_HISTORY_OWN_EMPIRICAL"];
    averaging_allowed: false;
  };
};

function normalizedText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function finiteNonNegative(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function boundedPhrase(value: unknown) {
  const words = normalizedText(value)
    .replace(/[!"[\]()|+]/gu, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
  const selected: string[] = [];
  for (const word of words) {
    if (selected.join(" ").length + word.length + 1 > 200) break;
    selected.push(word);
  }
  return selected.join(" ");
}

function plusPhrase(value: string) {
  return value.split(/\s+/u).filter(Boolean).map((item) => `+${item}`).join(" ");
}

export async function buildDemandCostResearchPlan(input: {
  generatedAt: string;
  offerLanguage: string;
  customerProblems: string[];
  highIntentActions: string[];
  brandTerms: string[];
  exclusions: string[];
  regionIds: number[];
  regionNames: string[];
  device: WordstatSeed["device"];
  seasonality: string;
  dynamicsFromDate: string;
  dynamicsToDate: string;
  minimumClickSample?: number;
}): Promise<DemandCostResearchPlan> {
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error("Demand research plan requires a generated timestamp.");
  const providerScope = validateWordstatProviderScope({
    regionIds: input.regionIds,
    regionNames: input.regionNames,
    device: input.device,
  });
  if (!Number.isFinite(Date.parse(input.dynamicsFromDate))
    || !Number.isFinite(Date.parse(input.dynamicsToDate))
    || input.dynamicsFromDate > input.dynamicsToDate) {
    throw new Error("Demand research plan requires a valid bounded seasonality window.");
  }
  const offer = boundedPhrase(input.offerLanguage);
  if (!offer) throw new Error("Demand research plan requires offer language.");
  const brandTokens = new Set(input.brandTerms.flatMap((value) => boundedPhrase(value).toLocaleLowerCase("ru-RU").split(/\s+/u)).filter(Boolean));
  const nonBrandOffer = offer.split(/\s+/u).filter((word) => !brandTokens.has(word.toLocaleLowerCase("ru-RU"))).join(" ") || offer;
  const candidates: Array<{ dimension: DemandSeedDimension; phrase: string }> = [
    { dimension: "OFFER_LANGUAGE", phrase: offer },
    ...input.customerProblems.map((value) => ({ dimension: "CUSTOMER_PROBLEM" as const, phrase: boundedPhrase(`${value} ${nonBrandOffer}`) })),
    ...input.highIntentActions.map((value) => ({ dimension: "HIGH_INTENT_ACTION" as const, phrase: boundedPhrase(`${value} ${nonBrandOffer}`) })),
    ...input.brandTerms.map((value) => ({ dimension: "BRAND" as const, phrase: boundedPhrase(`${value} ${nonBrandOffer}`) })),
    { dimension: "NON_BRAND", phrase: nonBrandOffer },
  ];
  const unique = new Map<string, { dimension: DemandSeedDimension; phrase: string }>();
  for (const candidate of candidates) {
    const identity = candidate.phrase.toLocaleLowerCase("ru-RU");
    if (!candidate.phrase || unique.has(`${candidate.dimension}:${identity}`)) continue;
    unique.set(`${candidate.dimension}:${identity}`, candidate);
  }
  const selected = [...unique.values()].slice(0, 8);
  const dimensionCounters = new Map<DemandSeedDimension, number>();
  const seeds = selected.map((candidate, index) => {
    const ordinal = (dimensionCounters.get(candidate.dimension) ?? 0) + 1;
    dimensionCounters.set(candidate.dimension, ordinal);
    const dimensionSlug = candidate.dimension.toLocaleLowerCase("en-US").replaceAll("_", "-");
    return {
      seed_id: `${dimensionSlug}-${ordinal}`,
      cluster_id: index === 0 ? "demand-cluster-primary" : `demand-cluster-${dimensionSlug}-${ordinal}`,
      dimension: candidate.dimension,
      phrase: candidate.phrase,
      dynamics_phrase: plusPhrase(candidate.phrase),
      dynamics_period: "monthly" as const,
      dynamics_from_date: input.dynamicsFromDate,
      dynamics_to_date: input.dynamicsToDate,
      operator_profile: "BROAD_CONTAINING" as const,
      region_ids: [...providerScope.regionIds],
      region_names: [...providerScope.regionNames],
      device: providerScope.device,
    };
  });
  const dimensions = (["OFFER_LANGUAGE", "CUSTOMER_PROBLEM", "HIGH_INTENT_ACTION", "BRAND", "NON_BRAND"] as DemandSeedDimension[])
    .map((dimension) => {
      const formulationCount = seeds.filter((seed) => seed.dimension === dimension).length;
      return {
        dimension,
        status: formulationCount ? "PLANNED" as const : "UNAVAILABLE" as const,
        formulation_count: formulationCount,
        limitation: formulationCount ? null : `${dimension} formulation is unavailable from the current Business Model evidence.`,
      };
    });
  const planBody = {
    schema_version: DEMAND_COST_RESEARCH_PLAN_SCHEMA as typeof DEMAND_COST_RESEARCH_PLAN_SCHEMA,
    generated_at: new Date(input.generatedAt).toISOString(),
    quota: {
      maximum_seed_formulations: 8 as const,
      maximum_provider_calls: 24 as const,
      planned_seed_formulations: seeds.length,
      planned_provider_calls: providerScope.regionIds.length ? seeds.length * WORDSTAT_METHODS.length : 0,
    },
    scope: {
      regions: providerScope.regionIds.map((id, index) => ({ id, name: providerScope.regionNames[index] })),
      devices: [providerScope.device],
      seasonality: {
        business_context: normalizedText(input.seasonality) || null,
        method: "MONTHLY_DYNAMICS_SAME_PERIOD" as const,
        from_date: input.dynamicsFromDate,
        to_date: input.dynamicsToDate,
      },
    },
    exclusions: [...new Set(input.exclusions.map(boundedPhrase).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ru-RU")),
    dimensions,
    seeds,
    comparable_cost_scope: {
      required_direct_audit: "COMPLETE" as const,
      phrase: "EXACT" as const,
      geography: "SAME_REGION_SET" as const,
      placement: "SEARCH_RESULTS" as const,
      strategy: "WB_MAXIMUM_CLICKS" as const,
      season: "CURRENT_AUDIT_WINDOW" as const,
      minimum_click_sample: Math.max(1, Math.trunc(Number(input.minimumClickSample) || 3)),
      sources: ["KEYWORDBIDS_V5_CURRENT_PROXY", "DIRECT_HISTORY_OWN_EMPIRICAL"] as ["KEYWORDBIDS_V5_CURRENT_PROXY", "DIRECT_HISTORY_OWN_EMPIRICAL"],
      averaging_allowed: false as const,
    },
  };
  return { ...planBody, plan_id: await sha256(planBody) };
}

function wordstatRows(method: WordstatMethod, payload: Record<string, unknown>) {
  const raw = method === "top_requests"
    ? payload.topRequests
    : method === "dynamics"
      ? payload.dynamics
      : payload.regions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2_000) return null;
  const rows = raw.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (method === "top_requests") {
      return { phrase: normalizedText(row.phrase), count: finiteNonNegative(row.count) };
    }
    if (method === "dynamics") {
      return {
        date: normalizedText(row.date),
        count: finiteNonNegative(row.count),
        share: finiteNonNegative(row.share),
      };
    }
    return {
      region_id: finiteNonNegative(row.regionId),
      region_name: normalizedText(row.regionName),
      count: finiteNonNegative(row.count),
      share: finiteNonNegative(row.share),
      affinity_index: finiteNonNegative(row.affinityIndex),
    };
  });
  const valid = rows.every((row) => method === "top_requests"
    ? Boolean(row.phrase) && row.count !== null
    : method === "dynamics"
      ? Boolean(row.date) && row.count !== null && row.share !== null
      : row.region_id !== null && Boolean(row.region_name) && row.count !== null && row.share !== null && row.affinity_index !== null);
  return valid ? rows : null;
}

function requestFor(method: WordstatMethod, seed: WordstatSeed) {
  if (method === "dynamics") {
    return {
      phrase: seed.dynamics_phrase,
      period: seed.dynamics_period,
      fromDate: seed.dynamics_from_date,
      toDate: seed.dynamics_to_date,
      regions: seed.region_ids,
      devices: [seed.device],
    };
  }
  if (method === "regions") return { phrase: seed.phrase, devices: [seed.device] };
  return { phrase: seed.phrase, regions: seed.region_ids, devices: [seed.device] };
}

function validateSeed(seed: WordstatSeed) {
  if (!normalizedText(seed.seed_id) || !normalizedText(seed.cluster_id) || !normalizedText(seed.phrase)) {
    throw new WordstatScopeError("WORDSTAT_SCOPE_INVALID", "Wordstat seed identity and phrase are required.");
  }
  validateWordstatProviderScope({ regionIds: seed.region_ids, regionNames: seed.region_names, device: seed.device });
  if (!normalizedText(seed.dynamics_phrase) || /[!"[\]()|]/u.test(seed.dynamics_phrase)) {
    throw new WordstatScopeError("WORDSTAT_SCOPE_INVALID", "Wordstat dynamics supports only the + operator profile.");
  }
  if (!Number.isFinite(Date.parse(seed.dynamics_from_date)) || !Number.isFinite(Date.parse(seed.dynamics_to_date))) {
    throw new WordstatScopeError("WORDSTAT_SCOPE_INVALID", "Wordstat dynamics requires an explicit valid date range.");
  }
}

type WordstatGap = WordstatCall["gaps"][number];

function failureGap(status: number, retryAfter: string | null): WordstatGap {
  const retry = retryAfter === null || !normalizedText(retryAfter) ? null : finiteNonNegative(retryAfter);
  if (status === 401 || status === 403) return { code: "WORDSTAT_ACCESS_DENIED", detail: "Wordstat server-side authority was rejected.", retry_after_seconds: null };
  if (status === 429) return { code: "WORDSTAT_QUOTA_EXHAUSTED", detail: "Personal Wordstat quota exhausted.", retry_after_seconds: retry };
  if (status === 503) return { code: "WORDSTAT_QUEUE_UNAVAILABLE", detail: "Wordstat service queue is unavailable.", retry_after_seconds: retry };
  return { code: "WORDSTAT_PROVIDER_ERROR", detail: `Wordstat API returned HTTP ${status}.`, retry_after_seconds: retry };
}

function terminalWordstatGap(gap: WordstatGap) {
  return ["WORDSTAT_AUTHORITY_UNAVAILABLE", "WORDSTAT_ACCESS_DENIED", "WORDSTAT_QUOTA_EXHAUSTED", "WORDSTAT_QUEUE_UNAVAILABLE"].includes(gap.code);
}

export async function collectOfficialWordstatBatch(
  input: { token: string; clientId: string; seeds: WordstatSeed[] },
  fetchImpl: FetchLike,
  now: () => string,
): Promise<WordstatObservationBatch> {
  const started = now();
  const seeds = [...input.seeds].sort((left, right) => left.seed_id.localeCompare(right.seed_id));
  if (!seeds.length || seeds.length > WORDSTAT_MAXIMUM_SEEDS || seeds.length * WORDSTAT_METHODS.length > WORDSTAT_MAXIMUM_PROVIDER_CALLS) {
    throw new WordstatScopeError("WORDSTAT_BATCH_LIMIT_EXCEEDED", "Wordstat batch exceeds the bounded 8-seed/24-call quota.");
  }
  if (new Set(seeds.map((seed) => seed.seed_id)).size !== seeds.length) {
    throw new WordstatScopeError("WORDSTAT_SCOPE_INVALID", "Wordstat seed IDs must be unique within a batch.");
  }
  seeds.forEach(validateSeed);
  const batchId = await sha256({ source: "YANDEX_WORDSTAT_V1", batch_started_at: started, seeds });
  const calls: WordstatCall[] = [];
  let blockedGap: WordstatGap | null = !normalizedText(input.token) || !normalizedText(input.clientId)
    ? { code: "WORDSTAT_AUTHORITY_UNAVAILABLE", detail: "Wordstat server-side authority and registered client binding are not configured.", retry_after_seconds: null }
    : null;
  for (const seed of seeds) {
    for (const method of WORDSTAT_METHODS) {
      const endpoint = WORDSTAT_ENDPOINTS[method];
      const request = requestFor(method, seed);
      const requestedAt = now();
      const operatorProfile = method === "dynamics" ? "DYNAMICS_BROAD" : seed.operator_profile;
      const base = {
        call_id: `${batchId}:${seed.seed_id}:${method}`,
        batch_id: batchId,
        seed_id: seed.seed_id,
        cluster_id: seed.cluster_id,
        method,
        endpoint,
        requested_at: requestedAt,
        operator_profile: operatorProfile as WordstatOperatorProfile,
        canonical_phrase: method === "dynamics" ? seed.dynamics_phrase : seed.phrase,
        period: method === "dynamics" ? seed.dynamics_period : null,
        from_date: method === "dynamics" ? seed.dynamics_from_date : null,
        to_date: method === "dynamics" ? seed.dynamics_to_date : null,
        scope: {
          region_ids: [...seed.region_ids],
          region_names: [...seed.region_names],
          device: seed.device,
          region_filter_applied: method !== "regions",
        },
        request_fingerprint: await sha256({ endpoint, request, operator_profile: operatorProfile }),
      };
      if (blockedGap) {
        calls.push({ ...base, status: "UNAVAILABLE", rows: [], gaps: [blockedGap] });
        continue;
      }
      try {
        // Wordstat ClientId is an approved application registration prerequisite; the official API authenticates requests only with the OAuth Bearer header.
        const response = await fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${input.token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          const gap = failureGap(response.status, response.headers.get("retry-after"));
          if (terminalWordstatGap(gap)) blockedGap = gap;
          calls.push({ ...base, status: "UNAVAILABLE", rows: [], gaps: [gap] });
          continue;
        }
        const payload = await response.json() as Record<string, unknown>;
        const rows = wordstatRows(method, payload);
        if (!rows || payload.error) {
          calls.push({ ...base, status: "UNAVAILABLE", rows: [], gaps: [{ code: "WORDSTAT_RESPONSE_PARTIAL", detail: `Wordstat ${method} rows are missing or invalid.`, retry_after_seconds: null }] });
          continue;
        }
        calls.push({ ...base, status: "AVAILABLE", rows, gaps: [] });
      } catch {
        calls.push({ ...base, status: "UNAVAILABLE", rows: [], gaps: [{ code: "WORDSTAT_PROVIDER_ERROR", detail: "Wordstat request failed closed.", retry_after_seconds: null }] });
      }
    }
  }
  return {
    schema_version: WORDSTAT_BATCH_SCHEMA,
    source: "YANDEX_WORDSTAT_V1",
    batch_id: batchId,
    batch_started_at: started,
    batch_finished_at: now(),
    declared_window: "rolling_last_30_days",
    source_window_end: "undisclosed_by_api",
    calls,
  };
}

export type DemandClusterSpec = {
  cluster_id: string;
  semantic_key: { product: string; need: string; intent: string; offer: string };
  classification?: {
    version: string;
    required_any_tokens?: string[];
    excluded_tokens?: string[];
  };
};

type DemandGap = { code: string; detail: string; retry_after_seconds: number | null };
type ExcludedDemandRow = {
  row_id: string;
  phrase: string;
  normalized_phrase: string;
  reason_code: "RELEVANCE_RULE_NO_MATCH";
  classifier_version: string;
  provenance: { call_ids: string[]; seed_ids: string[] };
};
type DemandScopeEvidence = {
  scope_fingerprint: string;
  operator_profile: WordstatOperatorProfile;
  region_ids: number[];
  region_names: string[];
  device: WordstatSeed["device"];
  observed_unique_count: { value: number | null; semantics: "LOWER_BOUND_OBSERVED_TOP_ROWS" };
  unique_assigned_row_ids: string[];
};

type AssignedDemandRow = {  row_id: string;
  phrase: string;
  normalized_phrase: string;
  count: number;
  assigned_cluster_id: string;
  scope_fingerprint: string;
  provenance: { call_ids: string[]; seed_ids: string[]; request_fingerprints: string[] };
};

function normalizedPhrase(value: unknown) {
  return normalizedText(value).toLocaleLowerCase("ru-RU");
}

function tokenCount(value: string) {
  return normalizedPhrase(value).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean).length;
}

function topScopeKey(call: WordstatCall) {
  return JSON.stringify({
    batch_id: call.batch_id,
    operator_profile: call.operator_profile,
    region_ids: [...call.scope.region_ids].sort((left, right) => left - right),
    device: call.scope.device,
  });
}

function demandToken(value: string) {
  const token = normalizedPhrase(value);
  return /[а-яё]/u.test(token) && token.length > 4
    ? token.replace(/(?:иями|ами|ями|ого|ему|ому|ыми|ими|ий|ый|ая|яя|ое|ее|ую|юю|ы|и|а|я|у|ю|е|о)$/u, "")
    : token;
}

function phraseTokens(value: unknown) {
  return new Set(normalizedPhrase(value)
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .split(" ")
    .map(demandToken)
    .filter((item) => item.length >= 2));
}

function relevanceFor(phrase: string, cluster: DemandClusterSpec | undefined) {
  if (!cluster) return { eligible: false, version: "demand-relevance-rules-v1" };
  const version = normalizedText(cluster.classification?.version) || "demand-relevance-rules-v1";
  const phraseSet = phraseTokens(phrase);
  const required = cluster.classification?.required_any_tokens?.length
    ? cluster.classification.required_any_tokens.map((token) => demandToken(normalizedPhrase(token)))
    : [...phraseTokens(Object.values(cluster.semantic_key).join(" "))];
  const excluded = (cluster.classification?.excluded_tokens ?? []).map((token) => demandToken(normalizedPhrase(token)));
  return {
    eligible: required.some((token) => phraseSet.has(token)) && !excluded.some((token) => phraseSet.has(token)),
    version,
  };
}

async function assignedRowsForScope(calls: WordstatCall[], clusterSpecs: Map<string, DemandClusterSpec>) {
  const candidates = new Map<string, Array<{ call: WordstatCall; phrase: string; normalized: string; count: number }>>();
  for (const call of calls) {
    for (const row of call.rows) {
      const phrase = normalizedText(row.phrase);
      const normalized = normalizedPhrase(phrase);
      const count = finiteNonNegative(row.count);
      if (!phrase || count === null) continue;
      const values = candidates.get(normalized) ?? [];
      values.push({ call, phrase, normalized, count });
      candidates.set(normalized, values);
    }
  }
  const rows: AssignedDemandRow[] = [];
  const excludedRows: ExcludedDemandRow[] = [];
  const conflicts: DemandGap[] = [];
  for (const [normalized, observations] of [...candidates.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const counts = [...new Set(observations.map((item) => item.count))];
    if (counts.length !== 1) {
      conflicts.push({ code: "WORDSTAT_ROW_COUNT_CONFLICT", detail: `Conflicting counts for normalized Wordstat row: ${normalized}.`, retry_after_seconds: null });
      continue;
    }
    const classified = observations.map((item) => ({
      ...item,
      relevance: relevanceFor(item.phrase, clusterSpecs.get(item.call.cluster_id)),
    }));
    const eligible = classified.filter((item) => item.relevance.eligible);
    if (!eligible.length) {
      const scopeFingerprint = await sha256(JSON.parse(topScopeKey(observations[0].call)));
      excludedRows.push({
        row_id: `wordstat-excluded:${(await sha256({ scope: scopeFingerprint, normalized_phrase: normalized })).slice("sha256:".length)}`,
        phrase: observations.map((item) => item.phrase).sort()[0],
        normalized_phrase: normalized,
        reason_code: "RELEVANCE_RULE_NO_MATCH",
        classifier_version: classified.map((item) => item.relevance.version).sort()[0],
        provenance: {
          call_ids: [...new Set(observations.map((item) => item.call.call_id))].sort(),
          seed_ids: [...new Set(observations.map((item) => item.call.seed_id))].sort(),
        },
      });
      continue;
    }
    const ranked = eligible
      .map((item) => ({
        ...item,
        exact: normalized === normalizedPhrase(item.call.canonical_phrase),
        required_tokens: tokenCount(item.call.canonical_phrase),
      }))
      .sort((left, right) => Number(right.exact) - Number(left.exact)
        || right.required_tokens - left.required_tokens
        || left.call.cluster_id.localeCompare(right.call.cluster_id)
        || left.call.seed_id.localeCompare(right.call.seed_id));
    const assigned = ranked[0];
    const scopeFingerprint = await sha256(JSON.parse(topScopeKey(assigned.call)));
    rows.push({
      row_id: `wordstat-row:${(await sha256({ scope: scopeFingerprint, normalized_phrase: normalized })).slice("sha256:".length)}`,
      phrase: observations.map((item) => item.phrase).sort()[0],
      normalized_phrase: normalized,
      count: counts[0],
      assigned_cluster_id: assigned.call.cluster_id,
      scope_fingerprint: scopeFingerprint,
      provenance: {
        call_ids: [...new Set(observations.map((item) => item.call.call_id))].sort(),
        seed_ids: [...new Set(observations.map((item) => item.call.seed_id))].sort(),
        request_fingerprints: [...new Set(observations.map((item) => item.call.request_fingerprint))].sort(),
      },
    });
  }
  return { rows, excludedRows, conflicts };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizedSeasonality(calls: WordstatCall[]) {
  const available = calls.filter((call) => call.status === "AVAILABLE" && call.period === "monthly");
  const scopes = available.map((call) => {
    const points = call.rows
      .map((row) => ({ date: normalizedText(row.date), share: finiteNonNegative(row.share) }))
      .filter((row): row is { date: string; share: number } => Boolean(row.date) && row.share !== null)
      .sort((left, right) => left.date.localeCompare(right.date));
    const latest = points.at(-1) ?? null;
    const month = latest?.date.slice(5, 7);
    const historical = latest ? points.filter((point) => point.date < latest.date && point.date.slice(5, 7) === month).map((point) => point.share) : [];
    const historicalMedian = median(historical);
    return {
      call_id: call.call_id,
      scope: call.scope,
      period: call.period,
      from_date: call.from_date,
      to_date: call.to_date,
      latest_complete_share: latest?.share ?? null,
      historical_same_period_median_share: historicalMedian,
      ratio: latest && historicalMedian && historicalMedian > 0 ? latest.share / historicalMedian : null,
      status: latest && historicalMedian !== null ? "AVAILABLE" : "INSUFFICIENT_HISTORY",
      rows: call.rows,
      gaps: call.gaps,
    };
  });
  const allAvailable = calls.length > 0 && calls.every((call) => call.status === "AVAILABLE");
  const status = !available.length
    ? "UNAVAILABLE"
    : !allAvailable ? "PARTIAL"
      : scopes.every((scope) => scope.status === "AVAILABLE") ? "AVAILABLE" : "INSUFFICIENT_HISTORY";
  return {
    status,
    source: "/v1/dynamics",
    operator_profile: "DYNAMICS_BROAD",
    period: scopes.length === 1 ? scopes[0].period : null,
    from_date: scopes.length === 1 ? scopes[0].from_date : null,
    to_date: scopes.length === 1 ? scopes[0].to_date : null,
    latest_complete_share: scopes.length === 1 ? scopes[0].latest_complete_share : null,
    historical_same_period_median_share: scopes.length === 1 ? scopes[0].historical_same_period_median_share : null,
    ratio: scopes.length === 1 ? scopes[0].ratio : null,
    scopes,
  };
}

export async function buildScopedDemandEvidence(batch: WordstatObservationBatch, clusterSpecs: DemandClusterSpec[]) {
  const topCalls = batch.calls.filter((call) => call.method === "top_requests");
  const availableTopCalls = topCalls.filter((call) => call.status === "AVAILABLE");
  const gaps: DemandGap[] = batch.calls.flatMap((call) => call.gaps);
  const byScope = Map.groupBy(availableTopCalls, topScopeKey);
  const specsById = new Map(clusterSpecs.map((cluster) => [cluster.cluster_id, cluster]));
  const scopes: DemandScopeEvidence[] = [];
  const allRows: AssignedDemandRow[] = [];
  const allExcludedRows: ExcludedDemandRow[] = [];
  for (const [scopeKey, calls] of [...byScope.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const { rows, excludedRows, conflicts } = await assignedRowsForScope(calls, specsById);
    gaps.push(...conflicts);
    allExcludedRows.push(...excludedRows);
    const scope = JSON.parse(scopeKey) as Record<string, unknown>;
    const first = calls[0];
    const value = rows.reduce((sum, row) => sum + row.count, 0);
    scopes.push({
      scope_fingerprint: rows[0]?.scope_fingerprint ?? await sha256(scope),
      operator_profile: first.operator_profile,
      region_ids: first.scope.region_ids,
      region_names: first.scope.region_names,
      device: first.scope.device,
      observed_unique_count: { value: rows.length ? value : null, semantics: "LOWER_BOUND_OBSERVED_TOP_ROWS" },
      unique_assigned_row_ids: rows.map((row) => row.row_id),
    });
    allRows.push(...rows);
  }
  const multipleScopes = scopes.length > 1;
  if (multipleScopes) gaps.push({
    code: "INCOMPARABLE_WORDSTAT_SCOPES",
    detail: "Operator, region or device scopes differ and are disclosed separately rather than added.",
    retry_after_seconds: null,
  });
  const unavailableTop = topCalls.length - availableTopCalls.length;
  const status = availableTopCalls.length === 0
    ? "UNAVAILABLE"
    : unavailableTop > 0 || multipleScopes || gaps.some((gap) => gap.code === "WORDSTAT_ROW_COUNT_CONFLICT")
      ? "PARTIAL"
      : "AVAILABLE";
  const clusterIds = new Set(clusterSpecs.map((cluster) => cluster.cluster_id));
  const clusters = clusterSpecs
    .map((cluster) => {
      const rows = allRows.filter((row) => row.assigned_cluster_id === cluster.cluster_id);
      const clusterScopes = [...Map.groupBy(rows, (row) => row.scope_fingerprint).entries()]
        .map(([scopeFingerprint, scopeRows]) => ({
          scope_fingerprint: scopeFingerprint,
          assigned_row_ids: scopeRows.map((row) => row.row_id).sort(),
          observed_unique_count: {
            value: scopeRows.reduce((sum, row) => sum + row.count, 0),
            semantics: "LOWER_BOUND_OBSERVED_TOP_ROWS" as const,
          },
        }))
        .sort((left, right) => left.scope_fingerprint.localeCompare(right.scope_fingerprint));
      return {
        cluster_id: cluster.cluster_id,
        semantic_key: cluster.semantic_key,
        classifier_version: normalizedText(cluster.classification?.version) || "demand-relevance-rules-v1",
        status: rows.length ? status : "PARTIAL",
        assigned_row_ids: rows.map((row) => row.row_id).sort(),
        scopes: clusterScopes,
        observed_unique_count: {
          value: clusterScopes.length === 1 ? clusterScopes[0].observed_unique_count.value : null,
          semantics: "LOWER_BOUND_OBSERVED_TOP_ROWS",
        },
      };
    })
    .sort((left, right) => left.cluster_id.localeCompare(right.cluster_id));
  const unknownAssignments = allRows.filter((row) => !clusterIds.has(row.assigned_cluster_id));
  if (unknownAssignments.length) gaps.push({
    code: "WORDSTAT_CLUSTER_ASSIGNMENT_UNKNOWN",
    detail: `${unknownAssignments.length} Wordstat rows reference an unknown Demand Cluster.`,
    retry_after_seconds: null,
  });
  const seedMatchedRowCounts = topCalls
    .map((call) => {
      const matched = call.status === "AVAILABLE"
        ? call.rows.find((row) => normalizedPhrase(row.phrase) === normalizedPhrase(call.canonical_phrase))
        : undefined;
      const value = matched ? finiteNonNegative(matched.count) : null;
      return {
        seed_id: call.seed_id,
        cluster_id: call.cluster_id,
        value,
        status: value === null ? "UNAVAILABLE" : "AVAILABLE",
        call_id: call.call_id,
      };
    })
    .sort((left, right) => left.seed_id.localeCompare(right.seed_id));
  const dynamics = batch.calls.filter((call) => call.method === "dynamics");
  const regions = batch.calls.filter((call) => call.method === "regions");
  return {
    status,
    source: "YANDEX_WORDSTAT_V1",
    method: "/v1/topRequests",
    snapshot_batch_id: batch.batch_id,
    batch_started_at: batch.batch_started_at,
    batch_finished_at: batch.batch_finished_at,
    declared_window: batch.declared_window,
    source_window_end: batch.source_window_end,
    canonical_phrases: topCalls.map((call) => call.canonical_phrase),
    observed_unique_count: {
      value: status === "UNAVAILABLE" || multipleScopes || scopes.length !== 1 ? null : scopes[0].observed_unique_count.value,
      semantics: "LOWER_BOUND_OBSERVED_TOP_ROWS",
    },
    semantics: {
      lower_bound: true,
      counts_are_queries_not_users_clicks_or_impressions: true,
      unique_assignment_rule: "exact canonical seed; required token count; stable cluster_id",
    },
    scopes,
    unique_assigned_rows: allRows.sort((left, right) => left.row_id.localeCompare(right.row_id)),
    excluded_rows: allExcludedRows.sort((left, right) => left.row_id.localeCompare(right.row_id)),
    coverage: {
      returned_rows: availableTopCalls.reduce((sum, call) => sum + call.rows.length, 0),
      eligible_unique_rows: allRows.length,
      excluded_unique_rows: allExcludedRows.length,
      exclusion_reason_counts: allExcludedRows.length ? { RELEVANCE_RULE_NO_MATCH: allExcludedRows.length } : {},
      classifier_versions: [...new Set(clusterSpecs.map((cluster) => normalizedText(cluster.classification?.version) || "demand-relevance-rules-v1"))].sort(),
    },
    seed_matched_row_counts: seedMatchedRowCounts,
    clusters,
    seasonality: normalizedSeasonality(dynamics),
    geo_evidence: {
      status: regions.every((call) => call.status === "AVAILABLE") && regions.length ? "AVAILABLE" : "UNAVAILABLE",
      source: "/v1/regions",
      observations: regions.map((call) => ({ call_id: call.call_id, scope: call.scope, rows: call.rows, gaps: call.gaps })),
    },
    gaps,
  };
}

export type DirectComparableCandidate = {
  candidate_key: string;
  keyword_id: string;
  phrase: string;
  source: "YANDEX_DIRECT_REPORTS_API";
  currency: string;
  vat_treatment: "INCLUDED";
  observed_at: string;
  owner_scope: {
    phrase: "Точное совпадение";
    phrase_value: string;
    geography: string;
    placement: "Результаты поиска";
    strategy: "Максимум кликов";
    season: string;
  };
  qualification: {
    complete_direct_audit: true;
    phrase: "SAME";
    geography: "SAME";
    placement: "SAME";
    strategy: "SAME";
    season: "SAME";
    sample: "SUFFICIENT";
  };
  sample: {
    clicks: number;
    unit: "clicks";
    period_from: string;
    period_to: string;
    daily_cpc: number[];
  };
};

type DirectComparableAudit = {
  status?: unknown;
  graph_complete?: unknown;
  methods_not_read?: unknown;
  observed_at?: unknown;
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function exactSet(left: unknown[], right: unknown[]) {
  const normalized = (values: unknown[]) => [...new Set(values.map(String))].sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function nestedRecord(value: unknown, ...keys: string[]) {
  let current = objectRecord(value);
  for (const key of keys) current = objectRecord(current[key]);
  return current;
}

function parseTsv(value: unknown) {
  const lines = String(value ?? "").split(/\r?\n/u).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, line.split("\t")[index] ?? ""])));
}

function currentAuditSeason(date: string, observedAt: string) {
  const value = Date.parse(`${date}T00:00:00.000Z`);
  const observed = Date.parse(observedAt);
  return Number.isFinite(value) && Number.isFinite(observed)
    && value <= observed
    && value >= observed - 93 * 24 * 60 * 60 * 1_000;
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

export async function qualifyDirectComparableCandidates(input: {
  audit: DirectComparableAudit;
  artifacts: unknown[];
  targetPhrases: string[];
  targetRegionIds: number[];
  targetRegionNames: string[];
  targetPlacement: "SEARCH_RESULTS";
  targetStrategy: "WB_MAXIMUM_CLICKS";
  observedAt: string;
  minimumClicks: number;
  currency: string;
  maximumAuditAgeMs?: number;
}) {
  const methodsNotRead = Array.isArray(input.audit.methods_not_read) ? input.audit.methods_not_read : [];
  const evaluatedAt = Date.parse(input.observedAt);
  const auditObservedAt = Date.parse(String(input.audit.observed_at ?? ""));
  const maximumAuditAgeMs = input.maximumAuditAgeMs ?? 5 * 60_000;
  const auditStale = Number.isFinite(evaluatedAt)
    && Number.isFinite(auditObservedAt)
    && (auditObservedAt > evaluatedAt || evaluatedAt - auditObservedAt > maximumAuditAgeMs);
  const auditFailure = auditStale
    ? "DIRECT_AUDIT_STALE" as const
    : input.audit.status !== "COMPLETE"
      || input.audit.graph_complete !== true
      || methodsNotRead.length > 0
      || !Number.isFinite(evaluatedAt)
      || !Number.isFinite(auditObservedAt)
      ? "COMPLETE_DIRECT_AUDIT_REQUIRED" as const
      : !normalizedText(input.currency)
        ? "DIRECT_CURRENCY_UNAVAILABLE" as const
        : null;
  if (auditFailure) {
    return {
      status: "UNAVAILABLE" as const,
      qualified: [] as DirectComparableCandidate[],
      rejected_count: 0,
      reason: auditFailure,
      rejection_reasons: [{ code: auditFailure, count: 1 }],
      owner_summary: {
        source: "Собственная история Яндекс Директа",
        conclusion: auditFailure === "DIRECT_AUDIT_STALE"
          ? "Сопоставимая стоимость недоступна: полный аудит аккаунта устарел."
          : auditFailure === "DIRECT_CURRENCY_UNAVAILABLE"
            ? "Сопоставимая стоимость недоступна: валюта рекламного аккаунта не подтверждена."
            : "Сопоставимая стоимость недоступна: полный аудит аккаунта не завершён.",
      },
    };
  }
  const records = input.artifacts.map(objectRecord);
  const collectionObjects = (collection: string) => records
    .filter((artifact) => artifact.collection === collection)
    .flatMap((artifact) => Array.isArray(artifact.objects) ? artifact.objects.map(objectRecord) : []);
  const campaigns = new Map(collectionObjects("campaigns").map((item) => [String(item.Id ?? ""), item]));
  const adGroups = new Map(collectionObjects("adgroups").map((item) => [String(item.Id ?? ""), item]));
  const keywords = collectionObjects("keywords");
  const reportArtifacts = records.filter((artifact) => {
    if (artifact.report_type !== "SEARCH_QUERY_PERFORMANCE_REPORT") return false;
    const params = nestedRecord(artifact, "exact_request", "params");
    const criteria = objectRecord(params.SelectionCriteria);
    return params.IncludeVAT === "YES"
      && Number.isFinite(Date.parse(String(criteria.DateFrom ?? "")))
      && Number.isFinite(Date.parse(String(criteria.DateTo ?? "")));
  });
  if (!campaigns.size || !adGroups.size || !keywords.length || !reportArtifacts.length) {
    return {
      status: "UNAVAILABLE" as const,
      qualified: [] as DirectComparableCandidate[],
      rejected_count: keywords.length,
      reason: "COMPLETE_DIRECT_COMPARISON_ARTIFACTS_REQUIRED" as const,
      rejection_reasons: [{ code: "COMPLETE_DIRECT_COMPARISON_ARTIFACTS_REQUIRED" as const, count: Math.max(1, keywords.length) }],
      owner_summary: {
        source: "Собственная история Яндекс Директа",
        conclusion: "Сопоставимая стоимость недоступна: в полном аудите нет всех объектов и выборки для квалификации.",
      },
    };
  }
  const targetPhrases = new Set(input.targetPhrases.map(normalizedPhrase).filter(Boolean));
  const reportRows = reportArtifacts.flatMap((artifact) => parseTsv(artifact.tsv));
  const qualified: DirectComparableCandidate[] = [];
  const rejectionCounts = new Map<string, number>();
  const reject = (code: string) => rejectionCounts.set(code, (rejectionCounts.get(code) ?? 0) + 1);
  for (const keyword of keywords) {
    const keywordId = String(keyword.Id ?? "");
    const campaignId = String(keyword.CampaignId ?? "");
    const adGroupId = String(keyword.AdGroupId ?? "");
    const phrase = normalizedText(keyword.Keyword);
    const campaign = campaigns.get(campaignId);
    const adGroup = adGroups.get(adGroupId);
    if (!keywordId || !campaign || !adGroup) {
      reject("DIRECT_GRAPH_SCOPE_MISSING");
      continue;
    }
    if (!targetPhrases.has(normalizedPhrase(phrase))) {
      reject("PHRASE_INCOMPARABLE");
      continue;
    }
    if (keyword.State !== "ON" || !["ACCEPTED", "DRAFT"].includes(String(keyword.Status ?? ""))) {
      reject("KEYWORD_NOT_ACTIVE");
      continue;
    }
    if (!exactSet(Array.isArray(adGroup.RegionIds) ? adGroup.RegionIds : [], input.targetRegionIds)) {
      reject("GEOGRAPHY_INCOMPARABLE");
      continue;
    }
    const bidding = nestedRecord(campaign, "UnifiedCampaign", "BiddingStrategy");
    const search = objectRecord(bidding.Search);
    const placements = objectRecord(search.PlacementTypes);
    const placementSame = input.targetPlacement === "SEARCH_RESULTS"
      && placements.SearchResults === "YES"
      && placements.ProductGallery !== "YES"
      && objectRecord(bidding.Network).BiddingStrategyType === "SERVING_OFF";
    if (!placementSame) {
      reject("PLACEMENT_INCOMPARABLE");
      continue;
    }
    if (search.BiddingStrategyType !== input.targetStrategy) {
      reject("STRATEGY_INCOMPARABLE");
      continue;
    }
    const rows = reportRows.filter((row) => String(row.CriteriaId ?? "") === keywordId
      && String(row.CampaignId ?? "") === campaignId
      && String(row.AdGroupId ?? "") === adGroupId
      && normalizedPhrase(row.MatchedKeyword) === normalizedPhrase(phrase)
      && currentAuditSeason(String(row.Date ?? ""), input.observedAt));
    const clicks = rows.reduce((sum, row) => sum + (finiteNonNegative(row.Clicks) ?? 0), 0);
    if (clicks < Math.max(1, input.minimumClicks)) {
      reject(rows.length ? "SAMPLE_INSUFFICIENT" : "CURRENT_SEASON_SAMPLE_UNAVAILABLE");
      continue;
    }
    const daily = Map.groupBy(rows, (row) => String(row.Date ?? ""));
    const dailyCpc = [...daily.values()].map((dayRows) => {
      const dayClicks = dayRows.reduce((sum, row) => sum + (finiteNonNegative(row.Clicks) ?? 0), 0);
      const dayCost = dayRows.reduce((sum, row) => sum + (finiteNonNegative(row.Cost) ?? 0), 0);
      return dayClicks > 0 ? Math.round((dayCost / dayClicks) * 100) / 100 : null;
    }).filter((value): value is number => value !== null);
    if (!dailyCpc.length) {
      reject("CPC_SAMPLE_UNAVAILABLE");
      continue;
    }
    const period = rows.map((row) => String(row.Date ?? "")).filter(Boolean).sort();
    const candidateKey = await sha256({
      audit_observed_at: input.audit.observed_at ?? input.observedAt,
      phrase: normalizedPhrase(phrase),
      regions: [...input.targetRegionIds].sort((left, right) => left - right),
      placement: input.targetPlacement,
      strategy: input.targetStrategy,
      period_from: period[0],
      period_to: period.at(-1),
      clicks,
    });
    qualified.push({
      candidate_key: candidateKey,
      keyword_id: keywordId,
      phrase,
      source: "YANDEX_DIRECT_REPORTS_API",
      currency: normalizedText(input.currency),
      vat_treatment: "INCLUDED",
      observed_at: new Date(auditObservedAt).toISOString(),
      owner_scope: {
        phrase: "Точное совпадение",
        phrase_value: phrase,
        geography: input.targetRegionNames.map(normalizedText).join(", "),
        placement: "Результаты поиска",
        strategy: "Максимум кликов",
        season: `${period[0]} — ${period.at(-1)}`,
      },
      qualification: {
        complete_direct_audit: true,
        phrase: "SAME",
        geography: "SAME",
        placement: "SAME",
        strategy: "SAME",
        season: "SAME",
        sample: "SUFFICIENT",
      },
      sample: {
        clicks,
        unit: "clicks",
        period_from: period[0],
        period_to: period.at(-1) ?? period[0],
        daily_cpc: dailyCpc.sort((left, right) => left - right),
      },
    });
  }
  qualified.sort((left, right) => right.sample.clicks - left.sample.clicks || left.candidate_key.localeCompare(right.candidate_key));
  const rejectionReasons = [...rejectionCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => left.code.localeCompare(right.code));
  return {
    status: qualified.length ? "AVAILABLE" as const : "UNAVAILABLE" as const,
    qualified,
    rejected_count: Math.max(0, keywords.length - qualified.length),
    reason: qualified.length ? null : "NO_FULLY_QUALIFIED_COMPARABLE_CANDIDATE" as const,
    rejection_reasons: rejectionReasons,
    owner_summary: {
      source: "Собственная история Яндекс Директа",
      conclusion: qualified.length
        ? `${qualified.length} сопоставимых вариантов прошли проверку фразы, географии, размещения, стратегии, периода и выборки.`
        : "Сопоставимая стоимость недоступна: ни один вариант не прошёл все проверки.",
    },
  };
}

export type CostSource = "LEGACY_LIVE4_SCENARIO" | "KEYWORDBIDS_V5_CURRENT_PROXY" | "DIRECT_HISTORY_OWN_EMPIRICAL";
export type CostObservation = {
  observation_id: string;
  source: CostSource;
  status: "AVAILABLE" | "UNAVAILABLE";
  scenario: string;
  scope: Record<string, unknown>;
  as_of: string;
  currency: string;
  vat_treatment: "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE" | "UNKNOWN";
  sample_size: { unit: string; value: number };
  range: { low: number; high: number; kind: "SCENARIO" | "EMPIRICAL_IQR" } | null;
  qualification: Record<string, unknown>;
  unavailable_reason?: string;
  capacity?: { forecast_clicks: number; forecast_total_spend: number };
};

export function buildOwnHistoryCostObservation(
  candidate: DirectComparableCandidate,
  input: {
    observedAt: string;
    currency: string;
    vatTreatment: CostObservation["vat_treatment"];
  },
): CostObservation {
  const low = percentile(candidate.sample.daily_cpc, 0.25);
  const high = percentile(candidate.sample.daily_cpc, 0.75);
  const available = low !== null && high !== null && candidate.sample.clicks > 0;
  return {
    observation_id: `direct-history:${candidate.candidate_key}:${input.observedAt}`,
    source: "DIRECT_HISTORY_OWN_EMPIRICAL",
    status: available ? "AVAILABLE" : "UNAVAILABLE",
    scenario: "Собственный дневной CPC, межквартильный диапазон",
    scope: {
      phrase: "EXACT",
      geography: "SAME",
      placement: "SAME",
      strategy: "SAME",
      season: "SAME",
      comparison: candidate.owner_scope,
      period_from: candidate.sample.period_from,
      period_to: candidate.sample.period_to,
    },
    as_of: input.observedAt,
    currency: normalizedText(input.currency),
    vat_treatment: input.vatTreatment,
    sample_size: { unit: candidate.sample.unit, value: candidate.sample.clicks },
    range: available ? { low, high, kind: "EMPIRICAL_IQR" } : null,
    qualification: {
      first_party: true,
      clicks: candidate.sample.clicks,
      complete_direct_audit: true,
      phrase: "QUALIFIED",
      geography: "QUALIFIED",
      placement: "QUALIFIED",
      strategy: "QUALIFIED",
      season: "QUALIFIED",
      sample: available ? "QUALIFIED" : "UNAVAILABLE",
    },
    ...(!available ? { unavailable_reason: "DIRECT_HISTORY_SAMPLE_UNAVAILABLE" } : {}),
  };
}

const COST_PRECEDENCE: CostSource[] = [
  "LEGACY_LIVE4_SCENARIO",
  "KEYWORDBIDS_V5_CURRENT_PROXY",
  "DIRECT_HISTORY_OWN_EMPIRICAL",
];

function sameOrMapped(value: unknown) {
  return value === "SAME" || value === "MAPPED";
}

function commonCostQualification(observation: CostObservation) {
  const range = observation.range;
  return observation.status === "AVAILABLE"
    && Boolean(normalizedText(observation.observation_id))
    && Boolean(normalizedText(observation.scenario))
    && Object.keys(observation.scope ?? {}).length > 0
    && Number.isFinite(Date.parse(observation.as_of))
    && Boolean(normalizedText(observation.currency))
    && ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"].includes(observation.vat_treatment)
    && Number.isFinite(observation.sample_size?.value)
    && observation.sample_size.value > 0
    && Boolean(normalizedText(observation.sample_size?.unit))
    && Boolean(range)
    && Number.isFinite(range?.low)
    && Number.isFinite(range?.high)
    && Number(range?.low) >= 0
    && Number(range?.high) >= Number(range?.low);
}

type CostSelectionOptions = {
  evaluatedAt?: string;
  maximumAgeDays?: number;
};

function sourceQualification(observation: CostObservation) {
  if (observation.source === "LEGACY_LIVE4_SCENARIO") {
    return observation.qualification.account_specific === true
      && observation.qualification.capability_status === "AVAILABLE"
      && observation.qualification.exact_scope === true;
  }
  if (observation.source === "KEYWORDBIDS_V5_CURRENT_PROXY") {
    return observation.qualification.current === true
      && observation.qualification.existing_comparable_keyword === true
      && observation.qualification.complete_direct_audit === true
      && observation.qualification.sample === "QUALIFIED"
      && observation.scope.phrase === "EXACT"
      && sameOrMapped(observation.scope.geography)
      && observation.scope.placement === "SAME"
      && observation.scope.strategy === "SAME"
      && observation.scope.season === "SAME";
  }
  return observation.qualification.first_party === true
    && observation.qualification.complete_direct_audit === true
    && Number(observation.qualification.clicks) > 0
    && ["EXACT", "CLUSTER"].includes(String(observation.scope.phrase))
    && sameOrMapped(observation.scope.geography)
    && observation.scope.placement === "SAME"
    && observation.scope.strategy === "SAME"
    && observation.scope.season === "SAME";
}

function costQualificationReasons(observation: CostObservation, options: CostSelectionOptions) {
  const reasons: string[] = [];
  if (!commonCostQualification(observation)) {
    reasons.push(observation.vat_treatment === "UNKNOWN" ? "VAT_TREATMENT_UNKNOWN" : "COST_EVIDENCE_CONTRACT_INCOMPLETE");
  } else if (!sourceQualification(observation)) reasons.push("COST_SCOPE_INCOMPARABLE");
  if (options.evaluatedAt !== undefined) {
    const evaluatedAt = Date.parse(options.evaluatedAt);
    const observedAt = Date.parse(observation.as_of);
    const maximumAgeDays = options.maximumAgeDays ?? 93;
    if (!Number.isFinite(evaluatedAt) || !Number.isFinite(observedAt)) reasons.push("COST_OBSERVATION_DATE_INVALID");
    else if (observedAt > evaluatedAt) reasons.push("FUTURE_COST_OBSERVATION");
    else if (evaluatedAt - observedAt > maximumAgeDays * 24 * 60 * 60 * 1_000) reasons.push("STALE_COST_OBSERVATION");
  }
  return [...new Set(reasons)].sort();
}

function costReason(observation: CostObservation, reasons: string[]) {
  if (observation.unavailable_reason) return normalizedText(observation.unavailable_reason);
  const identity = normalizedText(observation.observation_id) || "unknown";
  if (reasons.includes("STALE_COST_OBSERVATION")) return `STALE_COST_OBSERVATION:${identity}`;
  if (reasons.includes("FUTURE_COST_OBSERVATION")) return `FUTURE_COST_OBSERVATION:${identity}`;
  return `${observation.source}_NOT_QUALIFIED:${identity}`;
}

function comparableCostScope(observation: CostObservation) {
  const scope = observation.scope;
  const comparison = objectRecord(scope.comparison);
  const dimensions = ["phrase", "geography", "placement", "strategy", "season"] as const;
  if (dimensions.some((dimension) => !normalizedText(scope[dimension]))) return null;
  return JSON.stringify({
    ...Object.fromEntries(dimensions.map((dimension) => [dimension, normalizedText(scope[dimension])])),
    phrase_value: normalizedPhrase(comparison.phrase_value),
    comparison_geography: normalizedText(comparison.geography),
    comparison_placement: normalizedText(comparison.placement),
    comparison_strategy: normalizedText(comparison.strategy),
    comparison_season: normalizedText(comparison.season),
  });
}

export function selectCostEvidence(rawObservations: CostObservation[], options: CostSelectionOptions = {}) {
  const observations = [...rawObservations].sort((left, right) => left.source.localeCompare(right.source)
    || right.as_of.localeCompare(left.as_of)
    || left.observation_id.localeCompare(right.observation_id));
  const evaluations = new Map(observations.map((observation) => [observation.observation_id, costQualificationReasons(observation, options)]));
  const qualified = observations.filter((observation) => evaluations.get(observation.observation_id)?.length === 0);
  let selected: CostObservation | null = null;
  for (const source of COST_PRECEDENCE) {
    selected = qualified
      .filter((observation) => observation.source === source)
      .sort((left, right) => right.as_of.localeCompare(left.as_of) || left.observation_id.localeCompare(right.observation_id))[0] ?? null;
    if (selected) break;
  }
  const missingReasons = observations
    .filter((observation) => (evaluations.get(observation.observation_id)?.length ?? 0) > 0)
    .map((observation) => costReason(observation, evaluations.get(observation.observation_id) ?? []));
  const selectedScope = selected ? comparableCostScope(selected) : null;
  const conflicting = selected ? qualified.some((observation) => observation.observation_id !== selected?.observation_id
    && selectedScope !== null
    && comparableCostScope(observation) === selectedScope
    && observation.currency === selected?.currency
    && observation.vat_treatment === selected?.vat_treatment
    && Boolean(observation.range && selected?.range)
    && (Number(observation.range?.high) < Number(selected?.range?.low) || Number(selected?.range?.high) < Number(observation.range?.low))) : false;
  if (conflicting) missingReasons.push("CONFLICTING_COST_EVIDENCE");
  const candidateDispositions = observations.map((observation) => {
    const reasonCodes = evaluations.get(observation.observation_id) ?? [];
    return {
      observation_id: observation.observation_id,
      source: observation.source,
      disposition: reasonCodes.length
        ? "REJECTED" as const
        : conflicting && comparableCostScope(observation) === selectedScope
          ? "CONFLICTING" as const
          : observation.observation_id === selected?.observation_id
            ? "SELECTED" as const
            : "QUALIFIED_NOT_SELECTED" as const,
      reason_codes: reasonCodes.length ? reasonCodes : conflicting && comparableCostScope(observation) === selectedScope ? ["CONFLICTING_COST_EVIDENCE"] : [],
    };
  });
  if (!selected || conflicting) {
    if (!observations.length) missingReasons.push("NO_QUALIFIED_PRELAUNCH_COST_SOURCE");
    return {
      status: "UNAVAILABLE" as const,
      compact_source: null,
      selected_observation_id: null,
      scenario: null,
      scope: null,
      as_of: null,
      currency: null,
      vat_treatment: null,
      sample_size: null,
      range: null,
      aggregation: "FIRST_QUALIFIED_SOURCE_NO_AVERAGING" as const,
      evaluated_at: options.evaluatedAt ?? null,
      maximum_age_days: options.evaluatedAt === undefined ? null : options.maximumAgeDays ?? 93,
      observations,
      candidate_dispositions: candidateDispositions,
      missing_or_conflict_reasons: [...new Set(missingReasons)],
    };
  }
  return {
    status: "AVAILABLE" as const,
    compact_source: selected.source,
    selected_observation_id: selected.observation_id,
    scenario: selected.scenario,
    scope: selected.scope,
    as_of: selected.as_of,
    currency: selected.currency,
    vat_treatment: selected.vat_treatment,
    sample_size: selected.sample_size,
    range: selected.range,
    aggregation: "FIRST_QUALIFIED_SOURCE_NO_AVERAGING" as const,
    evaluated_at: options.evaluatedAt ?? null,
    maximum_age_days: options.evaluatedAt === undefined ? null : options.maximumAgeDays ?? 93,
    observations,
    candidate_dispositions: candidateDispositions,
    missing_or_conflict_reasons: [...new Set(missingReasons)],
  };
}

const DIRECT_COST_ENDPOINTS = {
  keywords: "https://api.direct.yandex.com/json/v501/keywords",
  keyword_bids: "https://api.direct.yandex.com/json/v501/keywordbids",
} as const;

function unavailableAuctionObservation(input: {
  account: string;
  keyword_id: string;
  candidate_key?: string;
  expected_phrase: string;
  currency: string;
  vat_treatment: CostObservation["vat_treatment"];
  comparability: { geography: unknown; placement: unknown; strategy: unknown; season: unknown };
  comparison_scope?: Record<string, unknown>;
  sample_clicks?: number;
}, observedAt: string, reason: string): CostObservation {
  return {
    observation_id: `keywordbids:${input.candidate_key ?? "unavailable"}:${observedAt}`,
    source: "KEYWORDBIDS_V5_CURRENT_PROXY",
    status: "UNAVAILABLE",
    scenario: "current auction proxy for an existing comparable keyword",
    scope: {
      phrase: "UNKNOWN",
      ...input.comparability,
      ...(input.comparison_scope ? { comparison: input.comparison_scope } : {}),
    },
    as_of: observedAt,
    currency: input.currency,
    vat_treatment: input.vat_treatment,
    sample_size: { unit: "auction_scenarios", value: 0 },
    range: null,
    qualification: { current: false, existing_comparable_keyword: false },
    unavailable_reason: reason,
  };
}

export async function collectCurrentAuctionCostObservation(input: {
  token: string;
  account: string;
  keyword_id: string;
  candidate_key?: string;
  expected_phrase: string;
  currency: string;
  vat_treatment: CostObservation["vat_treatment"];
  traffic_volumes: number[];
  comparability: { geography: "SAME" | "MAPPED" | "DIFFERENT" | "UNKNOWN"; placement: "SAME" | "DIFFERENT" | "UNKNOWN"; strategy: "SAME" | "DIFFERENT" | "UNKNOWN"; season: "SAME" | "DIFFERENT" | "UNKNOWN" };
  comparison_scope?: Record<string, unknown>;
  complete_direct_audit?: boolean;
  sample_clicks?: number;
}, fetchImpl: FetchLike, now: () => string): Promise<CostObservation> {
  const observedAt = now();
  if (!normalizedText(input.token) || !normalizedText(input.account) || !/^\d+$/u.test(input.keyword_id)) {
    return unavailableAuctionObservation(input, observedAt, "KEYWORDBIDS_AUTHORITY_OR_KEYWORD_ID_UNAVAILABLE");
  }
  const headers = {
    Authorization: `Bearer ${input.token}`,
    "Client-Login": input.account,
    Accept: "application/json",
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  try {
    const keywordResponse = await fetchImpl(DIRECT_COST_ENDPOINTS.keywords, {
      method: "POST",
      redirect: "error",
      headers,
      body: JSONbig.stringify({
        method: "get",
        params: {
          SelectionCriteria: { Ids: [BigInt(input.keyword_id)] },
          FieldNames: ["Id", "Keyword", "AdGroupId", "CampaignId", "State", "Status"],
        },
      }),
    });
    if (!keywordResponse.ok) return unavailableAuctionObservation(input, observedAt, `KEYWORDS_GET_HTTP_${keywordResponse.status}`);
    const keywordPayload = JSONbig.parse(await keywordResponse.text()) as {
      error?: unknown;
      result?: { Keywords?: Array<Record<string, unknown>> };
    };
    const keywords = keywordPayload.result?.Keywords ?? [];
    const keyword = keywords.find((item) => String(item.Id ?? "") === input.keyword_id);
    if (keywordPayload.error || !keyword || normalizedPhrase(keyword.Keyword) !== normalizedPhrase(input.expected_phrase)) {
      return unavailableAuctionObservation(input, observedAt, "EXISTING_KEYWORD_NOT_NORMALIZED_EQUIVALENT");
    }
    const bidsResponse = await fetchImpl(DIRECT_COST_ENDPOINTS.keyword_bids, {
      method: "POST",
      redirect: "error",
      headers,
      body: JSONbig.stringify({
        method: "get",
        params: {
          SelectionCriteria: { KeywordIds: [BigInt(input.keyword_id)] },
          FieldNames: ["KeywordId", "AuctionBids"],
        },
      }),
    });
    if (!bidsResponse.ok) return unavailableAuctionObservation(input, observedAt, `KEYWORDBIDS_GET_HTTP_${bidsResponse.status}`);
    const bidsPayload = JSONbig.parse(await bidsResponse.text()) as {
      error?: unknown;
      result?: { KeywordBids?: Array<Record<string, unknown>> };
    };
    const keywordBid = (bidsPayload.result?.KeywordBids ?? []).find((item) => String(item.KeywordId ?? "") === input.keyword_id);
    const auctionBids = Array.isArray(keywordBid?.AuctionBids) ? keywordBid.AuctionBids as Array<Record<string, unknown>> : [];
    const allowed = new Set(input.traffic_volumes.map(Number));
    const prices = auctionBids
      .filter((item) => allowed.size === 0 || allowed.has(Number(item.TrafficVolume)))
      .map((item) => Number(item.Price) / 1_000_000)
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (bidsPayload.error || !prices.length) {
      return unavailableAuctionObservation(input, observedAt, "KEYWORDBIDS_AUCTION_BIDS_UNAVAILABLE");
    }
    return {
      observation_id: `keywordbids:${input.candidate_key ?? await sha256({ phrase: normalizedPhrase(input.expected_phrase), observed_at: observedAt })}:${observedAt}`,
      source: "KEYWORDBIDS_V5_CURRENT_PROXY",
      status: "AVAILABLE",
      scenario: `Direct auction traffic volumes ${[...allowed].sort((left, right) => left - right).join(",") || "all returned"}`,
      scope: {
        phrase: "EXACT",
        ...input.comparability,
        ...(input.comparison_scope ? { comparison: input.comparison_scope } : {}),
      },
      as_of: observedAt,
      currency: input.currency,
      vat_treatment: input.vat_treatment,
      sample_size: { unit: "auction_scenarios", value: prices.length },
      range: { low: Math.min(...prices), high: Math.max(...prices), kind: "SCENARIO" },
      qualification: {
        current: true,
        existing_comparable_keyword: true,
        complete_direct_audit: input.complete_direct_audit === true,
        sample: Number(input.sample_clicks) > 0 ? "QUALIFIED" : "UNAVAILABLE",
      },
    };
  } catch {
    return unavailableAuctionObservation(input, observedAt, "KEYWORDBIDS_PROVIDER_ERROR");
  }
}

export type DemandRelationshipState = "EXACT_DUPLICATE" | "NEAR_DUPLICATE" | "ALREADY_COVERED_DEMAND" | "OVERLAP_RISK" | "OBSERVED_CANNIBALIZATION" | "UNKNOWN";

export function classifyDemandRelationship(input: {
  left: string;
  right: string;
  near_duplicate?: boolean;
  already_covered?: boolean;
  overlap_signal?: boolean;
  observed_cannibalization?: {
    first_party?: boolean;
    evidence_id?: string;
    period_from?: string;
    period_to?: string;
    metric?: string;
  };
}) {
  const observed = input.observed_cannibalization;
  const observedQualified = observed?.first_party === true
    && Boolean(normalizedText(observed.evidence_id))
    && Number.isFinite(Date.parse(String(observed.period_from)))
    && Number.isFinite(Date.parse(String(observed.period_to)))
    && Boolean(normalizedText(observed.metric));
  let state: DemandRelationshipState = "UNKNOWN";
  if (observedQualified) state = "OBSERVED_CANNIBALIZATION";
  else if (normalizedPhrase(input.left) === normalizedPhrase(input.right)) state = "EXACT_DUPLICATE";
  else if (input.near_duplicate === true) state = "NEAR_DUPLICATE";
  else if (input.already_covered === true) state = "ALREADY_COVERED_DEMAND";
  else if (input.overlap_signal === true) state = "OVERLAP_RISK";
  return {
    state,
    query_overlap_proves_cannibalization: false,
    observed_evidence_id: state === "OBSERVED_CANNIBALIZATION" ? observed?.evidence_id : null,
  };
}

export type DeliveryKeyInput = {
  goal: unknown;
  economics: unknown;
  geography: unknown;
  landing: unknown;
  message: unknown;
  management: unknown;
};

function normalizedDimension(value: unknown) {
  if (value && typeof value === "object") return JSON.stringify(canonicalize(value)).toLocaleLowerCase("ru-RU");
  return normalizedPhrase(value);
}

function normalizedLanding(value: unknown) {
  try {
    const url = new URL(normalizedText(value));
    if (url.protocol !== "https:") return normalizedDimension(value);
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return normalizedDimension(value);
  }
}

export function normalizeDeliveryKey(input: DeliveryKeyInput) {
  return {
    goal: normalizedDimension(input.goal),
    economics: normalizedDimension(input.economics),
    geography: normalizedDimension(input.geography),
    landing: normalizedLanding(input.landing),
    message: normalizedDimension(input.message),
    management: normalizedDimension(input.management),
  };
}

export type PackableDemandCluster = {
  cluster_id: string;
  primary?: boolean;
  demand_status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  unique_publish_row_ids: string[];
  delivery_key: DeliveryKeyInput;
  provisional_monthly_budget: number;
  relationship_state?: DemandRelationshipState;
  capacity?: {
    status: "AVAILABLE" | "UNAVAILABLE";
    source: "LEGACY_LIVE4_SCENARIO" | "OWN_CALIBRATED_VOLUME_MODEL" | "KEYWORDBIDS_V5_CURRENT_PROXY" | null;
    scope?: "DEDUPLICATED_DELIVERY_PACK";
    demand_cluster_ids?: string[];
    forecast_clicks?: number;
    forecast_total_spend?: number;
  };
};

function capacityDecision(group: PackableDemandCluster[]) {
  const clusterIds = group.map((cluster) => cluster.cluster_id).sort();
  const capacity = group.map((cluster) => cluster.capacity).find((candidate) => candidate?.scope === "DEDUPLICATED_DELIVERY_PACK"
    && JSON.stringify([...(candidate.demand_cluster_ids ?? [])].sort()) === JSON.stringify(clusterIds));
  if (!capacity || capacity.status !== "AVAILABLE") return { supported: false, sufficient: false, reason: "STANDALONE_CAPACITY_UNAVAILABLE" };
  if (!(["LEGACY_LIVE4_SCENARIO", "OWN_CALIBRATED_VOLUME_MODEL"] as unknown[]).includes(capacity.source)) {
    return { supported: false, sufficient: false, reason: "CAPACITY_SOURCE_NOT_QUALIFIED" };
  }
  const clicks = Number(capacity.forecast_clicks);
  const spend = Number(capacity.forecast_total_spend);
  const provisionalMonthlyBudget = Math.max(...group.map((item) => Number(item.provisional_monthly_budget)));
  if (!Number.isFinite(clicks) || !Number.isFinite(spend)) return { supported: false, sufficient: false, reason: "STANDALONE_CAPACITY_UNAVAILABLE" };
  return {
    supported: true,
    sufficient: clicks > 0 && spend >= provisionalMonthlyBudget,
    reason: clicks > 0 && spend >= provisionalMonthlyBudget
      ? "EVIDENCE_BACKED_STANDALONE_CAPACITY"
      : "INSUFFICIENT_STANDALONE_CAPACITY",
  };
}

export async function packDemandClusters(input: PackableDemandCluster[]) {
  const clusters = [...input].sort((left, right) => left.cluster_id.localeCompare(right.cluster_id));
  const prepared = await Promise.all(clusters.map(async (cluster) => {
    const deliveryKey = normalizeDeliveryKey(cluster.delivery_key);
    return { ...cluster, normalized_delivery_key: deliveryKey, fingerprint: await sha256(deliveryKey) };
  }));
  const eligibleForGroups = prepared.filter((cluster) => cluster.demand_status !== "UNAVAILABLE"
    && cluster.unique_publish_row_ids.length > 0
    && !["EXACT_DUPLICATE", "NEAR_DUPLICATE", "ALREADY_COVERED_DEMAND"].includes(cluster.relationship_state ?? "UNKNOWN"));
  const byKey = Map.groupBy(eligibleForGroups, (cluster) => cluster.fingerprint);
  const groups = [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right));
  const explicitPrimary = prepared.find((cluster) => cluster.primary);
  const primaryFingerprint = explicitPrimary?.fingerprint ?? groups[0]?.[0] ?? null;
  const deliveryBuckets: Array<Record<string, unknown>> = [];
  const clusterDispositions: Record<string, { disposition: "PACKED" | "STANDALONE" | "HIDDEN" | "EVIDENCE_GAP"; reason_codes: string[]; delivery_bucket_id: string | null }> = {};

  for (const cluster of prepared) {
    if (cluster.demand_status === "UNAVAILABLE") {
      clusterDispositions[cluster.cluster_id] = { disposition: "EVIDENCE_GAP", reason_codes: ["DEMAND_EVIDENCE_UNAVAILABLE"], delivery_bucket_id: null };
    } else if (!cluster.unique_publish_row_ids.length || ["EXACT_DUPLICATE", "NEAR_DUPLICATE", "ALREADY_COVERED_DEMAND"].includes(cluster.relationship_state ?? "UNKNOWN")) {
      clusterDispositions[cluster.cluster_id] = { disposition: "HIDDEN", reason_codes: ["DUPLICATE_OR_ALREADY_COVERED"], delivery_bucket_id: null };
    }
  }

  for (const [fingerprint, group] of groups) {
    const clusterIds = group.map((cluster) => cluster.cluster_id).sort();
    const bucketId = `delivery-bucket:${fingerprint.slice("sha256:".length, "sha256:".length + 20)}`;
    if (fingerprint === primaryFingerprint) {
      deliveryBuckets.push({
        delivery_bucket_id: bucketId,
        delivery_key: group[0].normalized_delivery_key,
        delivery_key_fingerprint: fingerprint,
        demand_cluster_ids: clusterIds,
        disposition: "PACKED",
        reason_codes: [clusterIds.length > 1 ? "COMPATIBLE_LONG_TAIL_PACKED" : "PRIMARY_DELIVERY_BUCKET"],
      });
      for (const cluster of group) clusterDispositions[cluster.cluster_id] = { disposition: "PACKED", reason_codes: ["DELIVERY_KEY_COMPATIBLE"], delivery_bucket_id: bucketId };
      continue;
    }
    const capacity = capacityDecision(group);
    if (capacity.supported && capacity.sufficient) {
      deliveryBuckets.push({
        delivery_bucket_id: bucketId,
        delivery_key: group[0].normalized_delivery_key,
        delivery_key_fingerprint: fingerprint,
        demand_cluster_ids: clusterIds,
        disposition: "STANDALONE",
        reason_codes: [capacity.reason],
      });
      for (const cluster of group) clusterDispositions[cluster.cluster_id] = { disposition: "STANDALONE", reason_codes: ["MATERIAL_DELIVERY_KEY_DIFFERENCE", capacity.reason], delivery_bucket_id: bucketId };
    } else {
      const disposition = capacity.supported ? "HIDDEN" : "EVIDENCE_GAP";
      for (const cluster of group) clusterDispositions[cluster.cluster_id] = {
        disposition,
        reason_codes: ["MATERIAL_DELIVERY_KEY_DIFFERENCE", capacity.reason],
        delivery_bucket_id: null,
      };
    }
  }
  return {
    contract_version: "delivery-packing-v1",
    delivery_buckets: deliveryBuckets.sort((left, right) => String(left.delivery_bucket_id).localeCompare(String(right.delivery_bucket_id))),
    cluster_dispositions: Object.fromEntries(Object.entries(clusterDispositions).sort(([left], [right]) => left.localeCompare(right))),
    semantics: {
      full_delivery_key: ["goal", "economics", "geography", "landing", "message", "management"],
      compatible_long_tail_suppressed: false,
      split_requires_material_difference_and_evidence_backed_capacity: true,
    },
  };
}

export type MarketEvidenceInput = {
  research_plan?: DemandCostResearchPlan;
  wordstat_batch: WordstatObservationBatch;
  demand_clusters: DemandClusterSpec[];
  cost_observations: CostObservation[];
  relationship_observations?: Array<ReturnType<typeof classifyDemandRelationship> & { left_cluster_id: string; right_cluster_id: string }>;
};

function containsSensitiveMarketInput(value: unknown): boolean {
  if (typeof value === "string") return /(?:Bearer|OAuth|Api-Key)\s+[^\s,;]+/iu.test(value);
  if (Array.isArray(value)) return value.some(containsSensitiveMarketInput);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    (/(?:^|_)(?:authorization|cookie|credential|oauth|access_token|oauth_token|password|passwd|secret|api_key)(?:$|_)/iu.test(key)
      || /wordstat.*client.*id/iu.test(key))
    || containsSensitiveMarketInput(item));
}

export async function buildMarketEvidence(input: MarketEvidenceInput) {
  if (containsSensitiveMarketInput(input)) throw new Error("Market evidence contains credential-bearing input and cannot be persisted.");
  const frequency = await buildScopedDemandEvidence(input.wordstat_batch, input.demand_clusters);
  const costEvaluationAt = [
    input.wordstat_batch.batch_finished_at,
    ...(input.cost_observations ?? []).map((observation) => observation.as_of),
  ].filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1) ?? input.wordstat_batch.batch_finished_at;
  const cost = selectCostEvidence(input.cost_observations ?? [], { evaluatedAt: costEvaluationAt, maximumAgeDays: 93 });
  const relationshipAssessments = input.relationship_observations?.length
    ? input.relationship_observations
    : input.demand_clusters.map((cluster) => ({
        left_cluster_id: cluster.cluster_id,
        right_cluster_id: "current-direct-demand",
        ...classifyDemandRelationship({ left: cluster.cluster_id, right: "current-direct-demand" }),
      }));
  return {
    contract_version: MARKET_EVIDENCE_CONTRACT,
    research_plan: input.research_plan ?? null,
    snapshot_batch_id: input.wordstat_batch.batch_id,
    batch_started_at: input.wordstat_batch.batch_started_at,
    batch_finished_at: input.wordstat_batch.batch_finished_at,
    frequency,
    cost,
    overlap: {
      taxonomy: [
        "EXACT_DUPLICATE",
        "NEAR_DUPLICATE",
        "ALREADY_COVERED_DEMAND",
        "OVERLAP_RISK",
        "OBSERVED_CANNIBALIZATION",
        "UNKNOWN",
      ] as DemandRelationshipState[],
      assessments: [...relationshipAssessments].sort((left, right) => left.left_cluster_id.localeCompare(right.left_cluster_id)
        || left.right_cluster_id.localeCompare(right.right_cluster_id)),
      query_overlap_proves_cannibalization: false,
    },
    packing: {
      status: "AWAITING_APPROVED_CAMPAIGN_STRATEGY" as const,
      demand_cluster_ids: input.demand_clusters.map((cluster) => cluster.cluster_id).sort(),
      delivery_key_dimensions: ["goal", "economics", "geography", "landing", "message", "management"],
      policy: "Compatible long-tail is packed; material split requires evidence-backed standalone capacity.",
    },
  };
}

export async function unavailableWordstatBatch(
  reason: string,
  generatedAt: string,
  code = "WORDSTAT_AUTHORITY_UNAVAILABLE",
): Promise<WordstatObservationBatch> {
  const batchId = await sha256({ source: "YANDEX_WORDSTAT_V1", generated_at: generatedAt, unavailable: normalizedText(reason) });
  return {
    schema_version: WORDSTAT_BATCH_SCHEMA,
    source: "YANDEX_WORDSTAT_V1",
    batch_id: batchId,
    batch_started_at: generatedAt,
    batch_finished_at: generatedAt,
    declared_window: "rolling_last_30_days",
    source_window_end: "undisclosed_by_api",
    calls: [{
      call_id: `${batchId}:unavailable:top_requests`,
      batch_id: batchId,
      seed_id: "unavailable",
      cluster_id: "unavailable",
      method: "top_requests",
      endpoint: WORDSTAT_ENDPOINTS.top_requests,
      requested_at: generatedAt,
      status: "UNAVAILABLE",
      operator_profile: "BROAD_CONTAINING",
      canonical_phrase: "",
      period: null,
      from_date: null,
      to_date: null,
      scope: { region_ids: [], region_names: [], device: "all", region_filter_applied: true },
      request_fingerprint: await sha256({ endpoint: WORDSTAT_ENDPOINTS.top_requests, unavailable: true }),
      rows: [],
      gaps: [{ code, detail: normalizedText(reason) || "Wordstat evidence unavailable.", retry_after_seconds: null }],
    }],
  };
}
