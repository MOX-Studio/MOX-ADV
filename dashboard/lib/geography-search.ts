export type GeographyOption = { id: number; name: string; context: string; kind: string };
type GeoRegion = { id: number; name: string; parent: number | null; kind: string };
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
const aliases: Record<number, string[]> = { 213: ["мск"], 2: ["спб", "петербург", "питер"] };

/** Provider field names are from Direct dictionaries.get / GeoRegions, not invented local IDs. */
export function parseGeoRegions(payload: unknown): GeoRegion[] {
  const result = payload && typeof payload === "object" && "result" in payload ? (payload as { result: { GeoRegions?: unknown } }).result : null;
  const rows = result?.GeoRegions;
  if (!Array.isArray(rows) || rows.length > 100_000 || (payload as { error?: unknown }).error) throw new Error("Справочник географии временно недоступен.");
  const regions = rows.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (!Number.isSafeInteger(row.GeoRegionId) || Number(row.GeoRegionId) <= 0 || typeof row.GeoRegionName !== "string" || !row.GeoRegionName.trim()) return [];
    return [{ id: Number(row.GeoRegionId), name: row.GeoRegionName.trim(), kind: String(row.GeoRegionType ?? ""), parent: Number.isSafeInteger(row.ParentId) ? Number(row.ParentId) : null }];
  });
  if (!regions.length) throw new Error("Справочник географии временно недоступен.");
  return [...new Map(regions.map((region) => [region.id, region])).values()];
}

export function searchGeoRegions(regions: GeoRegion[], input: string, limit = 8): GeographyOption[] {
  const query = normalize(input);
  if ([...query].length < 2 || query.length > 100) return [];
  const tokens = query.split(/[\s-]+/u).filter(Boolean);
  const byId = new Map(regions.map((region) => [region.id, region]));
  const isRussianCity = (region: GeoRegion) => {
    if (region.kind !== "City") return false;
    const visited = new Set<number>([region.id]);
    let parent = region.parent;
    while (parent !== null && !visited.has(parent)) {
      if (parent === 225 && byId.get(parent)?.kind === "Country") return true;
      visited.add(parent);
      parent = byId.get(parent)?.parent ?? null;
    }
    return false;
  };
  const matched = regions.flatMap((region) => {
    if (!isRussianCity(region)) return [];
    const name = normalize(region.name);
    const names = [name, ...(aliases[region.id] ?? [])];
    const exact = names.includes(query);
    const prefix = names.some((name) => name.startsWith(query));
    const relevant = names.some((name) => tokens.every((token) => name.split(/[\s-]+/u).some((word) => word.startsWith(token))));
    if (!relevant) return [];
    return [{ region, rank: exact ? 0 : prefix ? 1 : 2 }];
  }).sort((a, b) => a.rank - b.rank
    || Number([213, 2].includes(b.region.id)) - Number([213, 2].includes(a.region.id))
    || a.region.name.length - b.region.name.length || a.region.name.localeCompare(b.region.name, "ru-RU") || a.region.id - b.region.id);
  return matched.slice(0, Math.max(0, Math.min(20, limit))).map(({ region }) => {
    const path: string[] = [];
    const visited = new Set([region.id]);
    let parent = region.parent === null ? undefined : byId.get(region.parent);
    while (parent && !visited.has(parent.id) && path.length < 4) {
      visited.add(parent.id);
      if (["World", "Continent"].includes(parent.kind)) break;
      path.push(parent.name);
      parent = parent.parent === null ? undefined : byId.get(parent.parent);
    }
    return { id: region.id, name: region.name, context: path.join(" · "), kind: region.kind };
  });
}

/** Cache the public dictionary, not user searches. A new keystroke cannot cancel another request's shared read. */
export function createGeographySearch(load: () => Promise<unknown>, now = Date.now, ttlMs = 86_400_000) {
  let cached: { regions: GeoRegion[]; expires: number } | null = null;
  let pending: Promise<GeoRegion[]> | null = null;
  return async (query: string): Promise<GeographyOption[]> => {
    if ([...normalize(query)].length < 2 || query.length > 100) return [];
    if (!cached || cached.expires <= now()) {
      pending ??= load().then(parseGeoRegions).then((regions) => {
        cached = { regions, expires: now() + ttlMs };
        return regions;
      }).finally(() => { pending = null; });
      await pending;
    }
    return searchGeoRegions(cached!.regions, query);
  };
}

export async function readDirectGeoRegions(input: { token: string; account: string }, fetcher: typeof fetch = fetch) {
  if (!input.token || !input.account) throw new Error("Справочник географии временно недоступен.");
  const response = await fetcher("https://api.direct.yandex.com/json/v501/dictionaries", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${input.token}`, "Client-Login": input.account, "Accept-Language": "ru", "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ method: "get", params: { DictionaryNames: ["GeoRegions"] } }),
  });
  if (!response.ok) throw new Error("Справочник географии временно недоступен.");
  return response.json();
}
