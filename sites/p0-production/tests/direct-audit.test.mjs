import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectAuditReportDefinitions,
  DirectAccountAuditor as RuntimeDirectAccountAuditor,
  DirectAuditProviderError,
  sanitizeDirectAuditContract,
  sanitizeDirectAuditSummary,
} from "../lib/direct-audit.ts";
import { YandexDirectReadApi } from "../lib/yandex-direct-audit.ts";

class MemoryDirectAuditStore {
  constructor() {
    this.current = new Map();
    this.artifacts = new Map();
    this.snapshots = new Map();
  }

  key(ownerKey, account) {
    return `${ownerKey}\u0000${account}`;
  }

  async loadCurrent(ownerKey, account) {
    const value = this.current.get(this.key(ownerKey, account));
    return value ? structuredClone(value) : null;
  }

  async start(state, expectedAuditId) {
    const key = this.key(state.owner_key, state.account);
    const current = this.current.get(key);
    if ((current?.audit_id ?? null) !== expectedAuditId) return false;
    this.current.set(key, structuredClone(state));
    return true;
  }

  async compareAndSwap(auditId, expectedVersion, state) {
    const key = this.key(state.owner_key, state.account);
    const current = this.current.get(key);
    if (!current || current.audit_id !== auditId || current.version !== expectedVersion) return false;
    this.current.set(key, structuredClone(state));
    return true;
  }

  async putArtifact(artifact) {
    const current = this.artifacts.get(artifact.reference.artifact_id);
    if (current && current.reference.digest !== artifact.reference.digest) {
      throw new Error("artifact digest drift");
    }
    this.artifacts.set(artifact.reference.artifact_id, structuredClone(artifact));
    return structuredClone(artifact.reference);
  }

  async getArtifact(artifactId) {
    const artifact = this.artifacts.get(artifactId);
    return artifact ? structuredClone(artifact.value) : null;
  }

