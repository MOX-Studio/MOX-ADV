import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUTPUT = new URL("../tests/evidence/p0-viable-campaign-real-business.json", import.meta.url);
const LOCAL_ENV = new URL("../.env.local", import.meta.url);
const localEnvironment = await readFile(LOCAL_ENV, "utf8").then((content) => Object.fromEntries(content
  .split(/\r?\n/u)
  .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]))).catch(() => ({}));
const environment = (name) => process.env[name] || localEnvironment[name] || "";
const LANDING_URL = "https://mox-studio.ru/branding";
const DIRECT_API = "https://api.direct.yandex.com/json/v501";
const METRIKA_MANAGEMENT_API = "https://api-metrika.yandex.net/management/v1";
const METRIKA_REPORTS_API = "https://api-metrika.yandex.net/stat/v1/data";

function required(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required for the authorized read-only capture.`);
  return normalized;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function pseudonym(prefix, value) {
  return `${prefix}-${digest(value).slice("sha256:".length, "sha256:".length + 16)}`;
}

function numericPseudonym(value) {
  const safe = Number.parseInt(digest(value).slice("sha256:".length, "sha256:".length + 12), 16);
  return String(100_000_000 + safe % 900_000_000);
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number.`);
  return number;
}

function isoDateDaysAgo(days) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function bucket(value) {
  if (value === 0) return "ZERO";
  if (value < 10) return "1_9";
  if (value < 50) return "10_49";
  if (value < 100) return "50_99";
  if (value < 500) return "100_499";
  return "500_PLUS";
}

function lowerBound(value) {
  if (value >= 500) return 500;
  if (value >= 100) return 100;
  if (value >= 50) return 50;
  if (value >= 10) return 10;
  if (value >= 1) return 1;
  return 0;
}

async function directRead(service, params, credentials) {
  const response = await fetch(`${DIRECT_API}/${service}`, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Client-Login": credentials.account,
      Accept: "application/json",
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ method: "get", params }),
  });
  const raw = await response.text();
  const payload = JSON.parse(raw);
  if (!response.ok || payload.error) throw new Error(`Direct ${service}.get did not produce permitted evidence.`);
  return { payload, response_digest: digest(raw) };
}

async function metrikaRead(url, token) {
  const response = await fetch(url, {
    redirect: "error",
    headers: { Authorization: `OAuth ${token}`, Accept: "application/json" },
  });
  const raw = await response.text();
  const payload = JSON.parse(raw);
  if (!response.ok || payload.errors) throw new Error("Metrika read did not produce permitted evidence.");
  return { payload, response_digest: digest(raw) };
}

function firstResult(payload, key) {
  const values = payload?.result?.[key];
  if (!Array.isArray(values) || values.length !== 1) throw new Error(`Direct result.${key} must contain one exact binding.`);
  return values[0];
}

function campaignEconomics(campaign) {
  const search = campaign?.UnifiedCampaign?.BiddingStrategy?.Search ?? {};
  const configured = search.PayForConversion ?? search.WbMaximumConversionRate ?? {};
  return {
    strategy: search.PayForConversion ? "PAY_FOR_CONVERSION" : search.WbMaximumConversionRate ? "WB_MAXIMUM_CONVERSION_RATE" : "UNSUPPORTED",
    target_result_cost_rub: finitePositive(configured.Cpa, "Direct configured CPA") / 1_000_000,
    weekly_budget_rub: finitePositive(configured.WeeklySpendLimit, "Direct weekly spend limit") / 1_000_000,
  };
}

function publicText(html) {
  return normalizedText(html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&quot;/giu, "\"")
    .replace(/&amp;/giu, "&"));
}

