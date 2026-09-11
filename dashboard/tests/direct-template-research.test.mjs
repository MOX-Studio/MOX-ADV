import assert from "node:assert/strict";
import test from "node:test";
import { collectDirectTemplateResearch, directTemplateResearchContext } from "../lib/direct-template-research.ts";

function harness() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    if (url.includes("api-metrika")) return Response.json({ goals: [{ id: 77, name: "Все формы", type: "url", conditions: [{ type: "contain", url: "submitted" }] }] });
    if (url.endsWith("/reports")) {
      const params = JSON.parse(init.body).params;
      assert.deepEqual(params.Goals, ["77"]); assert.deepEqual(params.AttributionModels, ["AUTO"]);
      const body = params.ReportType === "CAMPAIGN_PERFORMANCE_REPORT"
        ? "CampaignId\tCampaignName\tClicks\tCost\tConversions_77_AUTO\n1\tПример\t8\t0.00\t--\n"
        : "CampaignId\tQuery\tClicks\tCost\tConversions_77_AUTO\n1\tучастие компании\t8\t0.00\t--\n1\tбез кликов\t0\t0.00\t--\n";
      return new Response(body, { status: 200, headers: { RequestId: "report-request" } });
    }
    const { method } = JSON.parse(init.body); assert.equal(method, "get"); assert.equal(init.redirect, "error");
    const service = url.split("/").at(-1);
    const data = {
      campaigns: { Campaigns: [{ Id: 1, Name: "Пример", State: "ON", UnifiedCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "PAY_FOR_CONVERSION", PayForConversion: { GoalId: 77 } } }, CounterIds: { Items: [88] }, PriorityGoals: null } }] },
      adgroups: { AdGroups: [{ Id: 2, CampaignId: 1 }] }, keywords: { Keywords: [{ Id: 3, CampaignId: 1, AdGroupId: 2, Keyword: "участие компании" }] },
      ads: { Ads: [{ Id: 4, CampaignId: 1, AdGroupId: 2, ResponsiveAd: { Titles: [{ Title: "Участие" }], Texts: [{ Text: "Условия участия" }], SitelinkSetId: 5, AdExtensions: [{ AdExtensionId: 6 }] } }] },
      sitelinks: { SitelinksSets: [{ Id: 5, Sitelinks: [{ Title: "Условия", Href: "https://owner.example/" }] }] }, adextensions: { AdExtensions: [{ Id: 6, Callout: { CalloutText: "Участие" } }] }, bidmodifiers: { BidModifiers: [] },
    }[service];
    assert.ok(data, service); return Response.json({ result: data }, { headers: { RequestId: service } });
  };
  return { calls, fetch };
}
const config = { token: "private-test-token", account: "test-account", metricaToken: "private-metrica-token", dateFrom: "2026-06-09", dateTo: "2026-09-06" };
test("collects linked creation examples and exact strategy goals using only permitted read methods", async () => {
  const h = harness(); const result = await collectDirectTemplateResearch(config, { fetch: h.fetch, now: () => "2026-09-09T10:00:00Z" });
  assert.equal(result.templates.length, 1); assert.deepEqual(result.templates[0].sitelink_set_ids, ["5"]);
  assert.equal(result.measurement[0].goals[0].id, 77); assert.equal(result.reports[0].goal_id, "77");
  assert.equal(result.reports[0].rows[0].Conversions_77_AUTO, "--");
  assert.equal(result.reports[0].rows[0].Cost, "0.00");
  assert.doesNotMatch(JSON.stringify(result), /private-test-token|private-metrica-token/);
  assert.deepEqual(result.authority, { provider_writes: false, browser_cabinet: false });
  assert.ok(h.calls.every(c => !/\/(add|update|resume|suspend)$/u.test(c.url)));
  const context = directTemplateResearchContext(result);
  assert.equal(context.query_observations[0].rows.length, 1); assert.equal(context.query_observations[0].omitted_zero_click_zero_cost_rows, 1);
  assert.ok(context.interpretation_rules.some(r => r.includes("PAY_FOR_CONVERSION")));
});
test("missing permissions and report failures remain unavailable, never zero quality results", async () => {
  const h = harness(); const result = await collectDirectTemplateResearch(config, { now: () => "2026-09-09T10:00:00Z", fetch: async (url, init) => url.includes("metrika") || url.endsWith("/reports") ? new Response("Denied", { status: 403 }) : h.fetch(url, init) });
  assert.equal(result.measurement[0].status, "UNAVAILABLE"); assert.equal(result.reports[0].status, "UNAVAILABLE");
  assert.equal(result.reports[0].rows.length, 0); assert.match(result.reports[0].limitation, /403/);
});
test("collection preserves returned objects when a later page fails", async () => {
  const h = harness(); const result = await collectDirectTemplateResearch(config, { now: () => "2026-09-09T10:00:00Z", fetch: async (url, init) => {
    if (url.endsWith("/campaigns")) {
      const offset = JSON.parse(init.body).params.Page.Offset;
      if (offset > 0) return new Response("unavailable", { status: 503 });
      return Response.json({ result: { Campaigns: [{ Id: 9, State: "ARCHIVED" }], LimitedBy: 1 } });
    }
    return h.fetch(url, init);
  } });
  assert.equal(result.collections.campaigns.status, "PARTIAL"); assert.equal(result.collections.campaigns.objects.length, 1);
});