  async putSnapshot(snapshot) {
    const current = this.snapshots.get(snapshot.snapshot_id);
    if (current && JSON.stringify(current) !== JSON.stringify(snapshot)) {
      throw new Error("snapshot identity drift");
    }
    this.snapshots.set(snapshot.snapshot_id, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async getSnapshot(snapshotId) {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot ? structuredClone(snapshot) : null;
  }
}

const NOW = "2026-08-22T17:40:00.000Z";
const CAPABILITY_FINGERPRINT = `sha256:${"a".repeat(64)}`;

function capability(snapshotId = "direct-capability:fixture", fingerprint = CAPABILITY_FINGERPRINT) {
  return { snapshot_id: snapshotId, fingerprint };
}

class DirectAccountAuditor extends RuntimeDirectAccountAuditor {
  constructor(input) {
    super({
      ...input,
      binding: { capability: capability(), ...input.binding },
    });
  }
}

const LONG_CAMPAIGN_ID = "9007199254740993123";
const SECOND_LONG_CAMPAIGN_ID = "9007199254740993124";

function graphProvider() {
  const calls = [];
  return {
    calls,
    async getPage(input) {
      calls.push(structuredClone(input));
      const offset = Number(input.params.Page?.Offset ?? 0);
      const campaignIds = input.params.SelectionCriteria?.CampaignIds ?? [];
      if (input.collection === "campaigns") {
        if (offset === 0) {
          return {
            objects: [{ Id: LONG_CAMPAIGN_ID, Name: "Основная", Type: "UNIFIED_CAMPAIGN", State: "ON", Status: "ACCEPTED" }],
            limited_by: 1,
            warnings: [],
            request_id: "campaign-page-1",
            units: "1/999/1000",
          };
        }
        assert.equal(offset, 1);
        return {
          objects: [{ Id: SECOND_LONG_CAMPAIGN_ID, Name: "Архив", Type: "TEXT_CAMPAIGN", State: "ARCHIVED", Status: "ACCEPTED" }],
          limited_by: null,
          warnings: [{ code: "FIELD_NORMALIZED", message: "Provider normalized one optional field." }],
          request_id: "campaign-page-2",
          units: "1/998/1000",
        };
      }
      assert.ok(campaignIds.every((value) => typeof value === "string"), "64-bit IDs remain exact strings inside the audit boundary");
      if (input.collection === "adgroups") {
        return {
          objects: campaignIds.map((CampaignId, index) => ({
            Id: `910000000000000000${index}`,
            CampaignId,
            Name: `Группа ${index + 1}`,
            Type: "UNIFIED_AD_GROUP",
            RegionIds: [225],
            NegativeKeywords: { Items: ["бесплатно"] },
            Status: "ACCEPTED",
            ServingStatus: "ELIGIBLE",
          })),
          limited_by: null,
          warnings: [],
        };
      }
      if (input.collection === "audiencetargets") {
        return {
          objects: campaignIds.map((CampaignId, index) => ({ Id: `915000000000000000${index}`, CampaignId, AdGroupId: `910000000000000000${index}`, RetargetingListId: `916000000000000000${index}`, State: "ON" })),
          limited_by: null,
          warnings: [],
        };
      }
      if (input.collection === "keywords") {
        return {
          objects: campaignIds.flatMap((CampaignId, index) => ([
            { Id: `920000000000000000${index}`, CampaignId, AdGroupId: `910000000000000000${index}`, Keyword: "промышленная выставка", State: "ON", Status: "ACCEPTED" },
            { Id: `930000000000000000${index}`, CampaignId, AdGroupId: `910000000000000000${index}`, Keyword: "---autotargeting", State: "ON", Status: "ACCEPTED", AutotargetingSettings: { Categories: { Exact: "YES" } } },
          ])),
          limited_by: null,
          warnings: [],
        };
      }
      if (input.collection === "ads") {
        return {
          objects: campaignIds.map((CampaignId, index) => ({
            Id: `940000000000000000${index}`,
            CampaignId,
            AdGroupId: `910000000000000000${index}`,
            Type: "RESPONSIVE_AD",
            State: "ON",
            Status: "ACCEPTED",
            ResponsiveAd: {
              SitelinkSetId: `950000000000000000${index}`,
              AdImages: { Items: [{ ImageHash: `image-hash-${index}`, Status: "ACCEPTED" }] },
            },
          })),
          limited_by: null,
          warnings: [],
        };
      }
      if (input.collection === "sitelinks") {
        const ids = input.params.SelectionCriteria?.Ids ?? [];
        return { objects: ids.map((Id) => ({ Id, Sitelinks: [{ Title: "Участникам", Href: "https://example.com/join" }] })), limited_by: null, warnings: [] };
      }
      if (input.collection === "adimages") {
        const hashes = input.params.SelectionCriteria?.AdImageHashes ?? [];
        return { objects: hashes.map((AdImageHash) => ({ AdImageHash, Type: "WIDE", Status: "ACCEPTED" })), limited_by: null, warnings: [] };
      }
      throw new Error(`Unexpected collection ${input.collection}`);
    },
    async requestReport() {
      throw new Error("This graph-only slice has no reports");
    },
  };
}

test("Direct audit follows LimitedBy through the complete relevant graph and keeps raw provider pages in artifacts", async () => {
  const store = new MemoryDirectAuditStore();
  const provider = graphProvider();
  const auditor = new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: "advertiser-login",
      api_account: "advertiser-login",
      client_id: "client-4242",
      matched: true,
      restrictions: [{ element: "CAMPAIGNS_TOTAL_PER_CLIENT", value: 3000 }],
      observed_at: NOW,
    },
    provider,
    store,
    now: () => NOW,
    auditId: () => "direct-audit-graph",
    reportDefinitions: [],
  });

  const summary = await auditor.run();

  assert.equal(summary.status, "COMPLETE");
  assert.equal(summary.graph_complete, true);
  assert.deepEqual(summary.account_binding, {
    expected_account: "advertiser-login",
    api_account: "advertiser-login",
    client_id: "client-4242",
    matched: true,
  });
  assert.equal(summary.object_counts.campaigns, 2);
  assert.equal(summary.object_counts.adgroups, 2);
  assert.equal(summary.object_counts.keywords, 4);
  assert.equal(summary.object_counts.audiencetargets, 2);
  assert.equal(summary.object_counts.autotargetings, 2);
  assert.equal(summary.object_counts.ads, 2);
  assert.equal(summary.object_counts.sitelinks, 2);
  assert.equal(summary.object_counts.adimages, 2);
  assert.equal(summary.campaign_summaries[0].campaign_id, LONG_CAMPAIGN_ID);
  assert.deepEqual(summary.methods_not_read, []);
  assert.equal(summary.browser_cabinet_used, false);
  assert.equal(summary.provider_write_methods_reachable, false);
  assert.ok(summary.artifact_references.length > 0);
  assert.ok(summary.artifact_references.every((reference) => !Object.hasOwn(reference, "value")));
  assert.ok(!JSON.stringify(summary).includes("промышленная выставка"), "bulky keyword/provider rows stay outside the bounded summary");

