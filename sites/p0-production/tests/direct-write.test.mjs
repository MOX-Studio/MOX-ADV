import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSONbigFactory from "json-bigint";

import { buildPublishProjection } from "../lib/campaign-draft.ts";

const JSONbig = JSONbigFactory({ useNativeBigInt: true });
import {
  correctSuspendedCampaignAndResubmitModeration,
  createSuspendedCampaign,
  DirectWriteError,
  pollSuspendedCampaignModeration,
  reconcileCorrectedCampaignUpdate,
} from "../lib/direct-write.ts";

function jsonResponse(result, status = 200) {
  return new Response(JSON.stringify({ result }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function projection() {
  return buildPublishProjection(
    {
      product: "Участие со стендом в выставке ИННОПРОМ",
      audience: "Руководители промышленных компаний",
      value: "Участие со стендом в выставке ИННОПРОМ",
      qualified_result: "Заявка на участие",
    },
    {
      geography: "Россия",
      weekly_budget_rub: "10000",
      target_cpa_rub: "2000",
      goal: "Получать заявки",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      landing_page: "https://innoprom.com/participant/",
    },
    {
      campaign_name: "ИННОПРОМ · Россия",
      group_name: "Заявка на участие",
      keyword: "иннопром стать участником",
      negative_keywords: "бесплатно, вакансии, билет",
      ad_title: "Участие в ИННОПРОМ",
      ad_text: "Подайте заявку на участие.",
      advertiser_account: "moxstudio",
      currency: "RUB",
      capability_snapshot_id: "direct-capability:moxstudio:1",
      metrika_counter_id: "424242",
      metrika_goal_id: "1717",
      measurement_readiness_id: "measurement-ready-1",
    },
  );
}

function responsiveReadback(value) {
  return {
    Titles: value.Titles.map((Title) => ({ Title, Status: "ACCEPTED", StatusClarification: null })),
    Texts: value.Texts.map((Text) => ({ Text, Status: "ACCEPTED", StatusClarification: null })),
    Href: value.Href,
  };
}

function successfulFetcher(calls, adId = "401", options = {}) {
  const expected = projection();
  let campaignGetCalls = 0;
  let adGetCalls = 0;
  return async (url, init) => {
    const rawBody = String(init.body);
    const body = JSON.parse(rawBody);
    const service = new URL(url).pathname.split("/").at(-1);
    calls.push({ service, method: body.method, params: body.params, rawBody });
    const key = `${service}.${body.method}`;
    const results = {
      "campaigns.add": { AddResults: [{ Id: 101 }] },
      "campaigns.suspend": { SuspendResults: [{ Id: 101 }] },
      "adgroups.add": { AddResults: [{ Id: 201 }] },
      "keywords.add": { AddResults: [{ Id: 301 }] },
      "ads.moderate": { ModerateResults: [{ Id: options.moderateId ?? adId }] },
    };
    if (key === "campaigns.get") {
      campaignGetCalls += 1;
      return jsonResponse({ Campaigns: [{
        ...expected.direct.campaign,
        Id: 101,
        Type: "UNIFIED_CAMPAIGN",
        State: "SUSPENDED",
        Status: campaignGetCalls < 3 ? "DRAFT" : "MODERATION",
      }] });
    }
    if (key === "adgroups.get") {
      return jsonResponse({ AdGroups: [{
        Id: 201,
        CampaignId: 101,
        Type: "UNIFIED_AD_GROUP",
        Status: "ACCEPTED",
        ServingStatus: "ELIGIBLE",
        ...expected.direct.ad_group,
      }] });
    }
    if (key === "keywords.get") {
      return jsonResponse({ Keywords: [{ Id: 301, AdGroupId: 201, Keyword: "иннопром стать участником", Status: "ACCEPTED", State: "ON" }] });
    }
    if (key === "ads.add") {
      return new Response(`{"result":{"AddResults":[{"Id":${adId}}]}}`, { headers: { "Content-Type": "application/json" } });
    }
    if (key === "ads.get") {
      adGetCalls += 1;
      return new Response(JSONbig.stringify({ result: { Ads: [{
        Id: BigInt(adId),
        CampaignId: 101,
        AdGroupId: 201,
        Type: "RESPONSIVE_AD",
        Status: adGetCalls === 1 ? "DRAFT" : "MODERATION",
        State: "OFF",
        StatusClarification: null,
        ResponsiveAd: responsiveReadback(expected.direct.ad.ResponsiveAd),
      }] } }), { headers: { "Content-Type": "application/json" } });
    }
    return jsonResponse(results[key]);
  };
}

test("official-shape fixture proves create, explicit suspend and complete RESPONSIVE_AD semantic readback", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/direct/responsive-campaign-graph.json", import.meta.url), "utf8"));
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(String(init.body));
    const service = new URL(url).pathname.split("/").at(-1);
    const operation = `${service}.${body.method}`;
    calls.push({ operation, params: body.params });
    if (operation === "campaigns.add") return jsonResponse({ AddResults: [{ Id: fixture.ids.campaign }] });
    if (operation === "campaigns.suspend") return jsonResponse({ SuspendResults: [{ Id: fixture.ids.campaign }] });
    if (operation === "campaigns.get") return jsonResponse({ Campaigns: [fixture.campaign] });
    if (operation === "adgroups.add") return jsonResponse({ AddResults: [{ Id: fixture.ids.ad_group }] });
    if (operation === "adgroups.get") return jsonResponse({ AdGroups: [fixture.ad_group] });
    if (operation === "keywords.add") return jsonResponse({ AddResults: [{ Id: fixture.ids.keyword }] });
    if (operation === "keywords.get") return jsonResponse({ Keywords: [fixture.keyword] });
    if (operation === "ads.add") return jsonResponse({ AddResults: [{ Id: fixture.ids.ad }] });
    if (operation === "ads.get") return jsonResponse({ Ads: [fixture.ad] });
    if (operation === "ads.moderate") return jsonResponse({ ModerateResults: [{ Id: fixture.ids.ad }] });
    throw new Error(`Unexpected official-shape call ${operation}`);
  };

  const result = await createSuspendedCampaign(
    { token: "fixture-only", account: "moxstudio" },
    projection(),
    fetcher,
  );

  assert.equal(result.supported_graph_verified, true);
  assert.equal(result.semantic_graph.ad.Type, "RESPONSIVE_AD");
  assert.equal(result.semantic_graph.ad.Titles.length, 2);
  assert.equal(result.semantic_graph.ad.Texts.length, 2);
  assert.equal(calls[0].operation, "campaigns.add");
  assert.equal(calls[1].operation, "campaigns.suspend");
  assert.equal(calls[2].operation, "campaigns.get");
  assert.equal(calls.some((call) => call.operation === "campaigns.resume"), false);
  assert.equal(Object.hasOwn(calls.find((call) => call.operation === "ads.add").params.Ads[0], "TextAd"), false);
  assert.deepEqual(calls.find((call) => call.operation === "ads.get").params.ResponsiveAdFieldNames, ["Titles", "Texts", "Href"]);
});

test("creates a real-shape Direct graph and ends owner-suspended after moderation", async () => {
  const calls = [];
  const progress = [];
  const result = await createSuspendedCampaign(
    { token: "secret", account: "moxstudio" },
    projection(),
    successfulFetcher(calls),
    (status) => progress.push(status),
  );

  assert.equal(result.campaign_id, "101");
  assert.equal(result.campaign_state, "SUSPENDED");
  assert.equal(result.spend_started, false);
  assert.equal(result.status, "MODERATION_PENDING");
  assert.deepEqual(progress, [
    "CAMPAIGN_CREATED",
    "NON_SERVING_CONFIRMED",
    "AD_GROUP_CREATED",
    "KEYWORD_CREATED",
    "AD_CREATED",
    "OBJECT_GRAPH_VERIFIED",
    "MODERATION_SUBMITTED",
    "MODERATION_PENDING",
  ]);
  assert.equal(calls.some((call) => call.method === "resume"), false);
  assert.equal(calls.filter((call) => call.method === "suspend").length, 1);
  assert.deepEqual(
    calls.slice(0, 4).map((call) => `${call.service}.${call.method}`),
    ["campaigns.add", "campaigns.suspend", "campaigns.get", "adgroups.add"],
  );
  assert.equal(calls.filter((call) => call.service === "campaigns" && call.method === "get").length, 3);
  assert.equal(calls.filter((call) => call.service === "adgroups" && call.method === "get").length, 2);
  assert.equal(calls.filter((call) => call.service === "keywords" && call.method === "get").length, 2);
  assert.equal(calls.filter((call) => call.service === "ads" && call.method === "get").length, 2);
  const moderationIndex = calls.findIndex((call) => call.service === "ads" && call.method === "moderate");
  assert.ok(calls.slice(0, moderationIndex).some((call) => call.service === "adgroups" && call.method === "get"));
  assert.ok(calls.slice(moderationIndex + 1).some((call) => call.service === "adgroups" && call.method === "get"));
  assert.equal(
    calls[0].params.Campaigns[0].UnifiedCampaign.BiddingStrategy.Network.BiddingStrategyType,
    "SERVING_OFF",
  );
});

test("updates the exact suspended provider graph and resubmits only the corrected ad revision", async () => {
  const corrected = projection();
  corrected.direct.ad.ResponsiveAd.Texts[0] = "Исправленный текст после provider clarification.";
  const calls = [];
  let adReads = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(String(init.body));
    const service = new URL(url).pathname.split("/").at(-1);
    const operation = `${service}.${body.method}`;
    calls.push({ operation, params: body.params });
    if (operation === "campaigns.get") return jsonResponse({ Campaigns: [{
      ...corrected.direct.campaign,
      Id: 101,
      Name: corrected.direct.campaign.Name,
      Type: "UNIFIED_CAMPAIGN",
      State: "SUSPENDED",
      Status: "ACCEPTED",
      StartDate: corrected.direct.campaign.StartDate,
      EndDate: corrected.direct.campaign.EndDate,
      UnifiedCampaign: corrected.direct.campaign.UnifiedCampaign,
    }] });
    if (operation === "adgroups.get") return jsonResponse({ AdGroups: [{ Id: 201, CampaignId: 101, Type: "UNIFIED_AD_GROUP", ...corrected.direct.ad_group }] });
    if (operation === "keywords.get") return jsonResponse({ Keywords: [{ Id: 301, AdGroupId: 201, Keyword: corrected.direct.keyword.Keyword }] });
    if (operation === "ads.get") {
      adReads += 1;
      return jsonResponse({ Ads: [{
        Id: 401,
        CampaignId: 101,
        AdGroupId: 201,
        Type: "RESPONSIVE_AD",
        Status: adReads === 1 ? "DRAFT" : "MODERATION",
        State: "OFF",
        StatusClarification: null,
        ResponsiveAd: responsiveReadback(corrected.direct.ad.ResponsiveAd),
      }] });
    }
    if (body.method === "update") return jsonResponse({ UpdateResults: [{ Id: { campaigns: 101, adgroups: 201, keywords: 301, ads: 401 }[service] }] });
    if (operation === "ads.moderate") return jsonResponse({ ModerateResults: [{ Id: 401 }] });
    throw new Error(`Unexpected Direct call ${operation}`);
  };

  const result = await correctSuspendedCampaignAndResubmitModeration(
    { token: "secret", account: "moxstudio" },
    corrected,
    { campaignId: "101", adGroupId: "201", keywordId: "301", adId: "401" },
    ["/direct/ad/ResponsiveAd/Texts"],
    fetcher,
  );

  assert.equal(result.status, "MODERATION_PENDING");
  assert.equal(result.campaign_state, "SUSPENDED");
  assert.equal(result.provider_ids.campaign_id, "101");
  assert.equal(result.provider_ids.ad_ids[0], "401");
  assert.equal(result.semantic_graph.ad.Texts[0], "Исправленный текст после provider clarification.");
  assert.equal(calls.some((call) => /\.(?:add|resume)$/u.test(call.operation)), false);
  assert.deepEqual(calls.filter((call) => call.operation.endsWith(".update")).map((call) => call.operation), ["ads.update"]);
  assert.equal(calls.find((call) => call.operation === "ads.update").params.Ads[0].Id, 401);
  assert.ok(calls.findIndex((call) => call.operation === "ads.moderate") > calls.findIndex((call) => call.operation === "ads.get"));

  const reconciliationStart = calls.length;
  const reconciled = await reconcileCorrectedCampaignUpdate(
    { token: "secret", account: "moxstudio" },
    corrected,
    { campaignId: "101", adGroupId: "201", keywordId: "301", adId: "401" },
    "Ads.update",
    fetcher,
  );
  assert.equal(reconciled.completed_update, "Ads.update");
  assert.equal(calls.slice(reconciliationStart).every((call) => call.operation.endsWith(".get")), true);
});

