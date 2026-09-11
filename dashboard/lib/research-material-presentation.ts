/** Display-only projection of dated research already covered by the source snapshot. */
type Data = Record<string, unknown>;
const record = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const list = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const https = (value: unknown) => { try { const url = new URL(text(value)); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; } };
export type ResearchMaterialEntry = {
  id: string; name: string; summary: string; observedAt: string;
  fields: Array<{ label: string; value: string }>;
  sources: Array<{ title: string; url: string }>;
};
export type ResearchMaterials = {
  competitors: ResearchMaterialEntry[];
  contractors: ResearchMaterialEntry[];
  access: null | { checkedAt: string; directAvailable: boolean; campaignCount: number | null; historyEstablished: boolean; metrikaAvailable: boolean; site: string; differentSite: boolean };
};

export function projectResearchMaterials(snapshot: unknown): ResearchMaterials {
  const result: ResearchMaterials = { competitors: [], contractors: [], access: null };
  const materials = list(record(record(snapshot).business_research).supporting_materials).map(record);
  for (const material of materials) {
    if (material.kind !== "RESEARCH_SUMMARY" && material.kind !== "OFFICIAL_OBSERVATIONS") continue;
    const content = record(material.content);
    const sources = new Map(list(content.sources).map(record).map(s => [text(s.id), { title: text(s.title), url: https(s.url) }]));
    for (const kind of ["competitors", "contractors"] as const) {
      const fields = kind === "competitors"
        ? { offer: "Предложение", audience: "Аудитория", cycle: "Период и место", conversion: "Как получают обращение", price: "Цена и условия", difference: "Отличие по исследованию", confidence: "Граница вывода" }
        : { channels: "Работа подрядчика", reported: "Заявлено автором кейса", limits: "Ограничения", period: "Период и рынок", match: "Сопоставимость" };
      for (const row of list(content[kind]).map(record)) {
        if (!text(row.name)) continue;
        result[kind].push({ id: `${text(material.id)}:${text(row.id) || result[kind].length}`, name: text(row.name),
          summary: text(kind === "competitors" ? row.classification : row.case), observedAt: text(material.observed_at),
          fields: Object.entries(fields).flatMap(([key, label]) => text(row[key]) ? [{ label, value: text(row[key]) }] : []),
          sources: list(row.source_ids).flatMap(id => { const source = sources.get(text(id)); return source?.url ? [source] : []; }),
        });
      }
    }
    if (content.direct_v5 || content.metrica) {
      const direct = record(content.direct_v5), metrika = record(content.metrica);
      result.access = { checkedAt: text(content.checked_at) || text(material.observed_at), directAvailable: direct.status === "AVAILABLE", campaignCount: typeof direct.campaign_count === "number" ? direct.campaign_count : null,
        historyEstablished: direct.history_relevance === "ESTABLISHED", metrikaAvailable: metrika.status === "AVAILABLE", site: text(metrika.site), differentSite: metrika.relevance === "DIFFERENT_SITE" };
    }
  }
  return result;
}

export function researchSourceStatus(source: { id: string; status: string; title: string }, materials?: ResearchMaterials) {
  const access = materials?.access;
  if (source.id === "direct" && access?.directAvailable) return { title: "Яндекс Директ", status: access.historyEstablished ? "История подтверждена" : "История для задачи не подтверждена", detail: `API доступен${access.campaignCount === null ? "" : ` · кампаний: ${access.campaignCount}`}`, date: access.checkedAt };
  if (source.id === "metrika" && access?.metrikaAvailable) return { title: "Яндекс Метрика", status: access.differentSite ? "Счётчик другого сайта" : "API доступен", detail: access.site, date: access.checkedAt };
  if (source.id === "competitors" && materials?.competitors.length) return { title: "Конкуренты", status: "Есть исследование", detail: `Предложений: ${materials.competitors.length}`, date: materials.competitors[0].observedAt };
  const titles: Record<string, string> = { "first-party-web": "Сайт и предложение", "owner-confirmed": "Вводные владельца", financial: "Финансовые данные", wordstat: "Wordstat" };
  return { title: titles[source.id] ?? source.title, status: source.status === "VERIFIED" ? "Данные получены" : source.status === "PARTIAL" ? "Данные получены частично" : "Данные не получены", detail: "", date: "" };
}