  const campaignCalls = provider.calls.filter((call) => call.collection === "campaigns");
  assert.deepEqual(campaignCalls.map((call) => call.params.Page.Offset), [0, 1]);
  assert.ok(provider.calls.every((call) => call.semantic_method === "get"));
  assert.ok(provider.calls.every((call) => !Object.hasOwn(call.params, "method")), "the auditor never accepts a provider method from model input");

  const campaignPage = [...store.artifacts.values()].find((artifact) => artifact.reference.kind === "DIRECT_CAMPAIGNS_PAGE");
  assert.equal(campaignPage.value.objects[0].Id, LONG_CAMPAIGN_ID);
  assert.ok(summary.limitations.some((item) => item.includes("FIELD_NORMALIZED")));
  assert.deepEqual(sanitizeDirectAuditSummary(summary), summary);
  assert.throws(
    () => sanitizeDirectAuditSummary({ ...summary, provider_write_methods_reachable: true }),
    /read-only safety contract/u,
  );
});

test("Direct audit contract distinguishes complete, partial, unsupported and unavailable provider observations", async () => {
  const store = new MemoryDirectAuditStore();
  const contract = await new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: "advertiser-login",
      api_account: "advertiser-login",
      client_id: "client-4242",
      matched: true,
      restrictions: [],
      observed_at: NOW,
    },
    provider: graphProvider(),
    store,
    now: () => NOW,
    auditId: () => "direct-audit-contract",
    reportDefinitions: [],
  }).runContract();

  assert.equal(contract.schema_version, "direct-full-audit-contract-v1");
  assert.equal(contract.status, "PARTIAL");
  assert.equal(contract.account, "advertiser-login");
  assert.deepEqual(contract.blocking_reasons, []);
  assert.deepEqual(contract.observations.map((observation) => observation.data_set), [
    "campaigns", "adgroups", "audiencetargets", "keywords", "ads", "sitelinks", "adimages", "vcards", "creatives", "adextensions",
    "campaign_results", "search_queries",
  ]);

  const observations = Object.fromEntries(contract.observations.map((observation) => [observation.data_set, observation]));
  assert.equal(observations.campaigns.availability, "PARTIAL", "provider warnings keep otherwise complete data explicitly partial");
  assert.equal(observations.campaigns.data.object_count, 2);
  assert.equal(observations.adgroups.availability, "COMPLETE");
  assert.equal(observations.adgroups.data.object_count, 2);
  assert.equal(observations.vcards.availability, "UNSUPPORTED");
  assert.equal(observations.vcards.data, null);
  assert.equal(observations.vcards.source.channel, "OFFICIAL_API_CONTRACT");
  assert.equal(observations.campaign_results.availability, "UNAVAILABLE");
  assert.equal(observations.campaign_results.data, null);
  assert.equal(observations.search_queries.availability, "UNAVAILABLE");
  assert.equal(observations.search_queries.data, null);
  assert.ok(contract.observations.every((observation) => observation.account === "advertiser-login"));
  assert.ok(contract.observations.every((observation) => observation.source.provider === "YANDEX_DIRECT"));
  assert.ok(contract.observations.every((observation) => Number.isFinite(Date.parse(observation.observed_at))));
  assert.ok(contract.observations.every((observation) => ["FRESH", "UNKNOWN"].includes(observation.freshness.status)));
  assert.deepEqual(sanitizeDirectAuditContract(contract), contract);
  assert.throws(
    () => sanitizeDirectAuditContract({
      ...contract,
      observations: contract.observations.map((observation) => observation.data_set === "adgroups"
        ? { ...observation, data: null }
        : observation),
    }),
    /provider-observation contract/u,
  );
});

