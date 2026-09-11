import {
  WORDSTAT_BATCH_SCHEMA,
  type DemandCostResearchPlan,
  type WordstatCall,
  type WordstatObservationBatch,
} from "./market-evidence.ts";

const UI_ENDPOINT = "https://wordstat.yandex.com/";

type UnknownRecord = Record<string, unknown>;
type ResearchSeed = DemandCostResearchPlan["seeds"][number];
type DiscoveryMetadata = NonNullable<WordstatObservationBatch["discovery"]>;

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

function exactScope(observation: UnknownRecord, seed: ResearchSeed) {
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
  seed: ResearchSeed,
  observation: UnknownRecord,
  method: WordstatCall["method"],
  providerSurface: NonNullable<WordstatCall["provider_surface"]>,
): Omit<WordstatCall, "rows"> {
  const scope = exactScope(observation, seed);
  const observedRows = list(observation.rows);
  const explicitEmpty = observation.result_state === "NO_ROWS_RETURNED"
    && observation.explicit_empty_state === true
    && observedRows.length === 0;
  return {
    call_id: `${text(batch.batch_id)}:${seed.seed_id}:${method}:${providerSurface.toLocaleLowerCase("en-US")}:ui`,
    batch_id: text(batch.batch_id),
    collection_id: text(batch.batch_id),
    seed_id: seed.seed_id,
    cluster_id: seed.cluster_id,
    method,
    provider_surface: providerSurface,
    endpoint: UI_ENDPOINT,
    requested_at: text(observation.observed_at),
    status: "AVAILABLE",
    operator_profile: method === "dynamics" ? "DYNAMICS_BROAD" : seed.operator_profile,
    canonical_phrase: method === "dynamics" ? seed.dynamics_phrase : seed.phrase,
    collection_purpose: seed.collection_purpose ?? "DISCOVERY",
    discovery_depth: seed.discovery_depth ?? 0,
    parent_seed_id: seed.parent_seed_id ?? null,
    period: method === "dynamics" ? seed.dynamics_period : null,
    from_date: method === "dynamics" ? seed.dynamics_from_date : null,
    to_date: method === "dynamics" ? seed.dynamics_to_date : null,
    scope: {
      ...scope,
      region_filter_applied: method !== "regions",
    },
    request_fingerprint: text(observation.request_fingerprint),
    gaps: explicitEmpty ? [{
      code: "WORDSTAT_NO_ROWS_RETURNED",
      detail: "Wordstat UI returned a confirmed empty surface; absent rows remain unknown and are not zero demand.",
      retry_after_seconds: null,
    }] : [],
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

function confirmedRows(observation: UnknownRecord, rows: unknown[]) {
  if (rows.length) return rows;
  if (observation.result_state === "NO_ROWS_RETURNED"
    && observation.explicit_empty_state === true
    && list(observation.rows).length === 0) return rows;
  throw new Error("Complete Wordstat UI evidence must contain canonical rows or a confirmed explicit empty state.");
}

function validateBatch(value: unknown) {
  const batch = record(value);
  if (batch.schema_version !== "wordstat-ui-observation-batch-v1"
    || batch.source !== "YANDEX_WORDSTAT_UI"
    || batch.transport !== "HEADLESS_PLAYWRIGHT"
    || batch.status !== "COMPLETE"
    || batch.cleanup_status !== "COMPLETE") {
    throw new Error("Only a complete cleaned headless Wordstat UI batch can enter market evidence.");
  }
  return batch;
}

function callsFromBatch(batch: UnknownRecord, seedById: Map<string, ResearchSeed>) {
  const calls: WordstatCall[] = [];
  const declaredWindows = new Set<string>();
  const observationKeys = new Set<string>();
  for (const value of list(batch.observations)) {
    const observation = record(value);
    const seedId = text(observation.seed_id);
    const surface = text(observation.surface) as NonNullable<WordstatCall["provider_surface"]>;
    const seed = seedById.get(seedId);
    if (!seed) throw new Error(`Wordstat UI batch contains an unknown runtime seed: ${seedId}.`);
    if (!["TOP_POPULAR", "TOP_SIMILAR", "DYNAMICS", "REGIONS"].includes(surface)) {
      throw new Error(`Wordstat UI batch contains an unsupported surface: ${surface}.`);
    }
    const observationKey = `${seedId}:${surface}`;
    if (observationKeys.has(observationKey)) throw new Error(`Wordstat UI batch repeats ${observationKey}.`);
    observationKeys.add(observationKey);
    const declared = text(record(observation.scope).declared_window);
    if (declared) declaredWindows.add(declared);
    if (surface === "TOP_POPULAR" || surface === "TOP_SIMILAR") {
      calls.push({
        ...baseCall(batch, seed, observation, "top_requests", surface),
        rows: confirmedRows(observation, topRows(observation)) as ReturnType<typeof topRows>,
      });
    } else if (surface === "DYNAMICS") {
      calls.push({
        ...baseCall(batch, seed, observation, "dynamics", surface),
        rows: confirmedRows(observation, dynamicsRows(observation)) as ReturnType<typeof dynamicsRows>,
      });
    } else {
      calls.push({
        ...baseCall(batch, seed, observation, "regions", surface),
        rows: confirmedRows(observation, regionRows(observation)) as ReturnType<typeof regionRows>,
      });
    }
  }
  return { calls, declaredWindows };
}

/** Check one exact completed phase before its rows can justify more source reads. */
export function assertCompleteWordstatUiPhase(
  value: unknown,
  seeds: ResearchSeed[],
  surfaces: readonly NonNullable<WordstatCall["provider_surface"]>[],
) {
  const batch = validateBatch(value);
  const seedById = new Map(seeds.map((seed) => [seed.seed_id, seed]));
  if (seedById.size !== seeds.length) throw new Error("Wordstat phase seed identifiers must be unique.");
  callsFromBatch(batch, seedById);
  const expected = new Set(seeds.flatMap((seed) => surfaces.map((surface) => `${seed.seed_id}:${surface}`)));
  const observed = list(batch.observations).map(record).map((item) => `${text(item.seed_id)}:${text(item.surface)}`);
  if (observed.length !== expected.size || observed.some((key) => !expected.has(key))) {
    throw new Error("Complete Wordstat phase does not cover its exact planned seeds and surfaces.");
  }
}

export function adaptCompleteWordstatUiBatches(
  values: unknown[],
  seeds: ResearchSeed[],
  discovery: DiscoveryMetadata,
): WordstatObservationBatch {
  if (!values.length) throw new Error("At least one complete Wordstat UI phase is required.");
  const seedById = new Map(seeds.map((seed) => [seed.seed_id, seed]));
  if (seedById.size !== seeds.length) throw new Error("Wordstat runtime seed identifiers must be unique.");
  const batches = values.map(validateBatch);
  const batchIds = batches.map((batch) => text(batch.batch_id));
  const collectionId = batches.length === 1
    ? batchIds[0]
    : `wordstat-ui-composite:${batchIds.length}:${batchIds[0]}:${batchIds.at(-1)}`;
  const calls: WordstatCall[] = [];
  const declaredWindows = new Set<string>();
  for (const batch of batches) {
    const adapted = callsFromBatch(batch, seedById);
    calls.push(...adapted.calls.map((call) => ({ ...call, collection_id: collectionId })));
    for (const window of adapted.declaredWindows) declaredWindows.add(window);
  }
  const started = batches.map((batch) => text(batch.batch_started_at)).sort()[0];
  const finished = batches.map((batch) => text(batch.batch_finished_at)).sort().at(-1);
  return {
    schema_version: WORDSTAT_BATCH_SCHEMA,
    source: "YANDEX_WORDSTAT_UI",
    batch_id: collectionId,
    batch_started_at: started,
    batch_finished_at: finished ?? started,
    declared_window: [...declaredWindows].sort().join(" | "),
    source_window_end: "disclosed_by_wordstat_ui",
    calls,
    discovery,
  };
}

export function adaptCompleteWordstatUiBatch(
  value: unknown,
  researchPlan: DemandCostResearchPlan,
): WordstatObservationBatch {
  return adaptCompleteWordstatUiBatches([value], researchPlan.seeds, {
    initial_seed_count: researchPlan.seeds.length,
    expansion_seed_count: 0,
    verification_seed_count: researchPlan.seeds.length,
    waves_completed: 1,
    stop_reason: "NO_EXPANSION_CANDIDATES",
  });
}