test("an ambiguous correction update holds reconciliation and is never retried or moderated", async () => {
  const corrected = projection();
  corrected.direct.ad.ResponsiveAd.Texts[0] = "Исправленный текст после provider clarification.";
  const calls = [];
  await assert.rejects(
    () => correctSuspendedCampaignAndResubmitModeration(
      { token: "secret", account: "moxstudio" },
      corrected,
      { campaignId: "101", adGroupId: "201", keywordId: "301", adId: "401" },
      ["/direct/ad/ResponsiveAd/Texts"],
      async (url, init) => {
        const body = JSON.parse(String(init.body));
        const service = new URL(url).pathname.split("/").at(-1);
        const operation = `${service}.${body.method}`;
        calls.push(operation);
        if (operation === "campaigns.get") return jsonResponse({ Campaigns: [{ Id: 101, State: "SUSPENDED" }] });
        if (operation === "ads.update") return new Response("gateway timeout", { status: 504 });
        throw new Error(`Unexpected Direct call ${operation}`);
      },
    ),
    (error) => {
      assert.ok(error instanceof DirectWriteError);
      assert.equal(error.partial.requires_reconciliation, true);
      assert.equal(error.partial.containment, "RECONCILIATION_REQUIRED");
      assert.equal(error.partial.account_lock, "HELD_FOR_RECONCILIATION");
      return true;
    },
  );
  assert.deepEqual(calls, ["campaigns.get", "ads.update"]);
  assert.equal(calls.includes("ads.moderate"), false);
});