test("concurrent safe readers converge on one durable audit instead of losing checkpoint progress", async () => {
  const store = new MemoryDirectAuditStore();
  let waiting = [];
  let campaignReads = 0;
  const provider = {
    async getPage(input) {
      if (input.collection === "campaigns") {
        campaignReads += 1;
        if (campaignReads <= 2) {
          await new Promise((resolve) => {
            waiting.push(resolve);
            if (waiting.length === 2) {
              const current = waiting;
              waiting = [];
              current.forEach((release) => release());
            }
          });
        }
      }
      return { objects: [], limited_by: null, warnings: [] };
    },
    async requestReport() {
      throw new Error("No reports configured");
    },
  };
  const makeAuditor = (id) => new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: "advertiser-login",
      api_account: "advertiser-login",
      client_id: "client-4242",
      matched: true,
      restrictions: [],
      observed_at: NOW,
    },
    provider,
    store,
    now: () => NOW,
    auditId: () => id,
    reportDefinitions: [],
  });

  const [left, right] = await Promise.all([
    makeAuditor("direct-audit-concurrent-left").run(),
    makeAuditor("direct-audit-concurrent-right").run(),
  ]);
  assert.equal(left.status, "COMPLETE");
  assert.equal(right.status, "COMPLETE");
  assert.equal(left.audit_id, right.audit_id);
  assert.equal((await store.loadCurrent("owner", "advertiser-login")).status, "COMPLETE");
});

test("completed Direct audit reuses its exact snapshot until material capability lineage changes", async () => {
  const store = new MemoryDirectAuditStore();
  let currentTime = "2026-08-22T17:40:00.000Z";
  let nextAudit = 1;
  let campaignReads = 0;
  let capabilityLineage = capability("direct-capability:observation-1");
  const provider = {
    async getPage(input) {
      if (input.collection === "campaigns") campaignReads += 1;
      return { objects: [], limited_by: null, warnings: [] };
    },
    async requestReport() {
      throw new Error("No reports configured");
    },
  };
  const makeAuditor = () => new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: "advertiser-login",
      api_account: "advertiser-login",
      client_id: "client-4242",
      matched: true,
      restrictions: [],
      capability: capabilityLineage,
      observed_at: currentTime,
    },
    provider,
    store,
    now: () => currentTime,
    auditId: () => `direct-audit-fresh-${nextAudit++}`,
    reportDefinitions: [],
    maxAgeMs: 5 * 60_000,
  });

  const first = await makeAuditor().run();
  assert.equal(first.audit_id, "direct-audit-fresh-1");
  assert.equal(first.snapshot.snapshot_id, "direct-audit-snapshot:direct-audit-fresh-1");
  assert.equal(campaignReads, 1);
  assert.equal(store.snapshots.size, 1);

  currentTime = "2026-08-22T18:40:00.000Z";
  capabilityLineage = capability("direct-capability:observation-2");
  const reused = await makeAuditor().run();
  assert.equal(reused.audit_id, "direct-audit-fresh-1");
  assert.equal(reused.snapshot.capability_snapshot_id, "direct-capability:observation-1");
  assert.equal(campaignReads, 1, "fresh provider observations cannot silently replace the immutable audit snapshot");
  assert.equal(store.snapshots.size, 1);

  capabilityLineage = capability("direct-capability:material-change", `sha256:${"b".repeat(64)}`);
  const refreshed = await makeAuditor().run();
  assert.equal(refreshed.audit_id, "direct-audit-fresh-2");
  assert.equal(refreshed.snapshot.capability_snapshot_id, "direct-capability:material-change");
  assert.equal(campaignReads, 2);
  assert.equal(store.snapshots.size, 2, "both exact lineage snapshots remain immutable and addressable");
});

test("Direct audit builds exact bounded campaign and offline search-query report requests", () => {
  const definitions = buildDirectAuditReportDefinitions({
    auditId: "direct-audit:owner:2026-08-22",
    dateFrom: "2026-05-22",
    dateTo: "2026-08-19",
  });
  assert.deepEqual(definitions.map((definition) => [definition.report_type, definition.processing_mode]), [
    ["CAMPAIGN_PERFORMANCE_REPORT", "auto"],
    ["SEARCH_QUERY_PERFORMANCE_REPORT", "offline"],
  ]);
  assert.deepEqual(definitions[0].request.params.SelectionCriteria, { DateFrom: "2026-05-22", DateTo: "2026-08-19" });
  assert.equal(definitions[0].request.params.DateRangeType, "CUSTOM_DATE");
  assert.equal(definitions[0].request.params.Format, "TSV");
  assert.equal(definitions[0].request.params.IncludeVAT, "YES");
  assert.ok(definitions[0].request.params.FieldNames.includes("CampaignId"));
  assert.ok(definitions[1].request.params.FieldNames.includes("Query"));
  assert.ok(definitions[1].request.params.FieldNames.includes("MatchedKeyword"));
  assert.notEqual(definitions[0].request.params.ReportName, definitions[1].request.params.ReportName);
});

