import { env } from "cloudflare:workers";
import {
  AccessReadinessService,
  type AccessReadinessStore,
  type AccessStoredRow,
} from "./access-readiness.ts";
import { YandexAccessReadinessAdapter } from "./yandex-access-readiness.ts";
import {
  hasDuplicateCampaignName,
} from "./campaign-draft.ts";
import {
  campaignDraftPublishBlockers,
  fingerprintDirectProjection,
} from "./campaign-fanout.ts";
import { directExecutionFailureOutcome } from "./campaign-package-execution.ts";
import { strategyAnswerValue } from "./campaign-strategy.ts";
import { minimumWeeklyBudgetRub, validateWeeklyBudgetRub } from "./direct-limits.ts";
import {
  correctSuspendedCampaignAndResubmitModeration,
  DirectWriteError,
  pollSuspendedCampaignModeration,
  reconcileCorrectedCampaignUpdate,
  type DirectProjection,
} from "./direct-write.ts";
import {
  executeSafeSingleCampaign,
  type DirectExecutionIdentity,
  type DirectExecutionJournal,
  type DirectExecutionRecord,
} from "./execution-safety.ts";
import { readP0CuratedPlaybookV1 } from "./p0-curated-playbook-v1.ts";
import { collectProductionCompetitorResearch } from "./production-competitor-research.ts";
import {
  P0Application,
  type P0ApplicationStore,
  type P0Context,
  type P0Document,
  type P0StoredRow,
} from "./p0-application.ts";
import {
  P0OwnerJourney,
  type OwnerActionSubmission,
} from "./p0-owner-journey.ts";
import {
  P0AgentRuntime,
  projectP0AgentRunForOwner,
  type P0AgentOwnerProjection,
} from "./p0-agent-runtime.ts";
import {
  D1P0AgentRunStore,
  ensureP0AgentTables,
} from "./p0-agent-d1-store.ts";
import {
  buildDirectAuditReportDefinitions,
  DirectAccountAuditor,
  fingerprintDirectAuditCapability,
  type DirectAuditBinding,
  type DirectAuditSummary,
} from "./direct-audit.ts";
import {
  D1DirectAuditStore,
  ensureP0DirectAuditTables,
} from "./p0-direct-audit-d1-store.ts";
import { createP0ModelAdapter } from "./p0-model-provider.ts";
import { resolveHostnameWithDnsJson } from "./public-dns.ts";
import { researchPublicFirstPartySite } from "./site-research.ts";
import { cleanText } from "./text.ts";
import {
  buildDemandCostResearchPlan,
  buildOwnHistoryCostObservation,
  collectCurrentAuctionCostObservation,
  collectOfficialWordstatBatch,
  qualifyDirectComparableCandidates,
  unavailableWordstatBatch,
  type CostObservation,
  type MarketEvidenceInput,
  type WordstatSeed,
} from "./market-evidence.ts";
import {
  verifyDirectAccountBinding,
  verifyMetrikaCounterBinding,
} from "./yandex-context.ts";
import { YandexDirectReadApi } from "./yandex-direct-audit.ts";

type ExecutionRow = {
  execution_id: string;
  user_key: string;
  account_key: string;
  status: string;
  campaign_id: string | null;
  projection_json: string;
  result_json: string;
};

function runtimeEnv() {
  return env as unknown as Record<string, string | undefined> & {
    DB: typeof env.DB;
  };
}

function now() {
  return new Date().toISOString();
}


function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function userKey(request: Request) {
  const authenticated = request.headers.get("oai-authenticated-user-id")?.trim();
  if (authenticated) return authenticated;
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local-preview";
  throw new Error("Для production-модуля требуется вход через GPT Sites.");
}

function directWriteConfig() {
  const runtime = runtimeEnv();
  return {
    token: runtime.YANDEX_DIRECT_OAUTH_TOKEN ?? "",
    account: runtime.YANDEX_DIRECT_CLIENT_LOGIN ?? "",
  };
}

async function readDirectBinding() {
  const config = directWriteConfig();
  return verifyDirectAccountBinding(
    { token: config.token, expectedAccount: config.account },
    fetch,
    now,
  );
}

async function readMetrikaBinding() {
  const runtime = runtimeEnv();
  return verifyMetrikaCounterBinding(
    {
      token: runtime.YANDEX_METRICA_OAUTH_TOKEN ?? "",
      expectedCounterId: runtime.YANDEX_METRICA_COUNTER_ID ?? "",
      expectedGoalId: runtime.YANDEX_METRICA_GOAL_ID ?? "",
    },
    fetch,
    now,
  );
}

async function beginExecution(
  userKeyValue: string,
  account: string,
  projection: DirectProjection,
  executionId = crypto.randomUUID(),
) {
  const timestamp = now();
  await runtimeEnv()
    .DB.prepare(
      "INSERT INTO p0_executions(execution_id, user_key, account_key, status, projection_json, result_json, created_at, updated_at) VALUES (?, ?, ?, 'STARTED', ?, '{}', ?, ?)",
    )
    .bind(executionId, userKeyValue, account, JSON.stringify(projection), timestamp, timestamp)
    .run();
  return executionId;
}

async function findExactExecution(
  userKeyValue: string,
  account: string,
  projection: DirectProjection,
) {
  const rows = await runtimeEnv()
    .DB.prepare(
      "SELECT execution_id, user_key, account_key, status, campaign_id, projection_json, result_json FROM p0_executions WHERE user_key = ? AND account_key = ? ORDER BY created_at DESC LIMIT 20",
    )
    .bind(userKeyValue, account)
    .all<ExecutionRow>();
  const requestedFingerprint = await fingerprintDirectProjection(projection as unknown as Record<string, unknown>);
  for (const row of rows.results) {
    const storedProjection = JSON.parse(row.projection_json) as DirectProjection;
    const storedFingerprint = await fingerprintDirectProjection(storedProjection as unknown as Record<string, unknown>);
    if (storedFingerprint === requestedFingerprint) return row.execution_id;
  }
  return null;
}

function accountLockExpiry() {
  return new Date(Date.now() + 15 * 60_000).toISOString();
}