test("polls one exact supported graph without mutation and preserves terminal ad clarification", async () => {
  const expected = projection();
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(String(init.body));
    const service = new URL(url).pathname.split("/").at(-1);
    const operation = `${service}.${body.method}`;
    calls.push(operation);
    if (operation === "campaigns.get") return jsonResponse({ Campaigns: [{
      ...expected.direct.campaign,
      Id: 101,
      Name: expected.direct.campaign.Name,
      Type: "UNIFIED_CAMPAIGN",
      State: "SUSPENDED",
      Status: "ACCEPTED",
      StartDate: expected.direct.campaign.StartDate,
      EndDate: expected.direct.campaign.EndDate,
      UnifiedCampaign: expected.direct.campaign.UnifiedCampaign,
    }] });
    if (operation === "adgroups.get") return jsonResponse({ AdGroups: [{
      Id: 201,
      CampaignId: 101,
      Type: "UNIFIED_AD_GROUP",
      ...expected.direct.ad_group,
    }] });
    if (operation === "keywords.get") return jsonResponse({ Keywords: [{
      Id: 301,
      AdGroupId: 201,
      Keyword: expected.direct.keyword.Keyword,
    }] });
    if (operation === "ads.get") return jsonResponse({ Ads: [{
      Id: 401,
      CampaignId: 101,
      AdGroupId: 201,
      Type: "RESPONSIVE_AD",
      Status: "REJECTED",
      State: "OFF",
      StatusClarification: "Текст отклонён правилами площадки",
      ResponsiveAd: responsiveReadback(expected.direct.ad.ResponsiveAd),
    }] });
    throw new Error(`Unexpected Direct call ${operation}`);
  };

  const result = await pollSuspendedCampaignModeration(
    { token: "secret", account: "moxstudio" },
    expected,
    { campaignId: "101", adGroupId: "201", keywordId: "301", adIds: ["401"] },
    fetcher,
  );

  assert.deepEqual(calls, ["campaigns.get", "adgroups.get", "keywords.get", "ads.get"]);
  assert.equal(calls.some((operation) => !operation.endsWith(".get")), false);
  assert.equal(result.campaign_state, "SUSPENDED");
  assert.equal(result.supported_graph_verified, true);
  assert.deepEqual(result.ad_outcomes, [{
    ad_id: "401",
    ad_group_id: "201",
    status: "REJECTED",
    status_clarification: "Текст отклонён правилами площадки",
    provider_issues: [],
  }]);
  assert.equal(result.semantic_graph.campaign.State, "SUSPENDED");
});