test("Direct audit persists exact queued report requests and resumes only after provider retryIn", async () => {
  const store = new MemoryDirectAuditStore();
  let currentTime = "2026-08-22T17:40:00.000Z";
  const reportCalls = [];
  const responses = {
    campaign: [
      { http_status: 201, retry_in_ms: 30_000, body: null, warnings: [], request_id: "report-campaign-1" },
      { http_status: 202, retry_in_ms: 20_000, body: null, warnings: [], request_id: "report-campaign-2" },
      { http_status: 200, retry_in_ms: null, body: "CampaignId\tImpressions\tClicks\n9007199254740993123\t100\t7\n", warnings: [], request_id: "report-campaign-3" },
    ],
    search: [
      { http_status: 201, retry_in_ms: 15_000, body: null, warnings: [], request_id: "report-search-1" },
      { http_status: 200, retry_in_ms: null, body: "AdGroupId\tQuery\tClicks\n9100000000000000000\tuser@example.com +7 999 123-45-67\t3\n", warnings: [], request_id: "report-search-2" },
    ],
  };
  const provider = {
    async getPage(input) {
      if (input.collection !== "campaigns") throw new Error(`Unexpected graph collection ${input.collection}`);
      return { objects: [], limited_by: null, warnings: [] };
    },
    async requestReport(definition) {
      reportCalls.push(structuredClone(definition));
      const response = responses[definition.report_key].shift();
      if (!response) throw new Error(`Unexpected report retry ${definition.report_key}`);
      return response;
    },
  };
  const reportDefinitions = [
    {
      report_key: "campaign",
      report_type: "CAMPAIGN_PERFORMANCE_REPORT",
      processing_mode: "auto",
      request: {
        params: {
          SelectionCriteria: { DateFrom: "2026-05-22", DateTo: "2026-08-19" },
          FieldNames: ["CampaignId", "Impressions", "Clicks", "Cost"],
          ReportName: "direct-audit-graph-campaign",
          ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
          DateRangeType: "CUSTOM_DATE",
          Format: "TSV",
          IncludeVAT: "YES",
          IncludeDiscount: "NO",
        },
      },
    },
    {
      report_key: "search",
      report_type: "SEARCH_QUERY_PERFORMANCE_REPORT",
      processing_mode: "offline",
      request: {
        params: {
          SelectionCriteria: { DateFrom: "2026-05-22", DateTo: "2026-08-19" },
          FieldNames: ["AdGroupId", "Query", "MatchedKeyword", "Clicks", "Cost"],
          ReportName: "direct-audit-graph-search",
          ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
          DateRangeType: "CUSTOM_DATE",
          Format: "TSV",
          IncludeVAT: "YES",
          IncludeDiscount: "NO",
        },
      },
    },
  ];
  const makeAuditor = () => new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: "advertiser-login",
      api_account: "advertiser-login",
      client_id: "client-4242",
      matched: true,
      restrictions: [],
      observed_at: NOW,
    },
    provider,
    store,
    now: () => currentTime,
    auditId: () => "direct-audit-reports",
    reportDefinitions,
  });

  const first = await makeAuditor().run();
  assert.equal(first.status, "PENDING");
  assert.equal(first.next_retry_at, "2026-08-22T17:40:30.000Z");
  assert.equal(reportCalls.length, 1);
  const queued = await store.loadCurrent("owner", "advertiser-login");
  assert.deepEqual(queued.reports[0].request, reportDefinitions[0].request);
  assert.equal(queued.reports[0].attempts, 1);
  assert.equal(queued.reports[0].status, "QUEUED");

  await makeAuditor().run();
  assert.equal(reportCalls.length, 1, "restart before retryIn performs no provider request");

  currentTime = "2026-08-22T17:40:30.000Z";
  const second = await makeAuditor().run();
  assert.equal(second.status, "PENDING");
  assert.equal(second.next_retry_at, "2026-08-22T17:40:50.000Z");
  assert.equal(reportCalls.length, 2);

  currentTime = "2026-08-22T17:40:50.000Z";
  const third = await makeAuditor().run();
  assert.equal(third.status, "PENDING");
  assert.equal(third.next_retry_at, "2026-08-22T17:41:05.000Z");
  assert.equal(reportCalls.length, 4, "completed campaign report continues to the required offline search report");

  currentTime = "2026-08-22T17:41:05.000Z";
  const completed = await makeAuditor().run();
  assert.equal(completed.status, "COMPLETE");
  assert.deepEqual(completed.report_summaries.map((report) => [report.report_type, report.status]), [
    ["CAMPAIGN_PERFORMANCE_REPORT", "COMPLETE"],
    ["SEARCH_QUERY_PERFORMANCE_REPORT", "COMPLETE"],
  ]);
  assert.ok(completed.artifact_references.some((reference) => reference.kind === "DIRECT_REPORT_TSV"));
  const persisted = await store.loadCurrent("owner", "advertiser-login");
  assert.equal(persisted.status, "COMPLETE");
  assert.equal(persisted.reports[1].attempts, 2);
  const searchArtifact = [...store.artifacts.values()].find((artifact) => artifact.reference.artifact_id === persisted.reports[1].artifact_reference.artifact_id);
  assert.ok(!searchArtifact.value.tsv.includes("user@example.com"));
  assert.ok(!searchArtifact.value.tsv.includes("+7 999 123-45-67"));
  assert.ok(searchArtifact.value.tsv.includes("[REDACTED_EMAIL]"));
  assert.equal(reportCalls[0].processing_mode, "auto");
  assert.equal(reportCalls[2].processing_mode, "auto");
  assert.equal(reportCalls[3].processing_mode, "offline");
  assert.deepEqual(reportCalls[0].request, reportCalls[1].request, "201/202 retries preserve the exact request body");
});