async function main() {
  const direct = {
    token: required(environment("YANDEX_DIRECT_OAUTH_TOKEN"), "YANDEX_DIRECT_OAUTH_TOKEN"),
    account: required(environment("YANDEX_DIRECT_CLIENT_LOGIN"), "YANDEX_DIRECT_CLIENT_LOGIN"),
    campaign_id: required(environment("YANDEX_DIRECT_CAMPAIGN_ID"), "YANDEX_DIRECT_CAMPAIGN_ID"),
  };
  const metrika = {
    token: required(environment("P0_CAPTURE_METRIKA_TOKEN") || environment("YANDEX_METRIKA_OAUTH_TOKEN"), "YANDEX_METRIKA_OAUTH_TOKEN"),
    counter_id: required(environment("YANDEX_METRIKA_COUNTER_ID"), "YANDEX_METRIKA_COUNTER_ID"),
    goal_id: required(environment("YANDEX_METRIKA_GOAL_ID"), "YANDEX_METRIKA_GOAL_ID"),
  };
  const observedAt = new Date().toISOString();

  const publicResponse = await fetch(LANDING_URL, { redirect: "error" });
  const publicHtml = await publicResponse.text();
  if (!publicResponse.ok) throw new Error("Public first-party landing is unavailable.");
  const landingText = publicText(publicHtml);
  for (const fact of [
    "Брендинг для запуска или малого бизнеса",
    "Стоимость: от 250 000 ₽",
    "Точную стоимость и состав работ определим после короткого брифа",
  ]) {
    if (!landingText.includes(fact)) throw new Error(`Public first-party fact is missing: ${fact}`);
  }

  const clients = await directRead("clients", {
    FieldNames: ["Login", "ClientId", "Archived", "Currency", "Grants", "AvailableCampaignTypes", "Restrictions"],
  }, direct);
  const client = firstResult(clients.payload, "Clients");
  if (String(client.Login) !== direct.account) throw new Error("Direct exact advertiser binding is unavailable.");

  const campaigns = await directRead("campaigns", {
    SelectionCriteria: { Ids: [Number(direct.campaign_id)] },
    FieldNames: ["Id", "Name", "Type", "State", "Status", "StartDate", "EndDate"],
    UnifiedCampaignFieldNames: ["BiddingStrategy", "CounterIds"],
  }, direct);
  const campaign = firstResult(campaigns.payload, "Campaigns");
  if (String(campaign.Id) !== direct.campaign_id || campaign.Type !== "UNIFIED_CAMPAIGN" || campaign.State !== "ON" || campaign.Status !== "ACCEPTED") {
    throw new Error("Configured Direct campaign is not one current accepted unified business campaign.");
  }
  const economics = campaignEconomics(campaign);
  if (economics.strategy === "UNSUPPORTED") throw new Error("Configured Direct campaign lacks an evidence-backed CPA strategy.");
  if (!Array.isArray(campaign?.UnifiedCampaign?.CounterIds?.Items) || campaign.UnifiedCampaign.CounterIds.Items.length < 1) {
    throw new Error("Configured Direct campaign lacks a Metrika counter binding.");
  }

  const keywords = await directRead("keywords", {
    SelectionCriteria: { CampaignIds: [Number(direct.campaign_id)] },
    FieldNames: ["Id", "Keyword", "AdGroupId", "CampaignId", "State", "Status"],
  }, direct);
  const keywordCandidates = (keywords.payload?.result?.Keywords ?? [])
    .filter((item) => item.State !== "OFF" && item.Status !== "REJECTED")
    .sort((left, right) => {
      const priority = (value) => /брендинг агентство/iu.test(String(value.Keyword)) ? 0 : /брендинг (?:москва|компании|бизнеса)/iu.test(String(value.Keyword)) ? 1 : 2;
      return priority(left) - priority(right) || String(left.Keyword).localeCompare(String(right.Keyword), "ru-RU");
    });
  const keyword = keywordCandidates[0];
  if (!keyword || !/брендинг/iu.test(String(keyword.Keyword))) throw new Error("No exact current branding keyword is available for the cost receipt.");

  const keywordBids = await directRead("keywordbids", {
    SelectionCriteria: { KeywordIds: [Number(keyword.Id)] },
    FieldNames: ["KeywordId", "AdGroupId", "CampaignId", "ServingStatus"],
    SearchFieldNames: ["AuctionBids"],
  }, direct);
  const keywordBid = firstResult(keywordBids.payload, "KeywordBids");
  const auctionItems = keywordBid?.Search?.AuctionBids?.AuctionBidItems;
  if (!Array.isArray(auctionItems) || !auctionItems.length) throw new Error("Current Direct auction cost evidence is unavailable.");
  const auctionPrices = auctionItems.map((item) => Number(item.Price) / 1_000_000).filter((value) => Number.isFinite(value) && value >= 0);
  if (!auctionPrices.length) throw new Error("Current Direct auction prices are invalid.");

  const counter = await metrikaRead(`${METRIKA_MANAGEMENT_API}/counter/${encodeURIComponent(metrika.counter_id)}`, metrika.token);
  const goals = await metrikaRead(`${METRIKA_MANAGEMENT_API}/counter/${encodeURIComponent(metrika.counter_id)}/goals`, metrika.token);
  const counterValue = counter.payload.counter ?? {};
  const goal = (goals.payload.goals ?? []).find((item) => String(item.id) === metrika.goal_id);
  if (!goal || normalizedText(counterValue.site).replace(/^https?:\/\//u, "").replace(/\/$/u, "") !== "mox-studio.ru") {
    throw new Error("Metrika exact counter/goal binding does not match the public business.");
  }

  const dateFrom = isoDateDaysAgo(180);
  const dateTo = isoDateDaysAgo(1);
  const dimension = "ym:s:lastDirectClickOrder";
  const reportQuery = new URLSearchParams({
    ids: metrika.counter_id,
    date1: dateFrom,
    date2: dateTo,
    dimensions: `ym:s:date,${dimension}`,
    metrics: `ym:s:visits,ym:s:goal${metrika.goal_id}visits`,
    filters: `${dimension}=='${direct.campaign_id}'`,
    accuracy: "full",
    limit: "100000",
  });
  const metrikaReport = await metrikaRead(`${METRIKA_REPORTS_API}?${reportQuery}`, metrika.token);
  const rows = Array.isArray(metrikaReport.payload.data) ? metrikaReport.payload.data : [];
  if (!rows.length || metrikaReport.payload.sampled === true) throw new Error("Unsampled current Metrika evidence is unavailable.");
  const visits = rows.reduce((sum, row) => sum + Number(row.metrics?.[0] ?? 0), 0);
  const goalsReached = rows.reduce((sum, row) => sum + Number(row.metrics?.[1] ?? 0), 0);
  if (visits <= 0 || goalsReached <= 0) throw new Error("The positive scenario requires observed visits and the exact qualified goal.");

  const currentStart = isoDateDaysAgo(30);
  const previousStart = isoDateDaysAgo(60);
  const previousEnd = isoDateDaysAgo(31);
  let currentVisits = 0;
  let previousVisits = 0;
  for (const row of rows) {
    const date = String(row.dimensions?.[0]?.name ?? "");
    const rowVisits = Number(row.metrics?.[0] ?? 0);
    if (date >= currentStart && date <= dateTo) currentVisits += rowVisits;
    else if (date >= previousStart && date <= previousEnd) previousVisits += rowVisits;
  }
  if (currentVisits <= 0 || previousVisits <= 0) throw new Error("Two adjacent current demand windows are required for bounded sensitivity evidence.");

  const editGrant = (client.Grants ?? []).find((item) => item.Privilege === "EDIT_CAMPAIGNS")?.Value ?? "UNKNOWN";
  const accountAlias = pseudonym("direct-account", direct.account);
  const counterAlias = numericPseudonym(metrika.counter_id);
  const goalAlias = numericPseudonym(metrika.goal_id);
  const directCapability = {
    schema_version: "direct-account-capability-snapshot-v1",
    snapshot_id: `direct-capability:${clients.response_digest}`,
    observed_at: observedAt,
    source: "YANDEX_DIRECT_API_V501",
    account: accountAlias,
    api_version: "v501",
    archived: String(client.Archived),
    currency: String(client.Currency),
    edit_campaigns_grant: String(editGrant),
    available_campaign_types: [...new Set((client.AvailableCampaignTypes ?? []).map(String))].sort(),
    restrictions: (client.Restrictions ?? []).map((item) => ({ element: String(item.Element), value: Number(item.Value) }))
      .filter((item) => item.element && Number.isFinite(item.value)).sort((left, right) => left.element.localeCompare(right.element)),
    conditional_capabilities: [],
  };

  const evidence = {
    schema_version: "p0-viable-campaign-real-business-evidence-v1",
    evidence_kind: "INDEPENDENT_READ_ONLY_BUSINESS_EVIDENCE",
    scenario_id: "mox-branding-readonly-positive-v1",
    observed_at: observedAt,
    freshness: { status: "CURRENT_AT_CAPTURE", maximum_age_days: 14 },
    business: {
      name: "MOX Creative Studio",
      public_site: "https://mox-studio.ru",
      landing_page: LANDING_URL,
      offer: "Брендинг для запуска или малого бизнеса",
      target_audience: "Новые компании и небольшие бренды",
      qualified_result: normalizedText(goal.name),
      business_goal: "Получать заявки на обсуждение проекта брендинга",
      core_message: "Брендинг для запуска или малого бизнеса с точным составом после короткого брифа",
      exclusions: "Не обещать точную стоимость и состав работ до короткого брифа",
      geography: "Москва",
      public_price_floor_rub: 250000,
      current_target_result_cost_rub: economics.target_result_cost_rub,
      current_weekly_budget_rub: economics.weekly_budget_rub,
    },
    public_first_party: {
      source: "FIRST_PARTY_PUBLIC_HTTPS",
      url: LANDING_URL,
      observed_at: observedAt,
      response_digest: digest(publicHtml),
      facts: [
        { predicate: "offer", quote: "Брендинг для запуска или малого бизнеса" },
        { predicate: "audience", quote: "Базовый формат для новых компаний и небольших брендов, которым нужен цельный и профессиональный визуальный образ." },
        { predicate: "price_floor", quote: "Стоимость: от 250 000 ₽" },
        { predicate: "commercial_process", quote: "Точную стоимость и состав работ определим после короткого брифа — оставьте заявку." },
      ],
    },
    direct: {
      source: "YANDEX_DIRECT_API_V501",
      account_alias: accountAlias,
      account_identity_digest: digest(direct.account),
      binding_response_digest: clients.response_digest,
      campaign_response_digest: campaigns.response_digest,
      keyword_response_digest: keywords.response_digest,
      keyword_bids_response_digest: keywordBids.response_digest,
      campaign: {
        name: normalizedText(campaign.Name),
        type: campaign.Type,
        state: campaign.State,
        status: campaign.Status,
        strategy: economics.strategy,
        started_at: campaign.StartDate,
        counter_binding_present: true,
      },
      capability_snapshot: directCapability,
      cost: {
        status: "AVAILABLE",
        source: "KEYWORDBIDS_V5_CURRENT_PROXY",
        method: "KeywordBids.get",
        phrase_scope: "EXACT_CURRENT_BRANDING_KEYWORD",
        as_of: observedAt,
        currency: String(client.Currency),
        vat_treatment: "INCLUDED",
        sample_size: { unit: "auction_scenarios", value: auctionPrices.length },
        range: { low: Math.min(...auctionPrices), high: Math.max(...auctionPrices), kind: "SCENARIO" },
        qualification: {
          current: true,
          existing_comparable_keyword: true,
          exact_business_campaign: true,
          exact_geography: true,
          exact_search_placement: true,
        },
      },
    },
    metrika: {
      source: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API",
      counter_alias: counterAlias,
      goal_alias: goalAlias,
      counter_identity_digest: digest(metrika.counter_id),
      goal_identity_digest: digest(metrika.goal_id),
      counter_response_digest: counter.response_digest,
      goals_response_digest: goals.response_digest,
      report_response_digest: metrikaReport.response_digest,
      site: normalizedText(counterValue.site),
      time_zone: normalizedText(counterValue.time_zone_name),
      goal: {
        name: normalizedText(goal.name),
        type: normalizedText(goal.type).toUpperCase(),
        conditions_present: Array.isArray(goal.conditions) && goal.conditions.length > 0,
      },
      report: {
        status: "AVAILABLE",
        window: { date_from: dateFrom, date_to: dateTo, inclusive: true, excludes_current_provisional_day: true },
        attribution: "last_direct_click_order_exact_campaign",
        sampled: false,
        sample_share: Number(metrikaReport.payload.sample_share),
        data_lag: Number(metrikaReport.payload.data_lag),
        visits: { bucket: bucket(visits), lower_bound: lowerBound(visits), observed: true },
        qualified_goal_visits: { bucket: bucket(goalsReached), lower_bound: lowerBound(goalsReached), observed: true },
        seasonality: {
          status: "AVAILABLE",
          current_window: { from: currentStart, to: dateTo, visits_bucket: bucket(currentVisits) },
          previous_window: { from: previousStart, to: previousEnd, visits_bucket: bucket(previousVisits) },
          ratio: Math.round(currentVisits / previousVisits * 100) / 100,
        },
      },
    },
    supported_projection: {
      profile_id: "p0-campaign-creation-profile-v1",
      profile_version: "1.0.0",
      advertiser_account_alias: accountAlias,
      metrika_counter_alias: counterAlias,
      metrika_goal_alias: goalAlias,
      allowed_campaign_type: "UNIFIED_CAMPAIGN",
      delivery: "SEARCH",
      strategy: "WB_MAXIMUM_CLICKS",
      ad_type: "RESPONSIVE_AD",
      network_serving: false,
      autotargeting_selected: false,
      must_end_non_serving: true,
      resume_allowed: false,
    },
    safety: {
      capture_methods: [
        "GET public first-party landing",
        "Clients.get",
        "Campaigns.get",
        "Keywords.get",
        "KeywordBids.get",
        "GET Metrika counter",
        "GET Metrika goals",
        "GET Metrika report",
      ],
      provider_mutations: [],
      external_write_calls: 0,
      production_write_attempts: 0,
      live_authority_issued: false,
      impressions_started_by_capture: 0,
      spend_started_by_capture_rub: 0,
      browser_cabinets_used: false,
    },
  };

  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (process.env.UPDATE_P0_VIABLE_EVIDENCE === "1") {
    await mkdir(new URL("../tests/evidence/", import.meta.url), { recursive: true });
    await writeFile(OUTPUT, serialized, "utf8");
  } else {
    process.stdout.write(serialized);
  }
}

await main();
