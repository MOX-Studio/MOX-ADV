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

function fetcher(requests, { wrongCounter = false } = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "https://api.direct.yandex.com/json/v501/clients") {
      const body = JSON.parse(String(init.body));
      return Response.json({ result: { Clients: [client(body.params.FieldNames.includes("ClientId") ? "client-4242" : "client-4242")] } });
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
    if (url === "https://api.wordstat.yandex.net/v1/regions") return Response.json({ regions: [] });
    throw new Error(`Unexpected request: ${url}`);
  };
}

function adapter(requests, options) {
  return new YandexAccessReadinessAdapter({
    directToken: "server-direct-secret",
    directBusinessLabel: "Основной бизнес",
    metrikaToken: "server-metrika-secret",
    metrikaGoalId: "77",
    wordstatToken: "server-wordstat-secret",
    wordstatClientId: "server-wordstat-client",
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
  assert.doesNotMatch(JSON.stringify(discovery), /server-(?:direct|metrika|wordstat)-secret/u);
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
