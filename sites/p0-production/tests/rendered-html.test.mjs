import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const ownerSource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the MOX-ADV owner journey shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Путь владельца — MOX-ADV<\/title>/i);
  assert.match(html, /Готовлю путь владельца/u);
  assert.doesNotMatch(html, /Production Module|Test Scenario|schema_version|provider_ids/i);
});

test("production page consumes only the typed owner projection", () => {
  assert.match(clientSource, /OwnerJourneyProjection/u);
  assert.match(clientSource, /projection\.journey\.stages/u);
  assert.match(clientSource, /projection\.businessOutcome/u);
  assert.match(clientSource, /projection\.currentRecommendation/u);
  assert.match(clientSource, /projection\.primaryAction/u);
  assert.doesNotMatch(clientSource, /payload\.state|workflow\.allowed_commands|context_preflight|write_readiness/u);
  assert.doesNotMatch(clientSource, /schema_version|revision_history|provider_ids|publish_fingerprint/u);
});

test("owner interface fixes the accepted five stages and keeps roadmap non-interactive", () => {
  for (const label of ["Цель", "Что узнал агент", "Стратегия", "Кампании", "Проверка и создание"]) {
    assert.match(ownerSource, new RegExp(label, "u"));
  }
  for (const label of ["Управление", "Мониторинг", "SEO", "VK"]) {
    assert.match(ownerSource, new RegExp(label, "u"));
  }
  assert.match(ownerSource, /interactive: false/u);
  assert.doesNotMatch(clientSource, /owner-roadmap[\s\S]*<button/u);
});
