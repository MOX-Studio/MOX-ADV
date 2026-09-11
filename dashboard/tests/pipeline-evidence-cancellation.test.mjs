import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { P0Application } from "../lib/p0-application.ts";
import { verifyAnalyticsEvidenceSnapshot } from "../lib/analytics-evidence.ts";
import { unavailableWordstatBatch } from "../lib/market-evidence.ts";

const NOW = "2026-09-05T10:00:00.000Z";
const SITE_URL = "https://owner.example/";

class MemoryStore {
  row = null;
  loadCalls = 0;
  async load() { this.loadCalls += 1; return this.row ? structuredClone(this.row) : null; }
  async initialize(_key, row) { this.row = structuredClone(row); return true; }
  async compareAndSwap() { throw new Error("Evidence collection must not rewrite the application document."); }
  async history() { return this.row ? [structuredClone(this.row)] : []; }
}

function site() {
  const page = {
    url: SITE_URL, title: "Промышленная выставка", description: "Участие со стендом для производителей",
    headings: ["Стать участником"], forms_detected: 1, text_excerpt: "Производственные компании могут оставить заявку на участие в выставке со стендом.",
  };
  return { ...page, fetched_at: NOW, pages: [page], research: { pages_analyzed: 1, links_discovered: 0, scope: "FIRST_PARTY_PUBLIC_HTTPS" } };
}

async function market() {
  return { wordstat_batch: await unavailableWordstatBatch("Source deliberately unavailable in this isolated fixture.", NOW), demand_clusters: [], cost_observations: [] };
}

function fixture(overrides = {}) {
  const calls = [];
  const store = new MemoryStore();
  const adapters = {
    now: () => NOW,
    async readContext(input) { calls.push({ phase: "context", signal: input.signal }); throw new Error("Owner-confirmed Access Readiness is required before private provider reads."); },
    async researchSite(_url, signal) { calls.push({ phase: "site", signal }); return site(); },
    async readMarketEvidence(input) { calls.push({ phase: "market", signal: input.signal }); return market(); },
    async readCompetitorResearch(input) { calls.push({ phase: "competitors", signal: input.signal }); return null; },
    async readFinancialCompetitorIntelligence(input) { calls.push({ phase: "financial", signal: input.signal }); return null; },
    async readCurrencyLimits() { return { minimum_weekly_budget_rub: null }; },
    externalWriteConfiguration() { return { ready: false, blockers: ["No writes in fixture"], account: "" }; },
    ...overrides,
  };
  return { application: new P0Application({ store, adapters }), calls, store };
}

test("fresh collection forwards one AbortSignal through context, site and every evidence adapter", async () => {
  const controller = new AbortController();
  const { application, calls, store } = fixture();
  const snapshot = await application.collectCurrentAnalyticsEvidence("owner", null, SITE_URL, controller.signal);
  assert.equal(await verifyAnalyticsEvidenceSnapshot(snapshot), true);
  assert.deepEqual(calls.map((call) => call.phase), ["context", "site", "market", "competitors", "financial"]);
  assert.ok(calls.every((call) => call.signal === controller.signal));
  assert.equal(JSON.parse(store.row.value_json).analytics_evidence_snapshot, null);
});

test("an already canceled collection performs no persistence or source work", async () => {
  const controller = new AbortController();
  const reason = new Error("owner canceled before collection");
  controller.abort(reason);
  const { application, calls, store } = fixture();
  await assert.rejects(application.collectCurrentAnalyticsEvidence("owner", null, SITE_URL, controller.signal), (error) => error === reason);
  assert.equal(store.loadCalls, 0);
  assert.equal(store.row, null);
  assert.deepEqual(calls, []);
});

test("context cancellation is not downgraded into unavailable private evidence or followed by site reads", async () => {
  const controller = new AbortController();
  const reason = new Error("owner canceled context");
  const { application, calls } = fixture({
    async readContext({ signal }) { assert.equal(signal, controller.signal); controller.abort(reason); throw reason; },
  });
  await assert.rejects(application.collectCurrentAnalyticsEvidence("owner", null, SITE_URL, controller.signal), (error) => error === reason);
  assert.deepEqual(calls, []);
});

test("a late site result after cancellation cannot launch supplemental source collection", async () => {
  const controller = new AbortController();
  const reason = new Error("owner canceled site");
  const { application, calls } = fixture({
    async researchSite(_url, signal) { assert.equal(signal, controller.signal); controller.abort(reason); return site(); },
  });
  await assert.rejects(application.collectCurrentAnalyticsEvidence("owner", null, SITE_URL, controller.signal), (error) => error === reason);
  assert.deepEqual(calls.map((call) => call.phase), ["context"]);
});

test("market cancellation stops further adapter starts and cannot accept a fresh snapshot", async () => {
  const controller = new AbortController();
  const reason = new Error("owner canceled Wordstat");
  const { application, calls, store } = fixture({
    async readMarketEvidence({ signal }) { assert.equal(signal, controller.signal); controller.abort(reason); throw reason; },
  });
  await assert.rejects(application.collectCurrentAnalyticsEvidence("owner", null, SITE_URL, controller.signal), (error) => error === reason);
  assert.deepEqual(calls.map((call) => call.phase), ["context", "site"]);
  assert.equal(JSON.parse(store.row.value_json).analytics_evidence_snapshot, null);
});

test("an adapter that returns unavailable data after abort still cannot produce a fresh snapshot", async () => {
  const controller = new AbortController();
  const reason = new Error("owner canceled pending market request");
  let started;
  const pendingRead = new Promise((resolve) => { started = resolve; });
  const { application, store } = fixture({
    async readMarketEvidence({ signal }) {
      started();
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return market();
    },
  });
  const pending = application.collectCurrentAnalyticsEvidence("owner", null, SITE_URL, controller.signal);
  await pendingRead;
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(JSON.parse(store.row.value_json).analytics_evidence_snapshot, null);
});

test("production collection passes cancellation to Wordstat and checks abort before an unavailable fallback", async () => {
  const source = await readFile(new URL("../lib/p0.ts", import.meta.url), "utf8");
  const collector = source.slice(source.indexOf("export async function productionPipelineEvidenceCollector"), source.indexOf("async function coordinateOwnerAgent"));
  assert.match(collector, /collectCurrentAnalyticsEvidence\([\s\S]*input\.signal,/u);
  assert.match(collector, /input\.signal\?\.throwIfAborted\(\);\s*return enriched/u);
  const marketRead = source.slice(source.indexOf("async function readMarketEvidence"), source.indexOf("async function readContext"));
  assert.match(marketRead, /collectHeadlessWordstatUiBatch\(researchPlan,[\s\S]*?\}, \{ signal \}\)/u);
  assert.match(marketRead, /catch \(error\) \{\s*signal\?\.throwIfAborted\(\);\s*wordstatBatch = await unavailableWordstatBatch/u);
  assert.match(marketRead, /fetchWithSignal\(signal\)/u);
});