test("official PREACCEPTED remains pending before the same suspended graph becomes accepted", async () => {
  const expected = projection();
  const calls = [];
  let adStatus = "PREACCEPTED";
  const fetcher = async (url, init) => {
    const body = JSON.parse(String(init.body));
    const service = new URL(url).pathname.split("/").at(-1);
    const operation = `${service}.${body.method}`;
    calls.push(operation);
    if (operation === "campaigns.get") return jsonResponse({ Campaigns: [{
      ...expected.direct.campaign,
      Id: 101,
      Name: expected.direct.campaign.Name,
      Type: "UNIFIED_CAMPAIGN",
      State: "SUSPENDED",
      Status: adStatus === "ACCEPTED" ? "ACCEPTED" : "MODERATION",
      StartDate: expected.direct.campaign.StartDate,
      EndDate: expected.direct.campaign.EndDate,
      UnifiedCampaign: expected.direct.campaign.UnifiedCampaign,
    }] });
    if (operation === "adgroups.get") return jsonResponse({ AdGroups: [{
      Id: 201,
      CampaignId: 101,
      Type: "UNIFIED_AD_GROUP",
      ...expected.direct.ad_group,
    }] });
    if (operation === "keywords.get") return jsonResponse({ Keywords: [{
      Id: 301,
      AdGroupId: 201,
      Keyword: expected.direct.keyword.Keyword,
    }] });
    if (operation === "ads.get") return jsonResponse({ Ads: [{
      Id: 401,
      CampaignId: 101,
      AdGroupId: 201,
      Type: "RESPONSIVE_AD",
      Status: adStatus,
      State: "OFF",
      StatusClarification: adStatus === "PREACCEPTED" ? "Автоматическая предварительная проверка" : null,
      ResponsiveAd: responsiveReadback(expected.direct.ad.ResponsiveAd),
    }] });
    throw new Error(`Unexpected Direct call ${operation}`);
  };

  const pending = await pollSuspendedCampaignModeration(
    { token: "secret", account: "moxstudio" },
    expected,
    { campaignId: "101", adGroupId: "201", keywordId: "301", adIds: ["401"] },
    fetcher,
  );
  assert.equal(pending.status, "MODERATION_PENDING");
  assert.equal(pending.moderation_status, "PREACCEPTED");
  assert.equal(pending.ad_outcomes[0].status_clarification, "Автоматическая предварительная проверка");

  adStatus = "ACCEPTED";
  const accepted = await pollSuspendedCampaignModeration(
    { token: "secret", account: "moxstudio" },
    expected,
    { campaignId: "101", adGroupId: "201", keywordId: "301", adIds: ["401"] },
    fetcher,
  );
  assert.equal(accepted.status, "DIRECT_ACCEPTED");
  assert.equal(accepted.campaign_state, "SUSPENDED");
  assert.equal(accepted.spend_started, false);
  assert.equal(calls.every((operation) => operation.endsWith(".get")), true);
});