test("Direct audit durably retries rate limits and preserves partial-permission limitations", async () => {
  const store = new MemoryDirectAuditStore();
  let currentTime = "2026-08-22T18:00:00.000Z";
  let campaignAttempts = 0;
  let providerCalls = 0;
  const provider = {
    async getPage(input) {
      providerCalls += 1;
      if (input.collection === "campaigns") {
        campaignAttempts += 1;
        if (campaignAttempts === 1) {
          throw new DirectAuditProviderError({
            code: "DIRECT_RATE_LIMITED",
            message: "Direct read quota is temporarily exhausted.",
            disposition: "RETRYABLE",
            retry_at: "2026-08-22T18:00:10.000Z",
          });
        }
        return {
          objects: [{ Id: LONG_CAMPAIGN_ID, Name: "Основная", Type: "UNIFIED_CAMPAIGN", State: "ON", Status: "ACCEPTED" }],
          limited_by: null,
          warnings: [{ code: "DIRECT_UNITS_LOW", message: "Only 5 API points remain." }],
        };
      }
      if (input.collection === "adgroups") {
        throw new DirectAuditProviderError({
          code: "DIRECT_PARTIAL_PERMISSION",
          message: "Representative can read campaigns but not ad groups.",
          disposition: "UNAVAILABLE",
          retry_at: null,
        });
      }
      if (["audiencetargets", "keywords", "ads"].includes(input.collection)) return { objects: [], limited_by: null, warnings: [] };
      throw new Error(`Unexpected collection ${input.collection}`);
    },
    async requestReport() {
      throw new Error("No reports configured");
    },
  };
  const makeAuditor = () => new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: "advertiser-login",
      api_account: "advertiser-login",
      client_id: "client-4242",
      matched: true,
      restrictions: [{ element: "API_POINTS", value: 5 }],
      observed_at: NOW,
    },
    provider,
    store,
    now: () => currentTime,
    auditId: () => "direct-audit-limited",
    reportDefinitions: [],
  });

  const limited = await makeAuditor().run();
  assert.equal(limited.status, "PENDING");
  assert.equal(limited.next_retry_at, "2026-08-22T18:00:10.000Z");
  assert.equal(providerCalls, 1);

  const blocked = await makeAuditor().runContract();
  assert.equal(providerCalls, 1, "contract read before the persisted rate-limit time performs no provider request");
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.blocking_reasons.some((reason) => reason.code === "DIRECT_RATE_LIMITED"));
  const blockedCampaigns = blocked.observations.find((observation) => observation.data_set === "campaigns");
  assert.equal(blockedCampaigns.availability, "UNAVAILABLE");
  assert.equal(blockedCampaigns.data, null, "quota exhaustion never becomes an invented zero observation");
  assert.equal(blockedCampaigns.freshness.status, "UNKNOWN");

  currentTime = "2026-08-22T18:00:10.000Z";
  const partial = await makeAuditor().run();
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.graph_complete, false);
  assert.deepEqual(partial.methods_not_read, ["AdGroups.get"]);
  assert.equal(partial.object_counts.campaigns, 1);
  assert.equal(partial.object_counts.adgroups, 0);
  assert.deepEqual(partial.provider_restrictions, [{ element: "API_POINTS", value: 5 }]);
  assert.ok(partial.limitations.some((item) => item.includes("DIRECT_PARTIAL_PERMISSION")));
  assert.ok(partial.limitations.some((item) => item.includes("DIRECT_UNITS_LOW")));

  const partialContract = await makeAuditor().runContract();
  const partialObservations = Object.fromEntries(partialContract.observations.map((observation) => [observation.data_set, observation]));
  assert.equal(partialContract.status, "PARTIAL");
  assert.equal(partialObservations.campaigns.availability, "PARTIAL");
  assert.equal(partialObservations.campaigns.data.object_count, 1);
  assert.equal(partialObservations.adgroups.availability, "UNAVAILABLE");
  assert.equal(partialObservations.adgroups.data, null, "missing permission never becomes a zero group observation");
});

