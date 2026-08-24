import assert from "node:assert/strict";
import test from "node:test";

import { YandexAccessReadinessAdapter } from "../lib/yandex-access-readiness.ts";

function client(login = "client-4242") {
  return {
    Login: login,
    ClientInfo: "Промышленная выставка",
    ClientId: "4242",
    Archived: "NO",
    Currency: "RUB",
    Grants: [{ Privilege: "EDIT_CAMPAIGNS", Value: "YES" }],
    AvailableCampaignTypes: ["UNIFIED_CAMPAIGN"],
    Restrictions: [],
  };
}

function fetcher(requests, { wrongCounter = false, directProUnavailable = false, campaignMissing = false } = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "https://api.direct.yandex.com/json/v501/clients") {
      if (directProUnavailable) {
        return Response.json({ error: { error_code: 3228, error_string: "Нет доступа к методу", error_detail: "API доступен только в режиме Директ Про" } });
      }
      const body = JSON.parse(String(init.body));
      return Response.json({ result: { Clients: [client(body.params.FieldNames.includes("ClientId") ? "client-4242" : "client-4242")] } });
    }
    if (url === "https://api.direct.yandex.com/json/v501/campaigns") {
      return Response.json({ result: { Campaigns: campaignMissing ? [] : [{ Id: "818181", Type: "UNIFIED_CAMPAIGN", Status: "ACCEPTED", State: "OFF" }] } });
    }
    if (url === "https://api-metrika.yandex.net/management/v1/counters") {
      return Response.json({ counters: [{ id: 1717, name: "Основной сайт", site: "owner.example" }] });
    }
    if (url.endsWith("/management/v1/counter/1717")) {
      return Response.json({ counter: { id: wrongCounter ? 9999 : 1717, time_zone_name: "Europe/Moscow" } });
    }
    if (url.endsWith("/management/v1/counter/1717/goals")) {
      return Response.json({ goals: [{ id: 77 }] });
    }
    if (url === "https://api.wordstat.yandex.net/v1/getRegionsTree") {
      return Response.json({ regions: [{ id: 213, name: "Москва", children: [] }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
}

function adapter(requests, options) {
  return new YandexAccessReadinessAdapter({
    directToken: "server-direct-secret",
    directExpectedAccount: "client-4242",
    directCampaignId: "818181",
    directBusinessLabel: "Основной бизнес",
    metrikaToken: "server-metrika-secret",
    metrikaGoalId: "77",
    wordstatToken: "server-wordstat-secret",
    wordstatClientId: "server-wordstat-client",
    wordstatRegionIds: [213],
    wordstatRegionNames: ["Москва"],
    wordstatDevice: "desktop",
  }, fetcher(requests, options), () => "2026-08-24T10:00:00.000Z");
}

test("discovers understandable account/counter choices only through official APIs", async () => {
  const requests = [];
  const discovery = await adapter(requests).discover();
  assert.deepEqual(discovery.scopes, {
    direct: { granted: true },
    metrika: { granted: true },
    wordstat: { granted: true },
  });
  assert.equal(discovery.accounts[0].label, "Промышленная выставка");
  assert.equal(discovery.counters[0].label, "Основной сайт");
  assert.ok(requests.every((request) => /^https:\/\/(?:api\.direct\.yandex\.com|api-metrika\.yandex\.net|api\.wordstat\.yandex\.net)\//u.test(request.url)));
  assert.ok(requests.every((request) => !/direct\.yandex\.(?:ru|com)\/loggedin|metrika\.yandex\.(?:ru|com)/iu.test(request.url)));
  const wordstatRequest = requests.find((request) => request.url.includes("api.wordstat.yandex.net"));
  assert.equal(wordstatRequest.init.method, "POST");
  assert.equal(wordstatRequest.init.redirect, "error");
  assert.deepEqual(JSON.parse(String(wordstatRequest.init.body)), {});
  assert.equal(wordstatRequest.init.headers.Authorization, "Bearer server-wordstat-secret");
  assert.ok(!Object.keys(wordstatRequest.init.headers).some((key) => /client.?id/iu.test(key)));
  assert.doesNotMatch(JSON.stringify(discovery), /server-(?:direct|metrika|wordstat)-secret|server-wordstat-client/u);
});

test("falls back to exact configured Campaigns.get read proof when Clients.get requires Direct Pro", async () => {
  const requests = [];
  const fallback = adapter(requests, { directProUnavailable: true });
  const discovery = await fallback.discover();
  assert.equal(discovery.scopes.direct.granted, true);
  assert.deepEqual(discovery.accounts, [{
    provider_identity: "client-4242",
    label: "Основной бизнес",
    detail: "Доступная реклама этого бизнеса",
  }]);
  const verified = await fallback.verifyBinding({ accountIdentity: "client-4242", counterIdentity: "1717" });
  assert.equal(verified.direct.scope_granted, true);
  assert.equal(verified.direct.matched, true);
  const campaignRequests = requests.filter((request) => request.url.endsWith("/campaigns"));
  assert.equal(campaignRequests.length, 2);
  for (const request of campaignRequests) {
    assert.equal(request.init.headers["Client-Login"], "client-4242");
    assert.deepEqual(JSON.parse(String(request.init.body)), {
      method: "get",
      params: {
        SelectionCriteria: { Ids: ["818181"] },
        FieldNames: ["Id", "Type", "Status", "State"],
      },
    });
  }
  assert.doesNotMatch(JSON.stringify(discovery), /server-direct-secret/u);

  const missing = await adapter([], { directProUnavailable: true, campaignMissing: true }).discover();
  assert.equal(missing.scopes.direct.granted, false);
  assert.deepEqual(missing.accounts, []);
});

test("validates configured Wordstat region and device scope before evidence collection", async () => {
  const unsupportedRegionRequests = [];
  const unsupportedRegion = new YandexAccessReadinessAdapter({
    directToken: "server-direct-secret",
    directExpectedAccount: "client-4242",
    directCampaignId: "818181",
    metrikaToken: "server-metrika-secret",
    metrikaGoalId: "77",
    wordstatToken: "server-wordstat-secret",
    wordstatClientId: "server-wordstat-client",
    wordstatRegionIds: [2],
    wordstatRegionNames: ["Санкт-Петербург"],
    wordstatDevice: "desktop",
  }, fetcher(unsupportedRegionRequests));
  const unsupportedDiscovery = await unsupportedRegion.discover();
  assert.equal(unsupportedDiscovery.scopes.wordstat.granted, false);
  assert.equal(unsupportedRegionRequests.filter((request) => request.url.includes("api.wordstat.yandex.net")).length, 1);

  const invalidDeviceRequests = [];
  const invalidDevice = new YandexAccessReadinessAdapter({
    directToken: "server-direct-secret",
    directExpectedAccount: "client-4242",
    directCampaignId: "818181",
    metrikaToken: "server-metrika-secret",
    metrikaGoalId: "77",
    wordstatToken: "server-wordstat-secret",
    wordstatClientId: "server-wordstat-client",
    wordstatRegionIds: [213],
    wordstatRegionNames: ["Москва"],
    wordstatDevice: "smart-tv",
  }, fetcher(invalidDeviceRequests));
  const invalidDiscovery = await invalidDevice.discover();
  assert.equal(invalidDiscovery.scopes.wordstat.granted, false);
  assert.equal(invalidDeviceRequests.some((request) => request.url.includes("api.wordstat.yandex.net")), false);
});

test("exact binding and scope are rechecked by official APIs and wrong counter fails closed", async () => {
  const requests = [];
  const valid = await adapter(requests).verifyBinding({ accountIdentity: "client-4242", counterIdentity: "1717" });
  assert.deepEqual(valid, {
    direct: { matched: true, scope_granted: true },
    metrika: { matched: true, scope_granted: true },
    wordstat: { scope_granted: true },
  });

  const wrong = await adapter([], { wrongCounter: true }).verifyBinding({ accountIdentity: "client-4242", counterIdentity: "1717" });
  assert.equal(wrong.metrika.scope_granted, false);
  assert.equal(wrong.metrika.matched, false);
});