test("preserves a Direct ad ID larger than JavaScript safe integer", async () => {
  const calls = [];
  const exactAdId = "1919036093096389375";
  const result = await createSuspendedCampaign(
    { token: "secret", account: "moxstudio" },
    projection(),
    successfulFetcher(calls, exactAdId),
  );
  assert.equal(result.ad_id, exactAdId);
  const moderate = calls.find((call) => call.service === "ads" && call.method === "moderate");
  assert.match(moderate.rawBody, new RegExp(exactAdId));
});

test("continues an owned draft without creating a duplicate campaign", async () => {
  const calls = [];
  const result = await createSuspendedCampaign(
    { token: "secret", account: "moxstudio" },
    projection(),
    successfulFetcher(calls),
    () => undefined,
    { campaignId: "101" },
  );
  assert.equal(result.campaign_id, "101");
  assert.equal(result.recovered_existing, true);
  assert.equal(calls.some((call) => call.service === "campaigns" && call.method === "add"), false);
});

test("continues an owned object graph without duplicating children", async () => {
  const calls = [];
  const result = await createSuspendedCampaign(
    { token: "secret", account: "moxstudio" },
    projection(),
    successfulFetcher(calls, "1919036093096389375"),
    () => undefined,
    { campaignId: "101", adGroupId: "201", keywordId: "301", adId: "1919036093096389375" },
  );
  assert.equal(result.campaign_id, "101");
  assert.equal(result.ad_group_id, "201");
  assert.equal(result.keyword_id, "301");
  assert.equal(result.ad_id, "1919036093096389375");
  assert.equal(calls.some((call) => call.method === "add"), false);
});

