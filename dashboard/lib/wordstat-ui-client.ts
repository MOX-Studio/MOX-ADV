import type { DemandCostResearchPlan } from "./market-evidence.ts";
import { adaptCompleteWordstatUiBatch } from "./wordstat-ui-market-adapter.ts";
import { cleanText } from "./text.ts";

const DEFAULT_WORDSTAT_UI_REQUEST_TIMEOUT_MS = 45_000;
const MAX_WORDSTAT_UI_REQUEST_TIMEOUT_MS = 120_000;

type WordstatUiBridgeRuntime = {
  P0_WORDSTAT_BRIDGE_URL?: string;
  P0_WORDSTAT_BRIDGE_TOKEN?: string;
};

type WordstatUiBridgeDependencies = {
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
};

function wordstatUiDevice(device: DemandCostResearchPlan["seeds"][number]["device"]) {
  return device === "all" ? "ALL"
    : device === "desktop" ? "DESKTOP"
      : device === "phone" ? "SMARTPHONE" : "TABLET";
}

function boundedTimeout(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_WORDSTAT_UI_REQUEST_TIMEOUT_MS;
  return Math.min(MAX_WORDSTAT_UI_REQUEST_TIMEOUT_MS, Math.max(1, Math.trunc(Number(value))));
}

export async function collectHeadlessWordstatUiBatch(
  researchPlan: DemandCostResearchPlan,
  runtime: WordstatUiBridgeRuntime,
  dependencies: WordstatUiBridgeDependencies = {},
) {
  const configuredUrl = cleanText(runtime.P0_WORDSTAT_BRIDGE_URL ?? "", 1_000);
  const bridgeToken = cleanText(runtime.P0_WORDSTAT_BRIDGE_TOKEN ?? "", 1_000);
  if (!configuredUrl || !bridgeToken) throw new Error("Headless Wordstat UI bridge is not configured.");
  const bridgeUrl = new URL(configuredUrl);
  if (bridgeUrl.protocol !== "http:" || bridgeUrl.hostname !== "127.0.0.1") {
    throw new Error("Headless Wordstat UI bridge must use loopback HTTP.");
  }

  const endpoint = new URL("/collect", bridgeUrl);
  const controller = new AbortController();
  const timeoutMs = boundedTimeout(dependencies.requestTimeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        run_id: `wordstat-ui-${crypto.randomUUID()}`,
        plan_input: {
          seeds: researchPlan.seeds.map((seed) => ({
            seed_id: seed.seed_id,
            exact_query: seed.phrase,
            operator_profile: seed.operator_profile,
          })),
          scope: {
            regions: researchPlan.scope.regions.map((region) => ({ provider_id: region.id, label: region.name })),
            device: wordstatUiDevice(researchPlan.seeds[0].device),
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
    return adaptCompleteWordstatUiBatch(payload.batch, researchPlan);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`WORDSTAT_UI_REQUEST_TIMEOUT: Headless Wordstat UI bridge exceeded ${timeoutMs} ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
