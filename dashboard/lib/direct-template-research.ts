import JSONbig from "json-bigint";

type Row = Record<string, unknown>;
type Collection = { status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"; objects: Row[]; request_ids: string[]; limitation: string | null };
const codec = JSONbig({ useNativeBigInt: true });
const record = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const safe = (v: unknown): unknown => typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(safe) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, safe(x)])) : v;
const ids = (v: unknown[]) => [...new Set(v.filter(x => /^\d+$/u.test(String(x))).map(String))];
const numericIds = (values: string[]) => values.map(BigInt);
const SERVICES = new Set(["campaigns", "adgroups", "keywords", "ads", "sitelinks", "adextensions", "bidmodifiers", "retargetinglists"]);

export type DirectTemplateResearch = {
  schema_version: "direct-template-research-v1";
  observed_at: string;
  account: string;
  period: { from: string; to: string };
  authority: { provider_writes: false; browser_cabinet: false };
  collections: Record<string, Collection>;
  reports: Array<{ goal_id: string | null; report_type: string; status: "COMPLETE" | "QUEUED" | "UNAVAILABLE"; request_id: string | null; rows: Row[]; limitation: string | null }>;
  measurement: Array<{ counter_id: string; status: "COMPLETE" | "UNAVAILABLE"; goals: Row[]; limitation: string | null }>;
  templates: Array<{ campaign: Row; groups: Row[]; keywords: Row[]; ads: Row[]; sitelink_set_ids: string[]; ad_extension_ids: string[] }>;
  limitations: string[];
};

