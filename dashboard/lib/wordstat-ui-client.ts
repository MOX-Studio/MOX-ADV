import type { DemandCostResearchPlan, WordstatObservationBatch } from "./market-evidence.ts";
import {
  selectWordstatExpansionSeeds,
  selectWordstatVerificationSeeds,
  wordstatDiscoveryStopReason,
  wordstatOperatorVerificationSeeds,
} from "./wordstat-semantic-discovery.ts";
import { adaptCompleteWordstatUiBatches, assertCompleteWordstatUiPhase } from "./wordstat-ui-market-adapter.ts";
import { cleanText } from "./text.ts";

const BASE_WORDSTAT_UI_REQUEST_TIMEOUT_MS = 120_000;
const WORDSTAT_UI_SURFACES_PER_SEED = 4;
const WORDSTAT_UI_TIMEOUT_PER_SURFACE_MS = 12_000;
const MAX_WORDSTAT_UI_REQUEST_TIMEOUT_MS = 15 * 60_000;
const DISCOVERY_SURFACES = ["TOP_POPULAR", "TOP_SIMILAR"] as const;
const OPERATOR_VERIFICATION_SURFACES = ["TOP_POPULAR"] as const;
const SEASONALITY_VERIFICATION_SURFACES = ["DYNAMICS", "REGIONS"] as const;

type ResearchSeed = DemandCostResearchPlan["seeds"][number];
type WordstatUiSurface = "TOP_POPULAR" | "TOP_SIMILAR" | "DYNAMICS" | "REGIONS";

type WordstatUiBridgeRuntime = {
  P0_WORDSTAT_BRIDGE_URL?: string;
  P0_WORDSTAT_BRIDGE_TOKEN?: string;
};

type WordstatUiBridgeDependencies = {
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
};

function wordstatUiDevice(device: ResearchSeed["device"]) {
  return device === "all" ? "ALL"
    : device === "desktop" ? "DESKTOP"
      : device === "phone" ? "SMARTPHONE" : "TABLET";
}

function boundedTimeout(plannedSurfaceReads: number, override?: number) {
  if (Number.isFinite(override)) {
    return Math.min(MAX_WORDSTAT_UI_REQUEST_TIMEOUT_MS, Math.max(1, Math.trunc(Number(override))));
  }
  return Math.min(
    MAX_WORDSTAT_UI_REQUEST_TIMEOUT_MS,
    BASE_WORDSTAT_UI_REQUEST_TIMEOUT_MS + Math.max(1, plannedSurfaceReads) * WORDSTAT_UI_TIMEOUT_PER_SURFACE_MS,
  );
}

export function wordstatUiRequestTimeoutMs(
  researchPlan: Pick<DemandCostResearchPlan, "seeds">,
  override?: number,
) {
  const seedCount = Math.max(1, researchPlan.seeds.length);
  return boundedTimeout(seedCount * WORDSTAT_UI_SURFACES_PER_SEED, override);
}

function bridgeConfiguration(runtime: WordstatUiBridgeRuntime) {
  const configuredUrl = cleanText(runtime.P0_WORDSTAT_BRIDGE_URL ?? "", 1_000);
  const bridgeToken = cleanText(runtime.P0_WORDSTAT_BRIDGE_TOKEN ?? "", 1_000);
  if (!configuredUrl || !bridgeToken) throw new Error("Headless Wordstat UI bridge is not configured.");
  const bridgeUrl = new URL(configuredUrl);
  if (bridgeUrl.protocol !== "http:" || bridgeUrl.hostname !== "127.0.0.1") {
    throw new Error("Headless Wordstat UI bridge must use loopback HTTP.");
  }
  return { bridgeToken, endpoint: new URL("/collect", bridgeUrl) };
}