test("confirms non-serving containment after a downstream failure", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(String(init.body));
    const service = new URL(url).pathname.split("/").at(-1);
    calls.push(`${service}.${body.method}`);
    if (service === "campaigns" && body.method === "add") {
      return jsonResponse({ AddResults: [{ Id: 101 }] });
    }
    if (service === "campaigns" && body.method === "suspend") {
      return jsonResponse({ SuspendResults: [{ Id: 101 }] });
    }
    if (service === "campaigns" && body.method === "get") {
      return jsonResponse({ Campaigns: [{ Id: 101, State: "SUSPENDED", Status: "DRAFT" }] });
    }
    if (service === "adgroups" && body.method === "add") {
      return jsonResponse({ AddResults: [{ Errors: [{ Code: 5002, Message: "Группа отклонена" }] }] });
    }
    throw new Error(`Unexpected call ${service}.${body.method}`);
  };

  await assert.rejects(
    () => createSuspendedCampaign({ token: "secret", account: "moxstudio" }, projection(), fetcher),
    (error) => {
      assert.ok(error instanceof DirectWriteError);
      assert.equal(error.partial.campaign_id, "101");
      assert.equal(error.partial.containment, "NON_SERVING_CONFIRMED");
      return true;
    },
  );
  assert.equal(calls.includes("campaigns.resume"), false);
});

test("blocks every child write until Direct confirms explicit SUSPENDED state", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(String(init.body));
    const service = new URL(url).pathname.split("/").at(-1);
    calls.push(`${service}.${body.method}`);
    if (service === "campaigns" && body.method === "add") {
      return jsonResponse({ AddResults: [{ Id: 101 }] });
    }
    if (service === "campaigns" && body.method === "suspend") {
      return jsonResponse({ SuspendResults: [{ Id: 101 }] });
    }
    if (service === "campaigns" && body.method === "get") {
      return jsonResponse({ Campaigns: [{ Id: 101, State: "OFF", Status: "DRAFT" }] });
    }
    throw new Error(`Unexpected child write ${service}.${body.method}`);
  };

  await assert.rejects(
    () => createSuspendedCampaign({ token: "secret", account: "moxstudio" }, projection(), fetcher),
    (error) => {
      assert.ok(error instanceof DirectWriteError);
      assert.equal(error.code, "P0_EXPLICIT_SUSPEND_NOT_CONFIRMED");
      assert.equal(error.partial.containment, "NON_SERVING_CONFIRMED");
      return true;
    },
  );
  assert.deepEqual(calls, ["campaigns.add", "campaigns.suspend", "campaigns.get", "campaigns.get"]);
  assert.equal(calls.some((call) => call.startsWith("adgroups.")), false);
});

test("preserves a known Campaigns.add rejection without false reconciliation", async () => {
  await assert.rejects(
    () => createSuspendedCampaign(
      { token: "secret", account: "moxstudio" },
      projection(),
      async () => jsonResponse({
        AddResults: [{ Errors: [{ Code: 5001, Message: "Недельный бюджет ниже минимального" }] }],
      }),
    ),
    (error) => {
      assert.ok(error instanceof DirectWriteError);
      assert.equal(error.partial.rejected, true);
      assert.equal(error.partial.containment, undefined);
      assert.deepEqual(error.partial.api_errors, [{
        code: 5001,
        message: "Недельный бюджет ниже минимального",
        details: "",
      }]);
      assert.match(error.message, /Недельный бюджет ниже минимального/u);
      return true;
    },
  );
});