/** Account observations only. The exact allowlist has no create/update/resume method. */
export async function collectDirectTemplateResearch(config: { token: string; account: string; metricaToken?: string; dateFrom: string; dateTo: string }, dependencies: { fetch: typeof fetch; now: () => string; signal?: AbortSignal }): Promise<DirectTemplateResearch> {
  if (!config.token || !config.account) throw new Error("Не настроен разрешённый доступ к чтению Директа.");
  if (![config.dateFrom, config.dateTo].every(s => /^\d{4}-\d{2}-\d{2}$/u.test(s) && Number.isFinite(Date.parse(s))) || config.dateFrom > config.dateTo) throw new Error("Неверный период исследования Директа.");
  const snapshot: DirectTemplateResearch = { schema_version: "direct-template-research-v1", observed_at: dependencies.now(), account: config.account, period: { from: config.dateFrom, to: config.dateTo },
    authority: { provider_writes: false, browser_cabinet: false }, collections: {}, reports: [], measurement: [], templates: [],
    limitations: ["Текущая структура не доказывает, что она была такой же в период отчёта.", "Конверсии Метрики не подтверждают квалификацию и продажи без отдельного сопоставимого бизнес-учёта.", "Настройки и содержание примеров требуют адаптации к новой цели; методы get и add имеют разные контракты."] };
  const headers = { Authorization: `Bearer ${config.token}`, "Client-Login": config.account, "Accept-Language": "ru", "Content-Type": "application/json; charset=utf-8" };
  const fetcher = (url: string, init: RequestInit) => dependencies.fetch(url, { ...init, redirect: "error", signal: dependencies.signal ? AbortSignal.any([dependencies.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
  async function get(service: string, resultKey: string, params: Row): Promise<Collection> {
    if (!SERVICES.has(service)) throw new Error("Метод не разрешён для исследования шаблонов.");
    const collected: Collection = { status: "COMPLETE", objects: [], request_ids: [], limitation: null };
    let offset = 0;
    try {
      for (let page = 0; page < 100; page++) {
        const response = await fetcher(`https://api.direct.yandex.com/json/v501/${service}`, { method: "POST", headers, body: codec.stringify({ method: "get", params: { ...params, Page: { Limit: 10000, Offset: offset } } }) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = record(safe(codec.parse(await response.text())));
        if (data.error) throw new Error(String(record(data.error).error_detail ?? record(data.error).error_string ?? "Ошибка чтения"));
        const result = record(data.result);
        if (!Array.isArray(result[resultKey])) throw new Error(`Не получен полный массив ${resultKey}`);
        collected.objects.push(...list(result[resultKey]).map(record));
        const requestId = response.headers.get("RequestId"); if (requestId) collected.request_ids.push(requestId);
        if (result.LimitedBy === undefined || result.LimitedBy === null) return collected;
        const next = Number(result.LimitedBy);
        if (!Number.isSafeInteger(next) || next <= offset) throw new Error("Непродвигающаяся пагинация");
        offset = next;
      }
      throw new Error("Исследование превысило предел в 100 страниц; результат неполный");
    } catch (error) { dependencies.signal?.throwIfAborted(); collected.status = collected.objects.length ? "PARTIAL" : "UNAVAILABLE"; collected.limitation = `${service}.get: ${error instanceof Error ? error.message : String(error)}`; return collected; }
  }
  const campaigns = await get("campaigns", "Campaigns", { SelectionCriteria: {}, FieldNames: ["Id", "Name", "Type", "State", "Status", "StartDate", "EndDate", "TimeZone", "NegativeKeywords", "ExcludedSites", "DailyBudget", "TimeTargeting"],
    UnifiedCampaignFieldNames: ["CounterIds", "BiddingStrategy", "PriorityGoals", "Settings", "AttributionModel", "TrackingParams"], TextCampaignFieldNames: ["CounterIds", "BiddingStrategy", "PriorityGoals", "Settings", "AttributionModel"] });
  snapshot.collections.campaigns = campaigns;
  // Collect every nonarchived reference, not just the first apparently successful campaign.
  const references = campaigns.objects.filter(c => !["ARCHIVED", "CONVERTED"].includes(String(c.State)));
  const campaignIds = ids(references.map(c => c.Id));
  if (campaignIds.length) {
    const selection = { CampaignIds: numericIds(campaignIds) };
    const requests: Array<[string, string, Row]> = [
      ["adgroups", "AdGroups", { SelectionCriteria: selection, FieldNames: ["Id", "CampaignId", "Name", "RegionIds", "NegativeKeywords", "Status", "ServingStatus", "Type"] }],
      ["keywords", "Keywords", { SelectionCriteria: selection, FieldNames: ["Id", "CampaignId", "AdGroupId", "Keyword", "State", "Status", "ServingStatus", "AutotargetingCategories", "AutotargetingBrandOptions"] }],
      ["ads", "Ads", { SelectionCriteria: selection, FieldNames: ["Id", "CampaignId", "AdGroupId", "Type", "State", "Status"], ResponsiveAdFieldNames: ["Titles", "Texts", "Href", "AdImages", "SitelinkSetId", "AdExtensions", "BusinessId", "DisplayUrlPath"], TextAdFieldNames: ["Title", "Title2", "Text", "Href", "AdImageHash", "SitelinkSetId", "AdExtensions", "BusinessId"] }],
    ];
    for (const [service, key, params] of requests) snapshot.collections[service] = await get(service, key, params);
    const adDetails = (snapshot.collections.ads?.objects ?? []).map(a => record(a.ResponsiveAd ?? a.TextAd));
    const links = ids(adDetails.map(a => a.SitelinkSetId)), extensions = ids(adDetails.flatMap(a => list(a.AdExtensions).map(x => record(x).AdExtensionId)));
    if (links.length) snapshot.collections.sitelinks = await get("sitelinks", "SitelinksSets", { SelectionCriteria: { Ids: numericIds(links) }, FieldNames: ["Id", "Sitelinks"] });
    if (extensions.length) snapshot.collections.adextensions = await get("adextensions", "AdExtensions", { SelectionCriteria: { Ids: numericIds(extensions) }, FieldNames: ["Id", "Type"], CalloutFieldNames: ["CalloutText"] });
    const modifiers: Collection = { status: "COMPLETE", objects: [], request_ids: [], limitation: null };
    for (let i = 0; i < campaignIds.length; i += 10) {
      const part = await get("bidmodifiers", "BidModifiers", { SelectionCriteria: { CampaignIds: numericIds(campaignIds.slice(i, i + 10)), Levels: ["CAMPAIGN", "AD_GROUP"] }, FieldNames: ["Id", "CampaignId", "AdGroupId", "Level", "Type"],
        MobileAdjustmentFieldNames: ["BidModifier", "OperatingSystemType"], DemographicsAdjustmentFieldNames: ["Gender", "Age", "BidModifier", "Enabled"], RetargetingAdjustmentFieldNames: ["RetargetingConditionId", "BidModifier", "Accessible", "Enabled"], RegionalAdjustmentFieldNames: ["RegionId", "BidModifier", "Enabled"], IncomeGradeAdjustmentFieldNames: ["Grade", "BidModifier", "Enabled"] });
      modifiers.objects.push(...part.objects); modifiers.request_ids.push(...part.request_ids);
      if (part.status !== "COMPLETE") { modifiers.status = "PARTIAL"; modifiers.limitation = [modifiers.limitation, part.limitation].filter(Boolean).join("; "); }
    }
    snapshot.collections.bidmodifiers = modifiers;
    const retargetingIds = ids(modifiers.objects.map(m => record(m.RetargetingAdjustment).RetargetingConditionId));
    if (retargetingIds.length) snapshot.collections.retargetinglists = await get("retargetinglists", "RetargetingLists", { SelectionCriteria: { Ids: numericIds(retargetingIds) }, FieldNames: ["Id", "Name", "Description", "Rules", "IsAvailable"] });
    snapshot.templates = references.map(c => {
      const ads = (snapshot.collections.ads?.objects ?? []).filter(a => String(a.CampaignId) === String(c.Id));
      return { campaign: c, groups: (snapshot.collections.adgroups?.objects ?? []).filter(g => String(g.CampaignId) === String(c.Id)), keywords: (snapshot.collections.keywords?.objects ?? []).filter(k => String(k.CampaignId) === String(c.Id)), ads,
        sitelink_set_ids: ids(ads.map(a => record(a.ResponsiveAd ?? a.TextAd).SitelinkSetId)), ad_extension_ids: ids(ads.flatMap(a => list(record(a.ResponsiveAd ?? a.TextAd).AdExtensions).map(e => record(e).AdExtensionId))) };
    });
  }
  const settings = references.map(c => record(c.UnifiedCampaign ?? c.TextCampaign));
  const goalValues: unknown[] = [];
  const inspectGoals = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(inspectGoals); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { if (key === "GoalId") goalValues.push(child); else inspectGoals(child); }
  };
  settings.forEach(inspectGoals);
  const goalIds = ids(goalValues);
  const counterIds = ids(settings.flatMap(s => list(record(s.CounterIds).Items)));
  for (const counterId of counterIds) {
    try {
      if (!config.metricaToken) throw new Error("Доступ к Метрике не настроен");
      const response = await fetcher(`https://api-metrika.yandex.net/management/v1/counter/${counterId}/goals`, { headers: { Authorization: `OAuth ${config.metricaToken}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = record(await response.json()); if (!Array.isArray(data.goals)) throw new Error("Список целей не получен");
      snapshot.measurement.push({ counter_id: counterId, status: "COMPLETE", goals: data.goals.map(record), limitation: null });
    } catch (error) { dependencies.signal?.throwIfAborted(); snapshot.measurement.push({ counter_id: counterId, status: "UNAVAILABLE", goals: [], limitation: error instanceof Error ? error.message : String(error) }); }
  }
  const reportRequests = ["CAMPAIGN_PERFORMANCE_REPORT", "SEARCH_QUERY_PERFORMANCE_REPORT"];
  for (const goalId of goalIds.length ? goalIds : [null]) for (const reportType of reportRequests) {
    const report: DirectTemplateResearch["reports"][number] = { goal_id: goalId, report_type: reportType, status: "UNAVAILABLE", request_id: null, rows: [], limitation: null };
    const fieldNames = reportType === "CAMPAIGN_PERFORMANCE_REPORT" ? ["CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", "AvgCpc", "Conversions", "CostPerConversion"] : ["CampaignId", "AdGroupId", "Query", "MatchedKeyword", "Impressions", "Clicks", "Cost", "Conversions", "CostPerConversion"];
    const params = { SelectionCriteria: { DateFrom: config.dateFrom, DateTo: config.dateTo }, FieldNames: fieldNames, ReportName: `template-research-${reportType}-${goalId ?? "all"}-${config.dateFrom}-${config.dateTo}`, ReportType: reportType, DateRangeType: "CUSTOM_DATE", Format: "TSV", IncludeVAT: "YES", IncludeDiscount: "NO", ...(goalId ? { Goals: [goalId], AttributionModels: ["AUTO"] } : {}) };
    try {
      const request = () => fetcher("https://api.direct.yandex.com/json/v5/reports", { method: "POST", headers: { ...headers, processingMode: "auto", returnMoneyInMicros: "false", skipReportHeader: "true", skipColumnHeader: "false", skipReportSummary: "true" }, body: JSON.stringify({ params }) });
      let response = await request();
      for (let attempt = 0; attempt < 3 && [201, 202].includes(response.status); attempt++) {
        const delay = Number(response.headers.get("retryIn") ?? 5);
        if (!Number.isFinite(delay) || delay < 0 || delay > 20) break;
        await new Promise(resolve => setTimeout(resolve, Math.max(1, delay) * 1000));
        dependencies.signal?.throwIfAborted(); response = await request();
      }
      report.request_id = response.headers.get("RequestId");
      if ([201, 202].includes(response.status)) { report.status = "QUEUED"; report.limitation = `Повторите тот же запрос после ${response.headers.get("retryIn") ?? "5"} секунд; очередь не равна пустому отчёту.`; }
      else if (response.ok) {
        const lines = (await response.text()).trim().split(/\r?\n/u), columns = (lines.shift() ?? "").split("\t");
        if (!columns.includes("CampaignId") || !columns.includes("Cost")) throw new Error("Неизвестный формат отчёта");
        report.rows = lines.filter(Boolean).map(line => { const values = line.split("\t"); if (values.length !== columns.length) throw new Error("Неполная строка отчёта"); return Object.fromEntries(columns.map((c, i) => [c, values[i]])); });
        report.status = "COMPLETE";
      } else throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 700)}`);
    } catch (error) { dependencies.signal?.throwIfAborted(); report.limitation = error instanceof Error ? error.message : String(error); }
    snapshot.reports.push(report);
  }
  return snapshot;
}

export function directTemplateResearchContext(value: unknown) {
  const source = record(value);
  if (source.schema_version !== "direct-template-research-v1" || record(source.authority).provider_writes !== false) return null;
  const templates = list(source.templates).map(record), reports = list(source.reports).map(record);
  return {
    source_kind: "DIRECT_API_ACCOUNT_HISTORY", observed_at: source.observed_at, account: source.account, period: source.period,
    template_counts: templates.map(t => ({ campaign_id: record(t.campaign).Id, name: record(t.campaign).Name, groups: list(t.groups).length, ads: list(t.ads).length, criteria: list(t.keywords).length, sitelink_sets: t.sitelink_set_ids, ad_extensions: t.ad_extension_ids })),
    campaign_observations: reports.filter(r => r.report_type === "CAMPAIGN_PERFORMANCE_REPORT").map(r => ({ goal_id: r.goal_id, status: r.status, rows: r.rows, limitation: r.limitation })),
    query_observations: reports.filter(r => r.report_type === "SEARCH_QUERY_PERFORMANCE_REPORT").map(r => {
      const allRows = list(r.rows).map(record), useful = allRows.filter(row => Number(row.Clicks) > 0 || Number(row.Cost) > 0);
      return { goal_id: r.goal_id, status: r.status, rows: useful, omitted_zero_click_zero_cost_rows: allRows.length - useful.length, complete_source: "supporting_materials.content.reports", limitation: r.limitation };
    }),
    measurement: source.measurement,
    interpretation_rules: [
      "Conversions are scoped platform events. Inspect the actual goal definition; do not call a form event a qualified result or a campaign a winner.",
      "Under PAY_FOR_CONVERSION, zero observed cost with clicks is not a forecast of free future traffic. Preserve billing strategy when interpreting AvgCpc and Cost.",
      "Compare buyer intent and the specific converting query, not only CTR or conversion count. A conversion on irrelevant intent is a qualification question, not a reusable winning keyword.",
      "Current structure does not establish historical causal effects. Reuse structural dependencies; adapt ads, offers, sitelinks, negatives, geography, images and audience exclusions to the new goal.",
      "Keep Campaigns.get read fields separate from Campaigns.add creation fields. Declare and preserve every intended child object before later publication.",
    ],
    limitations: source.limitations,
  };
}