async function collectPhase(
  configuration: ReturnType<typeof bridgeConfiguration>,
  researchPlan: Pick<DemandCostResearchPlan, "scope">,
  seeds: Array<Pick<ResearchSeed, "seed_id" | "phrase" | "operator_profile" | "device">>,
  surfaces: readonly WordstatUiSurface[],
  phase: string,
  dependencies: WordstatUiBridgeDependencies,
) {
  const controller = new AbortController();
  const signal = dependencies.signal ? AbortSignal.any([controller.signal, dependencies.signal]) : controller.signal;
  const timeoutMs = boundedTimeout(seeds.length * surfaces.length, dependencies.requestTimeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    signal.throwIfAborted();
    const response = await (dependencies.fetchImpl ?? fetch)(configuration.endpoint, {
      method: "POST",
      redirect: "manual",
      signal,
      headers: {
        Authorization: `Bearer ${configuration.bridgeToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        run_id: `wordstat-ui-${phase}-${crypto.randomUUID()}`,
        plan_input: {
          seeds: seeds.map((seed) => ({
            seed_id: seed.seed_id,
            exact_query: seed.phrase,
            operator_profile: seed.operator_profile,
          })),
          surfaces,
          scope: {
            regions: researchPlan.scope.regions.map((region) => ({ provider_id: region.id, label: region.name })),
            device: wordstatUiDevice(seeds[0].device),
            dynamics: {
              granularity: "MONTH",
              from_date: researchPlan.scope.seasonality.from_date,
              to_date: researchPlan.scope.seasonality.to_date,
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Headless Wordstat UI bridge returned HTTP ${response.status}.`);
    const payload = await response.json() as { batch?: unknown };
    return payload.batch;
  } catch (error) {
    if (dependencies.signal?.aborted) {
      throw new Error(`WORDSTAT_UI_REQUEST_ABORTED: Headless Wordstat UI collection was cancelled during ${phase}.`, { cause: error });
    }
    if (controller.signal.aborted) {
      throw new Error(`WORDSTAT_UI_REQUEST_TIMEOUT: Headless Wordstat UI bridge exceeded ${timeoutMs} ms during ${phase}.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Explicit agent-selected reads; no automatic candidate selection or claims of complete coverage. */
export async function collectWordstatQueryPhase(
  input: { queries: string[]; region: { id: number; name: string }; similar: boolean },
  runtime: WordstatUiBridgeRuntime,
  dependencies: WordstatUiBridgeDependencies = {},
) {
  const end = new Date(); end.setUTCDate(0);
  const start = new Date(Date.UTC(end.getUTCFullYear() - 2, end.getUTCMonth() + 1, 1));
  return collectPhase(bridgeConfiguration(runtime), {
    scope: { regions: [input.region], devices: ["all"], seasonality: { business_context: null, method: "MONTHLY_DYNAMICS_SAME_PERIOD", from_date: start.toISOString().slice(0, 10), to_date: end.toISOString().slice(0, 10) } },
  }, input.queries.map((phrase, index) => ({ seed_id: `explicit-${index + 1}`, phrase,
    operator_profile: phrase.startsWith('"') && phrase.endsWith('"') ? "FIXED_WORD_COUNT" : "BROAD_CONTAINING", device: "all" })),
  input.similar ? DISCOVERY_SURFACES : OPERATOR_VERIFICATION_SURFACES, "explicit",
  { ...dependencies, requestTimeoutMs: dependencies.requestTimeoutMs ?? MAX_WORDSTAT_UI_REQUEST_TIMEOUT_MS });
}

export async function collectHeadlessWordstatUiBatch(
  researchPlan: DemandCostResearchPlan,
  runtime: WordstatUiBridgeRuntime,
  dependencies: WordstatUiBridgeDependencies = {},
) {
  if (!researchPlan.seeds.length) throw new Error("Headless Wordstat UI discovery requires at least one initial seed.");
  const configuration = bridgeConfiguration(runtime);
  const batches: unknown[] = [];
  const runtimeSeeds: ResearchSeed[] = [...researchPlan.seeds];
  let completedExpansionSeedCount = 0;
  let completedVerificationSeedCount = 0;
  let wavesCompleted = 1;
  let stopReason: NonNullable<WordstatObservationBatch["discovery"]>["stop_reason"] = "NO_EXPANSION_CANDIDATES";
  const adaptedResult = () => adaptCompleteWordstatUiBatches(batches, runtimeSeeds, {
    initial_seed_count: researchPlan.seeds.length,
    expansion_seed_count: completedExpansionSeedCount,
    verification_seed_count: completedVerificationSeedCount,
    waves_completed: wavesCompleted,
    stop_reason: stopReason,
  });

  const discoveryBatch = await collectPhase(
    configuration,
    researchPlan,
    researchPlan.seeds,
    DISCOVERY_SURFACES,
    "discovery-1",
    dependencies,
  );
  // An incomplete initial phase cannot be admitted by the production adapter.
  // Reject it before spending further reads on candidates that would be discarded.
  assertCompleteWordstatUiPhase(discoveryBatch, researchPlan.seeds, DISCOVERY_SURFACES);
  batches.push(discoveryBatch);

  const expansionSeeds = selectWordstatExpansionSeeds(researchPlan, discoveryBatch);
  let expansionBatch: unknown | null = null;
  stopReason = wordstatDiscoveryStopReason(expansionSeeds.length);
  if (expansionSeeds.length) {
    try {
      const candidate = await collectPhase(
        configuration,
        researchPlan,
        expansionSeeds,
        DISCOVERY_SURFACES,
        "discovery-2",
        dependencies,
      );
      assertCompleteWordstatUiPhase(candidate, expansionSeeds, DISCOVERY_SURFACES);
      expansionBatch = candidate;
      batches.push(candidate);
      runtimeSeeds.push(...expansionSeeds);
      completedExpansionSeedCount = expansionSeeds.length;
      wavesCompleted = 2;
    } catch {
      stopReason = "EXPANSION_PHASE_UNAVAILABLE";
      return adaptedResult();
    }
  }

  const discoveryBatches = expansionBatch ? [discoveryBatch, expansionBatch] : [discoveryBatch];
  const verificationSeeds = selectWordstatVerificationSeeds(
    researchPlan,
    discoveryBatches,
    expansionSeeds,
  );
  const operatorSeeds = wordstatOperatorVerificationSeeds(verificationSeeds);
  if (operatorSeeds.length) {
    try {
      const operatorBatch = await collectPhase(
        configuration,
        researchPlan,
        operatorSeeds,
        OPERATOR_VERIFICATION_SURFACES,
        "operator-verification",
        dependencies,
      );
      assertCompleteWordstatUiPhase(operatorBatch, operatorSeeds, OPERATOR_VERIFICATION_SURFACES);
      batches.push(operatorBatch);
      runtimeSeeds.push(...operatorSeeds);
      completedVerificationSeedCount = verificationSeeds.length;
    } catch {
      stopReason = "OPERATOR_VERIFICATION_UNAVAILABLE";
      return adaptedResult();
    }

    try {
      const seasonalityBatch = await collectPhase(
        configuration,
        researchPlan,
        verificationSeeds,
        SEASONALITY_VERIFICATION_SURFACES,
        "seasonality-verification",
        dependencies,
      );
      assertCompleteWordstatUiPhase(seasonalityBatch, verificationSeeds, SEASONALITY_VERIFICATION_SURFACES);
      batches.push(seasonalityBatch);
      runtimeSeeds.push(...verificationSeeds);
    } catch {
      stopReason = "SEASONALITY_VERIFICATION_UNAVAILABLE";
      return adaptedResult();
    }
  }

  return adaptedResult();
}