test("Direct audit blocks an account mismatch and provider network failure without fabricated observations", async () => {
  let fetchCalls = 0;
  const api = new YandexDirectReadApi({
    token: "server-only-token",
    account: "advertiser-login",
    fetcher: async () => {
      fetchCalls += 1;
      throw new Error("network down");
    },
    now: () => "2026-08-22T19:00:00.000Z",
  });
  const binding = {
    expected_account: "advertiser-login",
    api_account: "advertiser-login",
    client_id: "client-4242",
    matched: true,
    restrictions: [],
    observed_at: "2026-08-22T19:00:00.000Z",
  };

  assert.throws(
    () => new DirectAccountAuditor({
      ownerKey: "owner",
      binding: { ...binding, expected_account: "other-login", api_account: "other-login" },
      provider: api,
      store: new MemoryDirectAuditStore(),
      now: () => "2026-08-22T19:00:00.000Z",
      reportDefinitions: [],
    }),
    (error) => {
      assert.equal(error.code, "DIRECT_ACCOUNT_MISMATCH");
      assert.equal(error.disposition, "UNAVAILABLE");
      return true;
    },
  );
  assert.equal(fetchCalls, 0, "wrong account is blocked before any provider request");

  const blocked = await new DirectAccountAuditor({
    ownerKey: "owner",
    binding,
    provider: api,
    store: new MemoryDirectAuditStore(),
    now: () => "2026-08-22T19:00:00.000Z",
    auditId: () => "direct-audit-network-failure",
    reportDefinitions: [],
  }).runContract();
  assert.equal(fetchCalls, 1);
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.blocking_reasons.some((reason) => reason.code === "DIRECT_TEMPORARY_FAILURE"));
  const campaigns = blocked.observations.find((observation) => observation.data_set === "campaigns");
  assert.equal(campaigns.account, "advertiser-login");
  assert.equal(campaigns.source.channel, "OFFICIAL_API");
  assert.equal(campaigns.availability, "UNAVAILABLE");
  assert.equal(campaigns.data, null);
  assert.equal(campaigns.retry_at, "2026-08-22T19:00:05.000Z");
  assert.ok(!JSON.stringify(blocked).includes('"Impressions":0'));
  assert.ok(!JSON.stringify(blocked).includes('"Conversions":0'));
});

test("Direct audit preserves current provider limitations for legacy dynamic and smart criteria", async () => {
  const store = new MemoryDirectAuditStore();
  const provider = {
    async getPage(input) {
      if (input.collection === "campaigns") {
        return { objects: [{ Id: LONG_CAMPAIGN_ID, Name: "Legacy", Type: "TEXT_CAMPAIGN", State: "ON", Status: "ACCEPTED" }], limited_by: null, warnings: [] };
      }
      if (input.collection === "adgroups") {
        return {
          objects: [
            { Id: "9100000000000000001", CampaignId: LONG_CAMPAIGN_ID, Name: "Dynamic", Type: "DYNAMIC_TEXT_AD_GROUP", Status: "ACCEPTED" },
            { Id: "9100000000000000002", CampaignId: LONG_CAMPAIGN_ID, Name: "Smart", Type: "SMART_AD_GROUP", Status: "ACCEPTED" },
          ],
          limited_by: null,
          warnings: [],
        };
      }
      if (["audiencetargets", "keywords", "ads"].includes(input.collection)) return { objects: [], limited_by: null, warnings: [] };
      throw new Error(`Unexpected collection ${input.collection}`);
    },
    async requestReport() {
      throw new Error("No reports configured");
    },
  };
  const summary = await new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: "advertiser-login",
      api_account: "advertiser-login",
      client_id: "client-4242",
      matched: true,
      restrictions: [],
      observed_at: NOW,
    },
    provider,
    store,
    now: () => NOW,
    auditId: () => "direct-audit-provider-limits",
    reportDefinitions: [],
  }).run();

  assert.equal(summary.status, "PARTIAL");
  assert.equal(summary.graph_complete, false);
  assert.ok(summary.methods_not_read.includes("DynamicTextAdTargets.get"));
  assert.ok(summary.methods_not_read.includes("SmartAdTargets.get"));
  assert.ok(summary.limitations.some((item) => item.includes("current official Direct API index")));
});