test("marks a lost Campaigns.add response for reconciliation before any retry", async () => {
  await assert.rejects(
    () => createSuspendedCampaign(
      { token: "secret", account: "moxstudio" },
      projection(),
      async () => {
        throw new Error("connection lost after request");
      },
    ),
    (error) => {
      assert.ok(error instanceof DirectWriteError);
      assert.equal(error.partial.add_attempted, true);
      assert.equal(error.partial.containment, "RECONCILIATION_REQUIRED");
      return true;
    },
  );
});

test("rejects a moderation acknowledgement for any ID other than the exact submitted ad", async () => {
  const calls = [];
  await assert.rejects(
    () => createSuspendedCampaign(
      { token: "secret", account: "moxstudio" },
      projection(),
      successfulFetcher(calls, "401", { moderateId: "999" }),
    ),
    (error) => {
      assert.ok(error instanceof DirectWriteError);
      assert.equal(error.code, "P0_DIRECT_ACTION_FAILED");
      assert.equal(error.partial.containment, "NON_SERVING_CONFIRMED");
      return true;
    },
  );
});

test("rejects a silently altered selected field in the complete Direct graph", async () => {
  const expected = projection();
  let campaignGetCalls = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(String(init.body));
    const service = new URL(url).pathname.split("/").at(-1);
    const key = `${service}.${body.method}`;
    if (key === "campaigns.add") return jsonResponse({ AddResults: [{ Id: 101 }] });
    if (key === "campaigns.suspend") return jsonResponse({ SuspendResults: [{ Id: 101 }] });
    if (key === "campaigns.get") {
      campaignGetCalls += 1;
      return jsonResponse({ Campaigns: [{
        ...expected.direct.campaign,
        Id: 101,
        Name: expected.direct.campaign.Name,
        Type: "UNIFIED_CAMPAIGN",
        Status: campaignGetCalls === 1 ? "DRAFT" : "MODERATION",
        State: "SUSPENDED",
        StartDate: expected.direct.campaign.StartDate,
        EndDate: expected.direct.campaign.EndDate,
        UnifiedCampaign: expected.direct.campaign.UnifiedCampaign,
      }] });
    }
    if (key === "adgroups.add") return jsonResponse({ AddResults: [{ Id: 201 }] });
    if (key === "adgroups.get") return jsonResponse({ AdGroups: [{
      Id: 201,
      CampaignId: 101,
      Type: "UNIFIED_AD_GROUP",
      ...expected.direct.ad_group,
    }] });
    if (key === "keywords.add") return jsonResponse({ AddResults: [{ Id: 301 }] });
    if (key === "keywords.get") return jsonResponse({ Keywords: [{
      Id: 301,
      AdGroupId: 201,
      Keyword: "silently altered keyword",
    }] });
    if (key === "ads.add") return jsonResponse({ AddResults: [{ Id: 401 }] });
    if (key === "ads.moderate") return jsonResponse({ ModerateResults: [{ Id: 401 }] });
    if (key === "ads.get") return jsonResponse({ Ads: [{
      Id: 401,
      CampaignId: 101,
      AdGroupId: 201,
      Type: "RESPONSIVE_AD",
      Status: "MODERATION",
      State: "OFF",
      ResponsiveAd: responsiveReadback(expected.direct.ad.ResponsiveAd),
    }] });
    throw new Error(`Unexpected call ${key}`);
  };

  await assert.rejects(
    () => createSuspendedCampaign({ token: "secret", account: "moxstudio" }, expected, fetcher),
    (error) => {
      assert.ok(error instanceof DirectWriteError);
      assert.equal(error.code, "P0_DIRECT_GRAPH_MISMATCH");
      assert.equal(error.partial.containment, "NON_SERVING_CONFIRMED");
      return true;
    },
  );
});

test("rejects any projection that permits resume before calling Direct", async () => {
  const unsafe = projection();
  unsafe.safety.resume_allowed = true;
  let called = false;
  await assert.rejects(
    () => createSuspendedCampaign(
      { token: "secret", account: "moxstudio" },
      unsafe,
      async () => {
        called = true;
        return jsonResponse({});
      },
    ),
    /safety-контракт/u,
  );
  assert.equal(called, false);
});
