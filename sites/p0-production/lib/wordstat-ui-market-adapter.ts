import {
  WORDSTAT_BATCH_SCHEMA,
  type DemandCostResearchPlan,
  type WordstatCall,
  type WordstatObservationBatch,
} from "./market-evidence.ts";

const UI_ENDPOINT = "https://wordstat.yandex.com/";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function finite(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Wordstat UI observation contains an invalid number.");
  return number;
}

function exactObservation(batch: UnknownRecord, seedId: string, surface: string) {
  const matches = list(batch.observations).map(record)
    .filter((observation) => observation.seed_id === seedId && observation.surface === surface);
  if (matches.length !== 1) throw new Error(`Wordstat UI batch is missing exact ${surface} evidence for ${seedId}.`);
  return matches[0];
}

function exactScope(observation: UnknownRecord, seed: DemandCostResearchPlan["seeds"][number]) {
  const scope = record(observation.scope);
  const regionIds = list(scope.provider_region_ids).map(Number);
  const regionNames = list(scope.region_labels).map(text);
  const expectedDevice = seed.device === "all" ? "ALL"
    : seed.device === "desktop" ? "DESKTOP"
      : seed.device === "phone" ? "SMARTPHONE" : "TABLET";
  if (JSON.stringify(regionIds) !== JSON.stringify(seed.region_ids)
    || JSON.stringify(regionNames) !== JSON.stringify(seed.region_names)
    || scope.device !== expectedDevice) {
    throw new Error("Wordstat UI observation scope differs from the frozen demand research plan.");
  }
  return {
    region_ids: regionIds,
    region_names: regionNames,
    device: seed.device,
  };
}

function baseCall(
  batch: UnknownRecord,
  seed: DemandCostResearchPlan["seeds"][number],
  observation: UnknownRecord,
  method: WordstatCall["method"],
): Omit<WordstatCall, "rows"> {
  const scope = exactScope(observation, seed);
  return {
    call_id: `${text(batch.batch_id)}:${seed.seed_id}:${method}:ui`,
    batch_id: text(batch.batch_id),
    seed_id: seed.seed_id,
    cluster_id: seed.cluster_id,
    method,
    endpoint: UI_ENDPOINT,
    requested_at: text(observation.observed_at),
    status: "AVAILABLE",
    operator_profile: method === "dynamics" ? "DYNAMICS_BROAD" : seed.operator_profile,
    canonical_phrase: method === "dynamics" ? seed.dynamics_phrase : seed.phrase,
    period: method === "dynamics" ? seed.dynamics_period : null,
    from_date: method === "dynamics" ? seed.dynamics_from_date : null,
    to_date: method === "dynamics" ? seed.dynamics_to_date : null,
    scope: {
      ...scope,
      region_filter_applied: method !== "regions",
    },
    request_fingerprint: text(observation.request_fingerprint),
    gaps: [],
  };
}

function topRows(observation: UnknownRecord) {
  return list(observation.rows).map(record).map((row) => ({
    phrase: text(row.phrase),
    count: finite(row.count),
  })).filter((row) => row.phrase);
}

function dynamicsRows(observation: UnknownRecord) {
  return list(observation.rows).map(record).map((row) => ({
    date: text(row.period_start),
    count: finite(row.count),
    share: finite(row.share),
  })).filter((row) => row.date);
}

function regionRows(observation: UnknownRecord) {
  return list(observation.rows).map(record).map((row) => ({
    region_id: finite(row.provider_region_id),
    region_name: text(row.region_label),
    count: finite(row.count),
    share: finite(row.share),
    affinity_index: finite(row.affinity_index),
  })).filter((row) => row.region_name);
}

export function adaptCompleteWordstatUiBatch(
  value: unknown,
  researchPlan: DemandCostResearchPlan,
): WordstatObservationBatch {
  const batch = record(value);
  if (batch.schema_version !== "wordstat-ui-observation-batch-v1"
    || batch.source !== "YANDEX_WORDSTAT_UI"
    || batch.transport !== "HEADLESS_PLAYWRIGHT"
    || batch.status !== "COMPLETE"
    || batch.cleanup_status !== "COMPLETE") {
    throw new Error("Only a complete cleaned headless Wordstat UI batch can enter market evidence.");
  }
  const calls: WordstatCall[] = [];
  const declaredWindows = new Set<string>();
  for (const seed of researchPlan.seeds) {
    const popular = exactObservation(batch, seed.seed_id, "TOP_POPULAR");
    exactObservation(batch, seed.seed_id, "TOP_SIMILAR");
    const dynamics = exactObservation(batch, seed.seed_id, "DYNAMICS");
    const regions = exactObservation(batch, seed.seed_id, "REGIONS");
    for (const observation of [popular, dynamics, regions]) {
      const declared = text(record(observation.scope).declared_window);
      if (declared) declaredWindows.add(declared);
    }
    const top = topRows(popular);
    const dynamic = dynamicsRows(dynamics);
    const regional = regionRows(regions);
    if (!top.length || !dynamic.length || !regional.length) {
      throw new Error("Complete Wordstat UI evidence must contain non-empty canonical rows for every required surface.");
    }
    calls.push(
      { ...baseCall(batch, seed, popular, "top_requests"), rows: top },
      { ...baseCall(batch, seed, dynamics, "dynamics"), rows: dynamic },
      { ...baseCall(batch, seed, regions, "regions"), rows: regional },
    );
  }
  return {
    schema_version: WORDSTAT_BATCH_SCHEMA,
    source: "YANDEX_WORDSTAT_UI",
    batch_id: text(batch.batch_id),
    batch_started_at: text(batch.batch_started_at),
    batch_finished_at: text(batch.batch_finished_at),
    declared_window: [...declaredWindows].sort().join(" | "),
    source_window_end: "disclosed_by_wordstat_ui",
    calls,
  };
}