async function acquireAccountLock(account: string, userKeyValue: string, executionId: string) {
  const db = runtimeEnv().DB;
  const timestamp = now();
  await db.prepare("DELETE FROM p0_account_locks WHERE expires_at <= ?").bind(timestamp).run();
  const expiresAt = accountLockExpiry();
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO p0_account_locks(account_key, execution_id, owner_key, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(account, executionId, userKeyValue, expiresAt)
    .run();
  if (Number(result.meta.changes) !== 1) {
    throw new Error("Для аккаунта уже выполняется другая production-запись.");
  }
}

async function renewAccountLock(account: string, executionId: string) {
  const result = await runtimeEnv()
    .DB.prepare("UPDATE p0_account_locks SET expires_at = ? WHERE account_key = ? AND execution_id = ?")
    .bind(accountLockExpiry(), account, executionId)
    .run();
  if (Number(result.meta.changes) !== 1) throw new Error("Direct account single-writer lease потеряна.");
}

async function releaseAccountLock(account: string, executionId: string) {
  await runtimeEnv()
    .DB.prepare("DELETE FROM p0_account_locks WHERE account_key = ? AND execution_id = ?")
    .bind(account, executionId)
    .run();
}

async function holdAccountLock(account: string, executionId: string) {
  await runtimeEnv()
    .DB.prepare(
      "UPDATE p0_account_locks SET expires_at = '9999-12-31T23:59:59.999Z' WHERE account_key = ? AND execution_id = ?",
    )
    .bind(account, executionId)
    .run();
}

async function claimAccountLock(account: string, userKeyValue: string, executionId: string) {
  const db = runtimeEnv().DB;
  await db.prepare("DELETE FROM p0_account_locks WHERE expires_at <= ?").bind(now()).run();
  const lock = await db
    .prepare("SELECT execution_id FROM p0_account_locks WHERE account_key = ?")
    .bind(account)
    .first<{ execution_id: string }>();
  if (lock?.execution_id === executionId) return;
  if (lock) throw new Error("Для аккаунта уже выполняется другая production-запись.");
  await acquireAccountLock(account, userKeyValue, executionId);
}

class D1DirectExecutionJournal implements DirectExecutionJournal {
  constructor(
    private readonly ownerKey: string,
    private readonly projection: DirectProjection,
  ) {}

  async acquire(identity: DirectExecutionIdentity) {
    const row = await runtimeEnv()
      .DB.prepare(
        "SELECT execution_id, user_key, account_key, status, campaign_id, projection_json, result_json FROM p0_executions WHERE execution_id = ? AND user_key = ? AND account_key = ?",
      )
      .bind(identity.execution_id, this.ownerKey, identity.account)
      .first<ExecutionRow>();
    if (!row) throw new Error("Durable Direct execution record отсутствует.");
    const storedProjection = JSON.parse(row.projection_json) as DirectProjection;
    const [storedFingerprint, requestedFingerprint] = await Promise.all([
      fingerprintDirectProjection(storedProjection as unknown as Record<string, unknown>),
      fingerprintDirectProjection(this.projection as unknown as Record<string, unknown>),
    ]);
    if (storedFingerprint !== identity.publish_fingerprint || requestedFingerprint !== identity.publish_fingerprint) {
      throw new Error("Durable Direct execution fingerprint не совпадает.");
    }
    await claimAccountLock(identity.account, this.ownerKey, identity.execution_id);
    const value = JSON.parse(row.result_json) as Record<string, unknown>;
    if (!Object.keys(value).length) return null;
    if (value.schema_version !== "p0-direct-single-campaign-execution-v1") {
      await holdAccountLock(identity.account, identity.execution_id);
      throw new Error("Legacy Direct execution requires manual reconciliation.");
    }
    return value as DirectExecutionRecord;
  }

  async save(record: DirectExecutionRecord) {
    await renewAccountLock(record.account, record.execution_id);
    const result = await runtimeEnv()
      .DB.prepare(
        "UPDATE p0_executions SET status = ?, campaign_id = COALESCE(?, campaign_id), result_json = ?, updated_at = ? WHERE execution_id = ? AND user_key = ? AND account_key = ?",
      )
      .bind(
        record.status,
        record.provider_ids.campaign_id,
        JSON.stringify(record),
        record.updated_at,
        record.execution_id,
        this.ownerKey,
        record.account,
      )
      .run();
    if (Number(result.meta.changes) !== 1) throw new Error("Durable Direct execution checkpoint не сохранён.");
  }

  async release(identity: DirectExecutionIdentity) {
    await releaseAccountLock(identity.account, identity.execution_id);
  }

  async hold(identity: DirectExecutionIdentity) {
    await holdAccountLock(identity.account, identity.execution_id);
  }
}

async function readCurrencyLimits() {
  const runtime = runtimeEnv();
  const token = runtime.YANDEX_DIRECT_OAUTH_TOKEN;
  const account = runtime.YANDEX_DIRECT_CLIENT_LOGIN;
  if (!token || !account) throw new Error("Direct read credentials не настроены в Sites.");
  const response = await fetch("https://api.direct.yandex.com/json/v501/dictionaries", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Login": account,
      Accept: "application/json",
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ method: "get", params: { DictionaryNames: ["Currencies"] } }),
  });
  if (!response.ok) throw new Error(`Яндекс Директ вернул HTTP ${response.status} для Currencies.`);
  const payload = (await response.json()) as {
    error?: unknown;
    result?: { Currencies?: Array<{ Currency?: unknown; Properties?: Array<{ Name?: unknown; Value?: unknown }> }> };
  };
  if (payload.error || !Array.isArray(payload.result?.Currencies)) {
    throw new Error("Ответ Direct Currencies не соответствует контракту.");
  }
  return { minimum_weekly_budget_rub: minimumWeeklyBudgetRub(payload.result.Currencies) };
}

type VerifiedDirectBinding = Awaited<ReturnType<typeof readDirectBinding>>;

