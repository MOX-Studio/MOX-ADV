import { verifyAnalyticsEvidenceSnapshot, withBusinessResearchMaterial, type AnalyticsEvidenceBundle } from "./analytics-evidence.ts";
import { goalMatchesProviderRegion } from "./goal-evidence-scope.ts";
import { collectWordstatQueryPhase } from "./wordstat-ui-client.ts";

export type WordstatQueryResearch = { queries: string[]; region: { id: number; name: string }; similar: boolean };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function validateWordstatQueryResearch(value: unknown, geography: string): WordstatQueryResearch {
  const input = record(value), region = record(input.region);
  if (Object.keys(input).sort().join() !== "queries,region,similar" || Object.keys(region).sort().join() !== "id,name"
    || !Array.isArray(input.queries) || !input.queries.length || input.queries.length > 20 || typeof input.similar !== "boolean"
    || input.queries.some(q => typeof q !== "string" || !q.trim() || q.length > 200 || [...q].some(character => character.charCodeAt(0) < 32))
    || typeof region.name !== "string" || typeof region.id !== "number"
    || !goalMatchesProviderRegion(geography, { regionIds: [region.id], regionNames: [region.name] })) {
    throw new Error("Для Wordstat укажите 1–20 запросов и регион, совпадающий с географией цели.");
  }
  const queries = (input.queries as string[]).map(q => q.normalize("NFKC").trim().replace(/\s+/gu, " "));
  if (new Set(queries.map(q => q.toLocaleLowerCase("ru-RU"))).size !== queries.length) throw new Error("Повторяющиеся запросы Wordstat нужно удалить.");
  return { queries, region: { id: region.id as number, name: region.name as string }, similar: input.similar as boolean };
}

export async function collectAdditionalWordstatResearch(
  snapshot: Record<string, unknown> | null,
  request: WordstatQueryResearch,
  runtime: { P0_WORDSTAT_BRIDGE_URL?: string; P0_WORDSTAT_BRIDGE_TOKEN?: string },
  dependencies: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
) {
  if (!snapshot || !await verifyAnalyticsEvidenceSnapshot(snapshot) || !snapshot.goal_context) throw new Error("Сначала загрузите проверенный срез источников, привязанный к цели.");
  const input = validateWordstatQueryResearch(request, String(record(snapshot.goal_context).customer_geography ?? ""));
  const batch = record(await collectWordstatQueryPhase(input, runtime, dependencies));
  dependencies.signal?.throwIfAborted();
  if (batch.schema_version !== "wordstat-ui-observation-batch-v1" || batch.source !== "YANDEX_WORDSTAT_UI"
    || typeof batch.batch_id !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(batch.batch_id)
    || !Array.isArray(batch.observations) || !Array.isArray(batch.failures)
    || typeof batch.batch_finished_at !== "string" || !Number.isFinite(Date.parse(batch.batch_finished_at))) throw new Error("Wordstat не вернул проверяемый пакет наблюдений.");
  return withBusinessResearchMaterial(snapshot as AnalyticsEvidenceBundle, {
    id: `WORDSTAT-EXPLICIT-${batch.batch_id.slice(7, 31)}`, kind: "OFFICIAL_OBSERVATIONS",
    label: `Wordstat: проверка ${input.queries.length} запросов`, observed_at: batch.batch_finished_at,
    source_urls: ["https://wordstat.yandex.com/"], content: { request: input, batch },
  }) as unknown as Promise<Record<string, unknown>>;
}