test("Yandex Direct read API preserves long IDs and exposes no provider write method", async () => {
  const requests = [];
  const queuedResponses = [
    new Response('{"result":{"Campaigns":[{"Id":9007199254740993123,"Name":"Основная","Warnings":[{"Code":100,"Message":"Optional field normalized"}]}],"LimitedBy":1000}}', {
      status: 200,
      headers: { "Content-Type": "application/json", RequestId: "request-1", Units: "1/999/1000" },
    }),
    new Response("", { status: 201, headers: { retryIn: "30", RequestId: "report-1", Units: "5/994/1000" } }),
    new Response("", { status: 429, headers: { "Retry-After": "5" } }),
    new Response("", { status: 403 }),
  ];
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), init: structuredClone(init) });
    const response = queuedResponses.shift();
    if (!response) throw new Error("Unexpected HTTP request");
    return response;
  };
  let currentTime = "2026-08-22T18:30:00.000Z";
  const api = new YandexDirectReadApi({
    token: "server-only-token",
    account: "advertiser-login",
    fetcher,
    now: () => currentTime,
  });

  const page = await api.getPage({
    collection: "campaigns",
    service: "Campaigns",
    result_key: "Campaigns",
    semantic_method: "get",
    params: { SelectionCriteria: {}, FieldNames: ["Id", "Name"], Page: { Limit: 1000, Offset: 0 } },
  });
  assert.equal(page.objects[0].Id, LONG_CAMPAIGN_ID);
  assert.equal(page.limited_by, 1000);
  assert.deepEqual(page.warnings, [{ code: "100", message: "Optional field normalized" }]);
  assert.equal(requests[0].url, "https://api.direct.yandex.com/json/v501/campaigns");
  assert.equal(JSON.parse(requests[0].init.body).method, "get");
  assert.equal(requests[0].init.headers.Authorization, "Bearer server-only-token");
  assert.equal(requests[0].init.headers["Client-Login"], "advertiser-login");

  const reportDefinition = {
    report_key: "search",
    report_type: "SEARCH_QUERY_PERFORMANCE_REPORT",
    processing_mode: "offline",
    request: { params: { ReportName: "exact-report", ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT" } },
  };
  const queued = await api.requestReport(reportDefinition);
  assert.equal(queued.http_status, 201);
  assert.equal(queued.retry_in_ms, 30_000);
  assert.equal(requests[1].url, "https://api.direct.yandex.com/json/v5/reports");
  assert.equal(requests[1].init.headers.processingMode, "offline");
  assert.deepEqual(JSON.parse(requests[1].init.body), reportDefinition.request);

  await assert.rejects(
    () => api.getPage({
      collection: "campaigns",
      service: "Campaigns",
      result_key: "Campaigns",
      semantic_method: "get",
      params: { SelectionCriteria: {}, FieldNames: ["Id"], Page: { Limit: 1000, Offset: 0 } },
    }),
    (error) => {
      assert.equal(error.code, "DIRECT_RATE_LIMITED");
      assert.equal(error.disposition, "RETRYABLE");
      assert.equal(error.retry_at, "2026-08-22T18:30:05.000Z");
      return true;
    },
  );
  await assert.rejects(
    () => api.getPage({
      collection: "adgroups",
      service: "AdGroups",
      result_key: "AdGroups",
      semantic_method: "get",
      params: { SelectionCriteria: { CampaignIds: [LONG_CAMPAIGN_ID] }, FieldNames: ["Id"], Page: { Limit: 1000, Offset: 0 } },
    }),
    (error) => {
      assert.equal(error.code, "DIRECT_PARTIAL_PERMISSION");
      assert.equal(error.disposition, "UNAVAILABLE");
      return true;
    },
  );
  for (const method of ["add", "update", "delete", "suspend", "resume", "moderate", "call"]) {
    assert.equal(api[method], undefined, `${method} is not reachable through the read-only audit adapter`);
  }
});