async function directAuditBinding(value: VerifiedDirectBinding): Promise<DirectAuditBinding> {
  const capability = value.capability_snapshot;
  const capabilityFingerprint = await fingerprintDirectAuditCapability({
    schema_version: capability.schema_version,
    source: capability.source,
    account: capability.account,
    api_version: capability.api_version,
    currency: capability.currency,
    available_campaign_types: [...capability.available_campaign_types].sort(),
    edit_campaigns_grant: capability.edit_campaigns_grant,
    archived: capability.archived,
    restrictions: [...capability.restrictions].sort((left, right) => left.element.localeCompare(right.element)),
    conditional_capabilities: [...capability.conditional_capabilities]
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
  return {
    expected_account: value.binding.expected_account,
    api_account: value.binding.api_account,
    client_id: value.client_id,
    matched: value.binding.matched,
    restrictions: value.capability_snapshot.restrictions,
    capability: {
      snapshot_id: capability.snapshot_id,
      fingerprint: capabilityFingerprint,
    },
    observed_at: value.observed_at,
  };
}

async function readDirectAudit(ownerKey: string, binding: DirectAuditBinding): Promise<DirectAuditSummary> {
  const runtime = runtimeEnv();
  const token = runtime.YANDEX_DIRECT_OAUTH_TOKEN ?? "";
  const account = runtime.YANDEX_DIRECT_CLIENT_LOGIN ?? "";
  if (!token || !account) throw new Error("Direct read credentials не настроены в Sites.");
  if (account !== binding.api_account || !binding.matched) {
    throw new Error("Direct audit account не совпадает с exact advertiser binding.");
  }
  const auditId = `direct-audit:${crypto.randomUUID()}`;
  return new DirectAccountAuditor({
    ownerKey,
    binding,
    provider: new YandexDirectReadApi({ token, account, fetcher: fetch, now }),
    store: new D1DirectAuditStore(runtime.DB),
    now,
    auditId: () => auditId,
    maxAgeMs: 5 * 60_000,
    reportDefinitions: buildDirectAuditReportDefinitions({
      auditId,
      dateFrom: isoDateDaysAgo(93),
      dateTo: isoDateDaysAgo(3),
    }),
  }).run();
}

async function readCompleteCampaignCatalog(binding: VerifiedDirectBinding) {
  const ownerKey = "p0-context";
  const store = new D1DirectAuditStore(runtimeEnv().DB);
  const summary = await readDirectAudit(ownerKey, await directAuditBinding(binding));
  if (!["COMPLETE", "PARTIAL"].includes(summary.status) || summary.methods_not_read.includes("Campaigns.get")) {
    throw new Error(`Direct campaign audit is ${summary.status}; duplicate preflight cannot continue.`);
  }
  const state = await store.loadCurrent(ownerKey, binding.account);
  if (!state || state.audit_id !== summary.audit_id) {
    throw new Error("Durable Direct campaign audit checkpoint отсутствует.");
  }
  const campaigns: Array<Record<string, unknown>> = [];
  for (const reference of state.collections.campaigns.artifact_references) {
    const value = record(await store.getArtifact(reference.artifact_id));
    for (const item of Array.isArray(value.objects) ? value.objects : []) {
      if (item && typeof item === "object" && !Array.isArray(item)) campaigns.push(item as Record<string, unknown>);
    }
  }
  return {
    account: summary.account_binding.api_account,
    names: campaigns
      .filter((item) => item.State !== "ARCHIVED")
      .map((item) => cleanText(String(item.Name ?? ""), 255)),
  };
}

function isoDateDaysAgo(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function readMetrika() {
  const runtime = runtimeEnv();
  const token = runtime.YANDEX_METRICA_OAUTH_TOKEN;
  const counter = runtime.YANDEX_METRICA_COUNTER_ID;
  const goal = runtime.YANDEX_METRICA_GOAL_ID;
  const campaign = runtime.YANDEX_DIRECT_CAMPAIGN_ID;
  if (!token || !counter || !goal || !campaign) {
    throw new Error("Metrika production bindings не настроены в Sites.");
  }
  const dimension = "ym:s:lastDirectClickOrder";
  // The report uses an explicit inclusive window and excludes the current provisional day.
  const start = isoDateDaysAgo(8);
  const end = isoDateDaysAgo(1);
  const query = new URLSearchParams({
    ids: counter,
    date1: start,
    date2: end,
    dimensions: `ym:s:date,${dimension}`,
    metrics: `ym:s:visits,ym:s:goal${goal}visits`,
    filters: `${dimension}=='${campaign}'`,
    accuracy: "full",
    limit: "100000",
  });
  const response = await fetch(`https://api-metrika.yandex.net/stat/v1/data?${query}`, {
    headers: { Authorization: `OAuth ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Яндекс Метрика вернула HTTP ${response.status}.`);
  const payload = (await response.json()) as {
    data?: Array<{ metrics?: number[] }>;
    sampled?: boolean;
    contains_sensitive_data?: boolean;
    sample_share?: number;
    sample_size?: number;
    sample_space?: number;
    data_lag?: number;
  };
  if (!Array.isArray(payload.data)) throw new Error("Ответ Метрики некорректен.");
  const visits = payload.data.reduce((sum, row) => sum + Number(row.metrics?.[0] ?? 0), 0);
  const goals = payload.data.reduce((sum, row) => sum + Number(row.metrics?.[1] ?? 0), 0);
  const qualityKeys = ["sampled", "contains_sensitive_data", "sample_share", "sample_size", "sample_space", "data_lag"] as const;
  const qualityMetadataComplete = qualityKeys.every((key) => Object.hasOwn(payload, key));
  return {
    counter,
    goal,
    period_start: start,
    period_end: end,
    visits,
    goals,
    observed_at: now(),
    report_status: "AVAILABLE" as const,
    window_inclusive: true as const,
    accuracy: "full" as const,
    sampling: {
      metadata_complete: qualityMetadataComplete,
      sampled: qualityMetadataComplete ? payload.sampled === true : null,
      contains_sensitive_data: qualityMetadataComplete ? payload.contains_sensitive_data === true : null,
      sample_share: qualityMetadataComplete ? Number(payload.sample_share) : null,
      sample_size: qualityMetadataComplete ? Number(payload.sample_size) : null,
      sample_space: qualityMetadataComplete ? Number(payload.sample_space) : null,
      data_lag: qualityMetadataComplete ? Number(payload.data_lag) : null,
    },
  };
}

async function readMarketEvidence({
  ownerKey,
  model,
  context,
  generatedAt,
}: {
  ownerKey: string;
  model: Record<string, unknown>;
  context: P0Context;
  generatedAt: string;
}): Promise<MarketEvidenceInput> {
  const runtime = runtimeEnv();
  const regionIds = String(runtime.YANDEX_WORDSTAT_REGION_IDS ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
  const regionNames = String(runtime.YANDEX_WORDSTAT_REGION_NAMES ?? "")
    .split(",")
    .map((item) => cleanText(item, 100))
    .filter(Boolean);
  const requestedDevice = String(runtime.YANDEX_WORDSTAT_DEVICE ?? "all");
  const configuredDevice = (["all", "desktop", "phone", "tablet"].includes(requestedDevice) ? requestedDevice : "all") as WordstatSeed["device"];
  const deviceConfigurationInvalid = requestedDevice !== configuredDevice;
  const observedDate = new Date(generatedAt);
  const dynamicsTo = new Date(Date.UTC(observedDate.getUTCFullYear(), observedDate.getUTCMonth(), 0));
  const dynamicsFrom = new Date(Date.UTC(dynamicsTo.getUTCFullYear() - 3, dynamicsTo.getUTCMonth(), 1));
  const researchPlan = await buildDemandCostResearchPlan({
    generatedAt,
    offerLanguage: cleanText(String(model.product ?? ""), 500),
    customerProblems: [model.customer_context, model.value].map((item) => cleanText(String(item ?? ""), 500)).filter(Boolean),
    highIntentActions: [model.qualified_outcome, model.qualified_result].map((item) => cleanText(String(item ?? ""), 500)).filter(Boolean),
    brandTerms: String(runtime.P0_DEMAND_BRAND_TERMS ?? "").split(",").map((item) => cleanText(item, 100)).filter(Boolean),
    exclusions: [model.exclusions, model.key_constraints]
      .flatMap((item) => String(item ?? "").split(/[;,\n]/u))
      .map((item) => cleanText(item, 200))
      .filter(Boolean),
    regionIds,
    regionNames,
    device: configuredDevice,
    seasonality: cleanText(String(model.seasonality ?? ""), 500),
    dynamicsFromDate: dynamicsFrom.toISOString().slice(0, 10),
    dynamicsToDate: dynamicsTo.toISOString().slice(0, 10),
    minimumClickSample: Number(runtime.P0_COMPARABLE_MIN_CLICKS ?? 3),
  });
  const demandClusters = researchPlan.seeds.map((seed) => ({
    cluster_id: seed.cluster_id,
    semantic_key: {
      product: seed.dimension === "OFFER_LANGUAGE" || seed.dimension === "NON_BRAND" ? seed.phrase : cleanText(String(model.product ?? ""), 500),
      need: seed.dimension === "CUSTOMER_PROBLEM" ? seed.phrase : cleanText(String(model.customer_context ?? model.audience ?? ""), 500),
      intent: seed.dimension === "HIGH_INTENT_ACTION" ? seed.phrase : cleanText(String(model.qualified_outcome ?? model.qualified_result ?? ""), 500),
      offer: seed.dimension === "BRAND" ? seed.phrase : cleanText(String(model.value ?? ""), 500),
    },
    classification: {
      version: "demand-relevance-rules-v1",
      excluded_tokens: researchPlan.exclusions,
    },
  }));
  const configurationMissing = context.access_profile?.evidence_scope?.wordstat !== "AVAILABLE"
    || !runtime.YANDEX_WORDSTAT_OAUTH_TOKEN
    || !runtime.YANDEX_WORDSTAT_CLIENT_ID
    || regionIds.length === 0
    || regionNames.length !== regionIds.length
    || deviceConfigurationInvalid;
  const wordstatBatch = configurationMissing
    ? await unavailableWordstatBatch(
        "Scoped Wordstat authority is unavailable for this bounded research plan.",
        generatedAt,
      )
    : await collectOfficialWordstatBatch({
        token: runtime.YANDEX_WORDSTAT_OAUTH_TOKEN ?? "",
        clientId: runtime.YANDEX_WORDSTAT_CLIENT_ID ?? "",
        seeds: researchPlan.seeds,
      }, fetch, now);

  const direct = record(context.direct);
  const audit = record(direct.audit);
  const artifactStore = new D1DirectAuditStore(runtime.DB);
  const checkpoint = await artifactStore.loadCurrent(ownerKey, String(direct.account ?? ""));
  const checkpointReferences = checkpoint && checkpoint.audit_id === audit.audit_id
    ? [
        ...Object.values(checkpoint.collections).flatMap((collection) => collection.artifact_references),
        ...checkpoint.reports.flatMap((report) => report.artifact_reference ? [report.artifact_reference] : []),
      ]
    : [];
  const references = checkpointReferences.length
    ? checkpointReferences
    : Array.isArray(audit.artifact_references) ? audit.artifact_references.map(record) : [];
  const artifacts = (await Promise.all(references.map((reference) => artifactStore.getArtifact(String(reference.artifact_id ?? "")))))
    .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null);
  const comparable = await qualifyDirectComparableCandidates({
    audit,
    artifacts,
    targetPhrases: researchPlan.seeds.map((seed) => seed.phrase),
    targetRegionIds: regionIds,
    targetRegionNames: regionNames,
    targetPlacement: researchPlan.comparable_cost_scope.placement,
    targetStrategy: researchPlan.comparable_cost_scope.strategy,
    observedAt: generatedAt,
    minimumClicks: researchPlan.comparable_cost_scope.minimum_click_sample,
  });
  const capability = record(direct.capability_snapshot);
  const currency = cleanText(String(capability.currency ?? runtime.YANDEX_DIRECT_CURRENCY ?? "RUB"), 10);
  const trafficVolumes = String(runtime.P0_COMPARABLE_TRAFFIC_VOLUMES ?? "")
    .split(",")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const costObservations: CostObservation[] = [];
  for (const candidate of comparable.qualified.slice(0, 3)) {
    costObservations.push(await collectCurrentAuctionCostObservation({
      token: runtime.YANDEX_DIRECT_OAUTH_TOKEN ?? "",
      account: runtime.YANDEX_DIRECT_CLIENT_LOGIN ?? "",
      keyword_id: candidate.keyword_id,
      candidate_key: candidate.candidate_key,
      expected_phrase: candidate.phrase,
      currency,
      vat_treatment: "UNKNOWN",
      traffic_volumes: trafficVolumes,
      comparability: { geography: "SAME", placement: "SAME", strategy: "SAME", season: "SAME" },
      comparison_scope: candidate.owner_scope,
      complete_direct_audit: true,
      sample_clicks: candidate.sample.clicks,
    }, fetch, now));
    costObservations.push(buildOwnHistoryCostObservation(candidate, {
      observedAt: generatedAt,
      currency,
      vatTreatment: "INCLUDED",
    }));
  }
  if (!costObservations.length) {
    costObservations.push({
      observation_id: `direct-comparable-unavailable:${researchPlan.plan_id}`,
      source: "DIRECT_HISTORY_OWN_EMPIRICAL",
      status: "UNAVAILABLE",
      scenario: "Квалификация сопоставимой собственной истории",
      scope: { phrase: "UNKNOWN", geography: "UNKNOWN", placement: "UNKNOWN", strategy: "UNKNOWN", season: "UNKNOWN" },
      as_of: generatedAt,
      currency,
      vat_treatment: "UNKNOWN",
      sample_size: { unit: "clicks", value: 0 },
      range: null,
      qualification: { first_party: true, complete_direct_audit: audit.status === "COMPLETE", clicks: 0 },
      unavailable_reason: comparable.reason ?? "NO_QUALIFIED_PRELAUNCH_COST_SOURCE",
    });
  }
  return {
    research_plan: researchPlan,
    wordstat_batch: wordstatBatch,
    demand_clusters: demandClusters,
    cost_observations: costObservations,
  };
}

function coldStartContext(): P0Context {
  const observedAt = now();
  return {
    environment: "PRODUCTION",
    test_scenario: false,
    access_profile: {
      path: "NEW_ADVERTISER",
      account_history: "UNAVAILABLE",
      evidence_scope: { direct: "UNAVAILABLE", metrika: "UNAVAILABLE", wordstat: "UNAVAILABLE" },
      limitation: "История рекламного аккаунта отсутствует для нового рекламодателя и не заменяется нулём или выдуманными данными.",
    },
    direct: {
      ready: false,
      inventory_ready: false,
      authority: "UNAVAILABLE",
      access: "YANDEX_DIRECT_API_V501",
      account: "",
      client_id: "",
      binding: { expected_account: "", api_account: "", matched: false },
      campaigns_total: null,
      minimum_weekly_budget_rub: null,
      observed_at: observedAt,
      capability_snapshot: {
        schema_version: "direct-account-capability-snapshot-v1",
        snapshot_id: "cold-start-unavailable",
        source: "YANDEX_DIRECT_API_V501",
        account: "",
        observed_at: observedAt,
        api_version: "v501",
        archived: "UNKNOWN",
        currency: "",
        edit_campaigns_grant: "UNKNOWN",
        available_campaign_types: [],
        restrictions: [],
        conditional_capabilities: [],
      },
      read_limitations: {
        inventory_complete: false,
        limited_by: null,
        methods_read: [],
        methods_not_read: ["ACCOUNT_HISTORY_UNAVAILABLE"],
        statistics_provisional_days: 3,
      },
      blockers: ["История аккаунта недоступна в cold-start профиле."],
    },
    metrika: {
      ready: false,
      authority: "UNAVAILABLE",
      access: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API",
      counter_id: "",
      goal_id: "",
      time_zone: "",
      binding: { expected_counter_id: "", api_counter_id: "", matched: false },
      goal_binding: { expected_goal_id: "", api_goal_id: "", matched: false },
      observed_at: observedAt,
      blockers: ["Частная история измерений недоступна в cold-start профиле."],
    },
    campaign_catalog: null,
    performance: null,
  };
}

async function readContext(input: { owner_key?: string } = {}): Promise<P0Context> {
  const ownerKey = input.owner_key ?? "p0-context";
  const accessState = await accessReadinessService.get(ownerKey, true);
  if (accessState.path === "NEW_ADVERTISER" && accessState.status === "ACTIVE") return coldStartContext();
  if (accessState.path !== "EXISTING_ADVERTISER"
    || !["ACTIVE", "ACTIVE_LIMITED"].includes(accessState.status)
    || !accessState.binding) {
    throw new Error("Owner-confirmed Access Readiness is required before private provider reads.");
  }
  const runtime = runtimeEnv();
  if (accessState.binding.account_identity !== (runtime.YANDEX_DIRECT_CLIENT_LOGIN ?? "")
    || accessState.binding.counter_identity !== (runtime.YANDEX_METRICA_COUNTER_ID ?? "")) {
    throw new Error("Selected business binding does not match the server-side provider configuration.");
  }
  const directBindingPromise = readDirectBinding();
  const directAuditPromise = directBindingPromise.then(async (value) => readDirectAudit(ownerKey, await directAuditBinding(value)));
  const [directBindingResult, directAuditResult, limitsResult, metrikaBindingResult, metrikaResult] = await Promise.allSettled([
    directBindingPromise,
    directAuditPromise,
    readCurrencyLimits(),
    readMetrikaBinding(),
    readMetrika(),
  ]);
  const directAuditTerminal = directAuditResult.status === "fulfilled"
    && ["COMPLETE", "PARTIAL"].includes(directAuditResult.value.status);
  const campaignInventoryReady = directAuditResult.status === "fulfilled"
    && !directAuditResult.value.methods_not_read.includes("Campaigns.get");
  const directReady = directBindingResult.status === "fulfilled"
    && directAuditTerminal
    && limitsResult.status === "fulfilled"
    && directBindingResult.value.account === directAuditResult.value.account_binding.api_account;
  const direct = directReady
    ? {
        ready: true,
        inventory_ready: campaignInventoryReady,
        ...directBindingResult.value,
        observed_at: directAuditResult.value.observed_at,
        campaigns_total: directAuditResult.value.object_counts.campaigns,
        minimum_weekly_budget_rub: limitsResult.value.minimum_weekly_budget_rub,
        audit: directAuditResult.value,
        read_limitations: {
          inventory_complete: directAuditResult.value.graph_complete,
          limited_by: null,
          methods_read: directAuditResult.value.methods_read,
          methods_not_read: directAuditResult.value.methods_not_read,
          provider_limitations: directAuditResult.value.limitations,
          statistics_provisional_days: 3,
        },
      }
    : {
        ready: false,
        inventory_ready: campaignInventoryReady,
        authority: directBindingResult.status === "fulfilled" ? directBindingResult.value.authority : "UNVERIFIED",
        access: "YANDEX_DIRECT_API_V501",
        ...(directBindingResult.status === "fulfilled" ? directBindingResult.value : {}),
        ...(directAuditResult.status === "fulfilled" ? {
          observed_at: directAuditResult.value.observed_at,
          campaigns_total: directAuditResult.value.object_counts.campaigns,
          audit: directAuditResult.value,
          read_limitations: {
            inventory_complete: directAuditResult.value.graph_complete,
            limited_by: null,
            methods_read: directAuditResult.value.methods_read,
            methods_not_read: directAuditResult.value.methods_not_read,
            provider_limitations: directAuditResult.value.limitations,
            statistics_provisional_days: 3,
          },
        } : {}),
        ...(limitsResult.status === "fulfilled" ? limitsResult.value : {}),
        blockers: [
          ...(directBindingResult.status === "rejected" ? [errorMessage(directBindingResult.reason)] : []),
          ...(directAuditResult.status === "rejected" ? [errorMessage(directAuditResult.reason)] : []),
          ...(directAuditResult.status === "fulfilled" && !directAuditTerminal
            ? [`Direct audit ${directAuditResult.value.status}; next retry ${directAuditResult.value.next_retry_at ?? "not scheduled"}.`]
            : []),
          ...(limitsResult.status === "rejected" ? [errorMessage(limitsResult.reason)] : []),
          ...(directBindingResult.status === "fulfilled" && directAuditResult.status === "fulfilled"
            && directBindingResult.value.account !== directAuditResult.value.account_binding.api_account
            ? ["Direct advertiser account binding не совпадает с durable audit"]
            : []),
        ],
      };
  const metrikaReady = metrikaBindingResult.status === "fulfilled" && metrikaResult.status === "fulfilled";
  const metrika = metrikaReady
    ? { ready: true, ...metrikaBindingResult.value }
    : {
        ready: false,
        authority: metrikaBindingResult.status === "fulfilled" ? metrikaBindingResult.value.authority : "UNVERIFIED",
        access: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API",
        ...(metrikaBindingResult.status === "fulfilled" ? metrikaBindingResult.value : {}),
        blockers: [
          ...(metrikaBindingResult.status === "rejected" ? [errorMessage(metrikaBindingResult.reason)] : []),
          ...(metrikaResult.status === "rejected" ? [errorMessage(metrikaResult.reason)] : []),
        ],
      };
  return {
    environment: "PRODUCTION",
    test_scenario: false,
    access_profile: {
      path: "EXISTING_ADVERTISER",
      account_history: "AVAILABLE",
      evidence_scope: {
        direct: accessState.scope.direct,
        metrika: accessState.scope.metrika,
        wordstat: accessState.scope.wordstat,
      },
      limitation: accessState.limitations[0] ?? null,
    },
    direct,
    metrika,
    campaign_catalog:
      directAuditResult.status === "fulfilled"
        ? {
            total: directAuditResult.value.object_counts.campaigns,
            active: directAuditResult.value.campaign_summaries,
          }
        : null,
    performance:
      metrikaResult.status === "fulfilled"
        ? {
            period_start: metrikaResult.value.period_start,
            period_end: metrikaResult.value.period_end,
            display_metrics: {
              visits: String(metrikaResult.value.visits),
              goal_visits: String(metrikaResult.value.goals),
            },
            provenance: {
              source_kind: "METRIKA_REPORTS_API",
              report_status: metrikaResult.value.report_status,
              observed_at: metrikaResult.value.observed_at,
              window_inclusive: metrikaResult.value.window_inclusive,
              accuracy: metrikaResult.value.accuracy,
              attribution: "last_direct_click_order_dimension",
              timezone: metrikaBindingResult.status === "fulfilled" ? metrikaBindingResult.value.time_zone : "",
              dimensions: ["ym:s:date", "ym:s:lastDirectClickOrder"],
              filters: `ym:s:lastDirectClickOrder=='${runtimeEnv().YANDEX_DIRECT_CAMPAIGN_ID ?? ""}'`,
              sampling: metrikaResult.value.sampling,
            },
          }
        : null,
  };
}

async function resolveHostname(hostname: string) {
  return resolveHostnameWithDnsJson(hostname, fetch);
}

async function researchSite(rawUrl: string) {
  return researchPublicFirstPartySite(rawUrl, {
    fetch,
    resolveHostname,
    now,
  });
}

async function readCompetitorResearch() {
  const configured = runtimeEnv().P0_COMPETITOR_RESEARCH_JSON;
  if (!configured) throw new Error("Bounded production competitor candidate set is not configured.");
  return collectProductionCompetitorResearch(configured, {
    fetch,
    resolveHostname,
    now,
  });
}

async function ensureTables() {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("Sites D1 binding DB недоступен.");
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_state (user_key TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, value_json TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_state_revisions (user_key TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY (user_key, revision))",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_executions (execution_id TEXT PRIMARY KEY, user_key TEXT NOT NULL, account_key TEXT NOT NULL, status TEXT NOT NULL, campaign_id TEXT, projection_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_account_locks (account_key TEXT PRIMARY KEY, execution_id TEXT NOT NULL, owner_key TEXT NOT NULL, expires_at TEXT NOT NULL)",
  ).run();
  await ensureP0AgentTables(db);
  await ensureP0DirectAuditTables(db);
}

export class D1AccessReadinessStore implements AccessReadinessStore {
  private async ensureTable() {
    await runtimeEnv().DB.prepare(
      "CREATE TABLE IF NOT EXISTS p0_access_readiness (user_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, value_json TEXT NOT NULL)",
    ).run();
  }

  async load(key: string): Promise<AccessStoredRow | null> {
    await this.ensureTable();
    return runtimeEnv().DB
      .prepare("SELECT revision, updated_at, value_json FROM p0_access_readiness WHERE user_key = ?")
      .bind(key)
      .first<AccessStoredRow>();
  }

  async initialize(key: string, row: AccessStoredRow) {
    await this.ensureTable();
    const result = await runtimeEnv().DB
      .prepare("INSERT OR IGNORE INTO p0_access_readiness(user_key, revision, updated_at, value_json) VALUES (?, ?, ?, ?)")
      .bind(key, row.revision, row.updated_at, row.value_json)
      .run();
    return Number(result.meta.changes) === 1;
  }

  async compareAndSwap(key: string, expectedRevision: number, row: AccessStoredRow) {
    await this.ensureTable();
    const result = await runtimeEnv().DB
      .prepare("UPDATE p0_access_readiness SET revision = ?, updated_at = ?, value_json = ? WHERE user_key = ? AND revision = ?")
      .bind(row.revision, row.updated_at, row.value_json, key, expectedRevision)
      .run();
    return Number(result.meta.changes) === 1;
  }
}

function accessConfiguration() {
  const runtime = runtimeEnv();
  return {
    directToken: runtime.YANDEX_DIRECT_OAUTH_TOKEN ?? "",
    directExpectedAccount: runtime.YANDEX_DIRECT_CLIENT_LOGIN ?? "",
    directCampaignId: runtime.YANDEX_DIRECT_CAMPAIGN_ID ?? "",
    directBusinessLabel: runtime.P0_DIRECT_BUSINESS_LABEL ?? "",
    metrikaToken: runtime.YANDEX_METRICA_OAUTH_TOKEN ?? "",
    metrikaExpectedCounterId: runtime.YANDEX_METRICA_COUNTER_ID ?? "",
    metrikaGoalId: runtime.YANDEX_METRICA_GOAL_ID ?? "",
    wordstatToken: runtime.YANDEX_WORDSTAT_OAUTH_TOKEN ?? "",
    wordstatClientId: runtime.YANDEX_WORDSTAT_CLIENT_ID ?? "",
  };
}

const accessReadinessService = new AccessReadinessService({
  store: new D1AccessReadinessStore(),
  adapter: new YandexAccessReadinessAdapter(accessConfiguration(), fetch, now),
  now,
});

export class D1P0ApplicationStore implements P0ApplicationStore {
  async load(key: string): Promise<P0StoredRow | null> {
    await ensureTables();
    const row = await runtimeEnv().DB
      .prepare("SELECT revision, updated_at, value_json FROM p0_state WHERE user_key = ?")
      .bind(key)
      .first<P0StoredRow>();
    if (row) {
      await runtimeEnv().DB
        .prepare("INSERT OR IGNORE INTO p0_state_revisions(user_key, revision, updated_at, value_json) VALUES (?, ?, ?, ?)")
        .bind(key, row.revision, row.updated_at, row.value_json)
        .run();
    }
    return row;
  }

  async initialize(key: string, row: P0StoredRow) {
    await ensureTables();
    const result = await runtimeEnv().DB
      .prepare("INSERT OR IGNORE INTO p0_state(user_key, revision, updated_at, value_json) VALUES (?, ?, ?, ?)")
      .bind(key, row.revision, row.updated_at, row.value_json)
      .run();
    if (Number(result.meta.changes) !== 1) return false;
    await runtimeEnv().DB
      .prepare("INSERT OR IGNORE INTO p0_state_revisions(user_key, revision, updated_at, value_json) VALUES (?, ?, ?, ?)")
      .bind(key, row.revision, row.updated_at, row.value_json)
      .run();
    return true;
  }

  async compareAndSwap(key: string, expectedRevision: number, row: P0StoredRow) {
    const db = runtimeEnv().DB;
    const [result] = await db.batch([
      db.prepare(
        "UPDATE p0_state SET revision = ?, updated_at = ?, value_json = ? WHERE user_key = ? AND revision = ?",
      ).bind(row.revision, row.updated_at, row.value_json, key, expectedRevision),
      db.prepare(
        "INSERT OR IGNORE INTO p0_state_revisions(user_key, revision, updated_at, value_json) SELECT user_key, revision, updated_at, value_json FROM p0_state WHERE user_key = ? AND revision = ? AND value_json = ?",
      ).bind(key, row.revision, row.value_json),
    ]);
    return Number(result.meta.changes) === 1;
  }

  async history(key: string, limit = 50) {
    await ensureTables();
    const result = await runtimeEnv().DB
      .prepare(
        "SELECT revision, updated_at, value_json FROM p0_state_revisions WHERE user_key = ? ORDER BY revision DESC LIMIT ?",
      )
      .bind(key, limit)
      .all<P0StoredRow>();
    return result.results;
  }
}

async function createPackageItemOutcome({
  key,
  state,
  item_execution_id: itemExecutionId,
  selection,
  projection,
  draft,
  gate,
}: {
  key: string;
  state: P0Document;
  package_execution_id: string;
  item_execution_id: string;
  selection: NonNullable<P0Document["shortlist"]>["selections"][number];
  projection: DirectProjection;
  draft: NonNullable<P0Document["recommendation_set"]>["drafts"][number];
  gate: NonNullable<P0Document["human_decision_gate"]>;
}) {
  const config = directWriteConfig();
  if (!config.token || !config.account) throw new Error("Direct production credentials не настроены.");
  if (!state.strategy || !state.context_state || !state.recommendation_set) {
    throw new Error("Exact package execution lineage отсутствует.");
  }
  const bindingPromise = readDirectBinding();
  const [binding, catalog, limits] = await Promise.all([
    bindingPromise,
    bindingPromise.then((value) => readCompleteCampaignCatalog(value)),
    readCurrencyLimits(),
  ]);
  if (binding.account !== config.account || catalog.account !== binding.account) {
    throw new Error("Direct write account не прошёл точный API binding preflight.");
  }
  validateWeeklyBudgetRub(strategyAnswerValue(state.strategy, "weekly_budget"), limits.minimum_weekly_budget_rub);
  const existing = await runtimeEnv()
    .DB.prepare("SELECT execution_id FROM p0_executions WHERE execution_id = ? AND user_key = ? AND account_key = ?")
    .bind(itemExecutionId, key, config.account)
    .first<{ execution_id: string }>();
  if (!existing) {
    if (hasDuplicateCampaignName(catalog.names, String(projection.direct.campaign.Name ?? ""))) {
      return {
        execution_id: itemExecutionId,
        status: "SYSTEM_FAILED",
        error_code: "P0_DUPLICATE_CAMPAIGN_NAME",
        error_message: "MOX-ADV preflight обнаружил существующую активную кампанию с таким названием.",
        validation_failed: true,
        dispatch_not_attempted: true,
        containment: "NOT_CREATED",
        account_lock: "RELEASED",
      };
    }
    await beginExecution(key, config.account, projection, itemExecutionId);
  }
  const packageAuthority = gate.authority;
  try {
    const result = await executeSafeSingleCampaign({
      execution_id: itemExecutionId,
      config,
      projection,
      authority: {
        direct_account_binding: packageAuthority.direct_account_binding,
        direct_capability_snapshot: packageAuthority.direct_capability_snapshot,
        capability_profile: packageAuthority.capability_profile,
        publish_fingerprint: selection.publish_fingerprint,
        publication_blockers: campaignDraftPublishBlockers(draft),
      },
      journal: new D1DirectExecutionJournal(key, projection),
      fetcher: fetch,
      now,
    });
    return { execution_id: itemExecutionId, ...result };
  } catch (error) {
    if (!(error instanceof DirectWriteError)) throw error;
    return directExecutionFailureOutcome(itemExecutionId, error);
  }
}

async function resubmitCorrectedPackageItemOutcome({
  key,
  state,
  item_execution_id: itemExecutionId,
  selection,
  projection,
  draft,
  gate,
  source_item: sourceItem,
}: {
  key: string;
  state: P0Document;
  package_execution_id: string;
  item_execution_id: string;
  selection: NonNullable<P0Document["shortlist"]>["selections"][number];
  projection: DirectProjection;
  draft: NonNullable<P0Document["recommendation_set"]>["drafts"][number];
  gate: NonNullable<P0Document["human_decision_gate"]>;
  source_item: NonNullable<P0Document["package_execution"]>["items"][number];
}) {
  const config = directWriteConfig();
  if (!config.token || !config.account) throw new Error("Direct production credentials не настроены.");
  if (!state.strategy || !state.context_state || gate.authority.direct_account_binding.account !== config.account) {
    throw new Error("Corrected package Gate не совпадает с persisted Strategy, Context или Direct account.");
  }
  const campaignId = sourceItem.provider_ids.campaign_id;
  const adGroupId = sourceItem.provider_ids.ad_group_id;
  const keywordId = sourceItem.provider_ids.keyword_id;
  const adId = sourceItem.provider_ids.ad_ids[0];
  if (!campaignId || !adGroupId || !keywordId || !adId
    || sourceItem.provider_ids.ad_group_ids.length !== 1
    || sourceItem.provider_ids.keyword_ids.length !== 1
    || sourceItem.provider_ids.ad_ids.length !== 1
    || sourceItem.status !== "REJECTED_NEEDS_EDIT"
    || sourceItem.account_lock !== "RELEASED") {
    throw new Error("Correction resubmission requires one fully-accounted rejected core Direct graph.");
  }
  const changedPointers = (Array.isArray(record(draft.material_delta).fields) ? record(draft.material_delta).fields as unknown[] : [])
    .map((field) => String(record(field).pointer ?? ""))
    .filter(Boolean);
  const requestedFingerprint = await fingerprintDirectProjection(projection as unknown as Record<string, unknown>);
  if (requestedFingerprint !== selection.publish_fingerprint) {
    throw new Error("Corrected projection fingerprint не совпадает с exact Gate.");
  }
  const existing = await runtimeEnv()
    .DB.prepare("SELECT execution_id FROM p0_executions WHERE execution_id = ? AND user_key = ? AND account_key = ?")
    .bind(itemExecutionId, key, config.account)
    .first<{ execution_id: string }>();
  if (!existing) await beginExecution(key, config.account, projection, itemExecutionId);
  await claimAccountLock(config.account, key, itemExecutionId);
  const row = await runtimeEnv()
    .DB.prepare("SELECT execution_id, user_key, account_key, status, campaign_id, projection_json, result_json FROM p0_executions WHERE execution_id = ? AND user_key = ? AND account_key = ?")
    .bind(itemExecutionId, key, config.account)
    .first<ExecutionRow>();
  if (!row) {
    await holdAccountLock(config.account, itemExecutionId);
    throw new DirectWriteError("P0_CORRECTION_JOURNAL_MISSING", "Durable corrected Direct execution record отсутствует.", {
      requires_reconciliation: true,
      containment: "RECONCILIATION_REQUIRED",
      account_lock: "HELD_FOR_RECONCILIATION",
    });
  }
  const storedProjection = JSON.parse(row.projection_json) as DirectProjection;
  if (await fingerprintDirectProjection(storedProjection as unknown as Record<string, unknown>) !== requestedFingerprint) {
    await holdAccountLock(config.account, itemExecutionId);
    throw new DirectWriteError("P0_CORRECTION_FINGERPRINT_MISMATCH", "Durable corrected Direct execution fingerprint не совпадает.", {
      requires_reconciliation: true,
      containment: "RECONCILIATION_REQUIRED",
      account_lock: "HELD_FOR_RECONCILIATION",
    });
  }
  const stored = JSON.parse(row.result_json) as Record<string, unknown>;
  if (Object.keys(stored).length && stored.schema_version !== "p0-direct-correction-execution-v1") {
    await holdAccountLock(config.account, itemExecutionId);
    throw new DirectWriteError("P0_CORRECTION_JOURNAL_SCHEMA_INVALID", "Corrected Direct execution journal schema requires manual reconciliation.", {
      requires_reconciliation: true,
      containment: "RECONCILIATION_REQUIRED",
      account_lock: "HELD_FOR_RECONCILIATION",
    });
  }
  const storedSourceIds = record(stored.source_provider_ids);
  const sourceProviderIds = { campaign_id: campaignId, ad_group_id: adGroupId, keyword_id: keywordId, ad_id: adId };
  if (Object.keys(storedSourceIds).length && JSON.stringify(storedSourceIds) !== JSON.stringify(sourceProviderIds)) {
    await holdAccountLock(config.account, itemExecutionId);
    throw new DirectWriteError("P0_CORRECTION_PROVIDER_LINEAGE_CHANGED", "Corrected Direct source provider lineage changed.", {
      requires_reconciliation: true,
      containment: "RECONCILIATION_REQUIRED",
      account_lock: "HELD_FOR_RECONCILIATION",
    });
  }
  const terminalResult = record(stored.terminal_result);
  if (Object.keys(terminalResult).length) {
    await releaseAccountLock(config.account, itemExecutionId);
    return { execution_id: itemExecutionId, ...terminalResult };
  }
  let journal: Record<string, unknown> = Object.keys(stored).length ? stored : {
    schema_version: "p0-direct-correction-execution-v1",
    execution_id: itemExecutionId,
    publish_fingerprint: requestedFingerprint,
    source_provider_ids: sourceProviderIds,
    status: "CORRECTION_DISPATCH_INTENT_PERSISTED",
    completed_updates: [],
    moderation_intent_persisted: false,
    progress: {},
    terminal_result: null,
  };
  const saveJournal = async (status: string, progress: Record<string, unknown>) => {
    journal = {
      ...journal,
      status,
      completed_updates: Array.isArray(progress.completed_updates) ? structuredClone(progress.completed_updates) : journal.completed_updates,
      moderation_intent_persisted: progress.moderation_intent_persisted === true || journal.moderation_intent_persisted === true,
      progress: structuredClone(progress),
      updated_at: now(),
    };
    await renewAccountLock(config.account, itemExecutionId);
    const saved = await runtimeEnv().DB
      .prepare("UPDATE p0_executions SET status = ?, campaign_id = ?, result_json = ?, updated_at = ? WHERE execution_id = ? AND user_key = ? AND account_key = ?")
      .bind(status, campaignId, JSON.stringify(journal), journal.updated_at, itemExecutionId, key, config.account)
      .run();
    if (Number(saved.meta.changes) !== 1) throw new Error("Durable corrected Direct checkpoint не сохранён.");
  };
  await saveJournal(String(journal.status), record(journal.progress));
  try {
    const completedUpdates = Array.isArray(journal.completed_updates) ? journal.completed_updates.map(String) : [];
    const ambiguousOperation = String(record(journal.progress).ambiguous_operation ?? "");
    if (ambiguousOperation.endsWith(".update") && !completedUpdates.includes(ambiguousOperation)) {
      const reconciled = await reconcileCorrectedCampaignUpdate(
        config,
        projection,
        { campaignId, adGroupId, keywordId, adId },
        ambiguousOperation,
        fetch,
      );
      completedUpdates.push(reconciled.completed_update);
      journal = { ...journal, completed_updates: structuredClone(completedUpdates) };
      await saveJournal("CORRECTED_UPDATE_RECONCILED", {
        ...record(journal.progress),
        completed_updates: completedUpdates,
      });
    }
    const result = await correctSuspendedCampaignAndResubmitModeration(
      config,
      projection,
      { campaignId, adGroupId, keywordId, adId },
      changedPointers,
      fetch,
      saveJournal,
      {
        completedUpdates,
        moderationIntentPersisted: journal.moderation_intent_persisted === true,
      },
    );
    journal = { ...journal, status: String(result.status), terminal_result: structuredClone(result), updated_at: now() };
    await saveJournal(String(result.status), result);
    await releaseAccountLock(config.account, itemExecutionId);
    return { execution_id: itemExecutionId, ...result };
  } catch (error) {
    if (!(error instanceof DirectWriteError)) {
      await holdAccountLock(config.account, itemExecutionId);
      throw new DirectWriteError("P0_CORRECTION_JOURNAL_FAILED", "Corrected Direct execution journal interrupted; reconciliation retains the account boundary.", {
        requires_reconciliation: true,
        containment: "RECONCILIATION_REQUIRED",
        account_lock: "HELD_FOR_RECONCILIATION",
      }, { cause: error });
    }
    const requiresReconciliation = error.partial.requires_reconciliation === true
      || error.partial.account_lock === "HELD_FOR_RECONCILIATION"
      || ["RECONCILIATION_REQUIRED", "MANUAL_RECONCILIATION_REQUIRED"].includes(String(error.partial.containment ?? ""));
    const outcome = directExecutionFailureOutcome(itemExecutionId, Object.assign(error, {
      partial: {
        ...error.partial,
        campaign_id: campaignId,
        provider_ids: {
          campaign_id: campaignId,
          ad_group_id: adGroupId,
          keyword_id: keywordId,
          ad_group_ids: [adGroupId],
          keyword_ids: [keywordId],
          ad_ids: [adId],
        },
        account_lock: requiresReconciliation ? "HELD_FOR_RECONCILIATION" : "RELEASED",
      },
    }));
    journal = { ...journal, status: String(outcome.status), terminal_result: requiresReconciliation ? null : structuredClone(outcome), updated_at: now() };
    await saveJournal(String(outcome.status), outcome);
    if (requiresReconciliation) await holdAccountLock(config.account, itemExecutionId);
    else await releaseAccountLock(config.account, itemExecutionId);
    return outcome;
  }
}

async function pollPackageItemOutcome({
  key,
  item_execution_id: itemExecutionId,
  projection,
  item,
  gate,
}: {
  key: string;
  state: P0Document;
  package_execution_id: string;
  item_execution_id: string;
  selection: NonNullable<P0Document["shortlist"]>["selections"][number];
  projection: DirectProjection;
  draft: NonNullable<P0Document["recommendation_set"]>["drafts"][number];
  item: NonNullable<P0Document["package_execution"]>["items"][number];
  gate: NonNullable<P0Document["human_decision_gate"]>;
}) {
  const config = directWriteConfig();
  if (!config.token || !config.account) throw new Error("Direct production credentials не настроены.");
  if (gate.authority.direct_account_binding.account !== config.account) {
    throw new Error("Exact package Gate не совпадает с Direct moderation account.");
  }
  const row = await runtimeEnv()
    .DB.prepare("SELECT execution_id, user_key, account_key, status, campaign_id, projection_json, result_json FROM p0_executions WHERE execution_id = ? AND user_key = ? AND account_key = ?")
    .bind(itemExecutionId, key, config.account)
    .first<ExecutionRow>();
  if (!row) throw new Error("Durable Direct execution record отсутствует для moderation poll.");
  const storedProjection = JSON.parse(row.projection_json) as DirectProjection;
  const [storedFingerprint, requestedFingerprint] = await Promise.all([
    fingerprintDirectProjection(storedProjection as unknown as Record<string, unknown>),
    fingerprintDirectProjection(projection as unknown as Record<string, unknown>),
  ]);
  if (storedFingerprint !== requestedFingerprint || requestedFingerprint !== item.selection.publish_fingerprint) {
    throw new Error("Moderation poll projection fingerprint не совпадает с durable item execution.");
  }
  const campaignId = item.provider_ids.campaign_id;
  const adGroupId = item.provider_ids.ad_group_id;
  const keywordId = item.provider_ids.keyword_id;
  if (!campaignId || !adGroupId || !keywordId || item.provider_ids.ad_ids.length !== 1) {
    throw new Error("Moderation poll требует полный набор exact core provider IDs.");
  }
  try {
    return {
      execution_id: itemExecutionId,
      ...await pollSuspendedCampaignModeration(
        config,
        projection,
        { campaignId, adGroupId, keywordId, adIds: item.provider_ids.ad_ids },
        fetch,
      ),
    };
  } catch (error) {
    if (!(error instanceof DirectWriteError)) throw error;
    if (error.partial.requires_reconciliation === true) {
      return {
        execution_id: itemExecutionId,
        status: "OUTCOME_UNKNOWN",
        campaign_id: campaignId,
        provider_ids: structuredClone(item.provider_ids),
        campaign_state: item.campaign_state,
        containment: item.containment,
        account_lock: "RELEASED",
        error_code: error.code,
        error_message: error.message,
      };
    }
    return directExecutionFailureOutcome(itemExecutionId, Object.assign(error, {
      partial: {
        ...error.partial,
        campaign_id: campaignId,
        provider_ids: structuredClone(item.provider_ids),
        campaign_state: item.campaign_state,
        containment: item.containment,
        account_lock: "RELEASED",
      },
    }));
  }
}

async function createExternalOutcome({
  key,
  state,
  projection,
}: {
  key: string;
  state: P0Document;
  projection: DirectProjection;
}) {
  const config = directWriteConfig();
  if (!config.token || !config.account) throw new Error("Direct production credentials не настроены.");
  const bindingPromise = readDirectBinding();
  const [binding, catalog, limits] = await Promise.all([
    bindingPromise,
    bindingPromise.then((value) => readCompleteCampaignCatalog(value)),
    readCurrencyLimits(),
  ]);
  if (binding.account !== config.account || catalog.account !== binding.account) {
    throw new Error("Direct write account не прошёл точный API binding preflight.");
  }
  if (!state.strategy) throw new Error("Campaign Strategy отсутствует.");
  validateWeeklyBudgetRub(strategyAnswerValue(state.strategy, "weekly_budget"), limits.minimum_weekly_budget_rub);
  if (!state.context_state || !state.recommendation_set || !state.draft) {
    throw new Error("Exact Context, Recommendation Set и Campaign Draft отсутствуют.");
  }
  const campaignName = String(projection.direct.campaign.Name ?? "");
  let executionId = await findExactExecution(key, config.account, projection);
  if (!executionId) {
    if (hasDuplicateCampaignName(catalog.names, campaignName)) {
      throw new Error("В аккаунте уже существует активная кампания с таким названием.");
    }
    executionId = await beginExecution(key, config.account, projection);
  }
  const directFacts = state.context_state.facts.direct;
  const publishFingerprint = String(state.draft.publish_fingerprint ?? "");
  const result = await executeSafeSingleCampaign({
    execution_id: executionId,
    config,
    projection,
    authority: {
      direct_account_binding: {
        source_kind: "YANDEX_DIRECT_API_V501",
        account: directFacts.account,
        client_id: directFacts.client_id,
        verified: true,
      },
      direct_capability_snapshot: directFacts.capability_snapshot as unknown as Record<string, unknown>,
      capability_profile: state.recommendation_set.capability_profile as unknown as Record<string, unknown>,
      publish_fingerprint: publishFingerprint,
      publication_blockers: campaignDraftPublishBlockers(state.draft),
    },
    journal: new D1DirectExecutionJournal(key, projection),
    fetcher: fetch,
    now,
  });
  return { execution_id: executionId, ...result };
}

const application = new P0Application({
  store: new D1P0ApplicationStore(),
  adapters: {
    now,
    readContext,
    async readDirectAudit() {
      const binding = await readDirectBinding();
      return readDirectAudit("p0-context", await directAuditBinding(binding));
    },
    researchSite,
    readCurrencyLimits,
    readMarketEvidence,
    ...(runtimeEnv().P0_COMPETITOR_RESEARCH_JSON ? { readCompetitorResearch } : {}),
    async readPlaybookReleases() {
      return [readP0CuratedPlaybookV1()];
    },
    externalWriteConfiguration() {
      const config = directWriteConfig();
      const blockers = [
        ...(!config.token ? ["Direct production OAuth token не настроен"] : []),
        ...(!config.account ? ["Direct advertiser account не настроен"] : []),
      ];
      return { ready: blockers.length === 0, blockers, account: config.account };
    },
    createExternalOutcome,
    createPackageItemOutcome,
    resubmitCorrectedPackageItemOutcome,
    pollPackageItemOutcome,
  },
});

async function coordinateOwnerAgent(key: string): Promise<P0AgentOwnerProjection> {
  try {
    const state = await productionAgentRuntime().coordinate({
      owner_key: key,
      budgets: P0_AGENT_BUDGETS,
    });
    return projectP0AgentRunForOwner(state);
  } catch {
    return {
      status: "blocked",
      progress: { completed: 0, total: 1, label: "Работа безопасно остановлена" },
      card: {
        kind: "problem",
        title: "Агент сейчас недоступен",
        body: "Бизнес-состояние не изменено; техническая неполадка не стала новым вопросом владельцу.",
      },
      nextBusinessStep: "Вернуться к текущему бизнес-шагу без технического управления.",
    };
  }
}

const ownerJourney = new P0OwnerJourney(application, {
  agentProjection: coordinateOwnerAgent,
  accessReadiness: accessReadinessService,
});

export async function ownerOverview(key: string) {
  return ownerJourney.query(key);
}

export async function submitOwnerAction(key: string, payload: Record<string, unknown>) {
  return ownerJourney.submit(key, payload as OwnerActionSubmission);
}

export async function operatorDiagnostics(key: string) {
  return ownerJourney.diagnostics(key);
}

const P0_AGENT_BUDGETS = {
  max_model_calls: 8,
  max_tool_calls: 12,
  max_input_tokens: 80_000,
  max_output_tokens: 16_000,
  max_elapsed_ms: 120_000,
  max_cost_microusd: 100_000,
} as const;

function productionAgentRuntime() {
  const runtime = runtimeEnv();
  return new P0AgentRuntime({
    application: {
      contract: (ownerKey, objectiveKind) => application.agentContract(ownerKey, objectiveKind),
      executeTool: (input) => application.executeAgentTool(input),
      evaluate: (input) => application.evaluateAgentObjective(input),
    },
    model: createP0ModelAdapter({
      provider: runtime.P0_AGENT_PROVIDER ?? "",
      model: runtime.P0_AGENT_MODEL ?? "gpt-5-mini",
      openaiApiKey: runtime.OPENAI_API_KEY ?? "",
      codexBridgeUrl: runtime.P0_CODEX_BRIDGE_URL ?? "",
      codexBridgeToken: runtime.P0_CODEX_BRIDGE_TOKEN ?? "",
    }, fetch),
    store: new D1P0AgentRunStore(runtime.DB),
    now,
  });
}

export async function runAgent(key: string) {
  const access = await accessReadinessService.get(key, true);
  if (!["ACTIVE", "ACTIVE_LIMITED"].includes(access.status)) {
    throw new Error("Owner-confirmed Access Readiness is required before agent coordination.");
  }
  return coordinateOwnerAgent(key);
}
