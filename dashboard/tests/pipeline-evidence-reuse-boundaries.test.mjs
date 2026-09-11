import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildAnalyticsEvidence, canonicalizeEvidence, verifyAnalyticsEvidenceSnapshot } from "../lib/analytics-evidence.ts";
import { createCurrentGoal } from "../lib/goal-revision-lifecycle.ts";
import { QUALIFIED_REQUEST_COUNTING_POLICY } from "../lib/goal-revision.ts";
import { pipelineInputVersions } from "../lib/pipeline-owner-dashboard.ts";
import { PipelineOrchestrator, pipelineDigest, verifyPipelineAuditTrail, verifyPipelineRunState } from "../lib/pipeline-orchestrator.ts";
import {
  assessPipelineEvidenceReuse,
  pipelineEvidenceResearchScope,
  retainVerifiedPipelineEvidence,
  verifiedEvidenceSourceEvent,
  verifyRetainedPipelineEvidence,
} from "../lib/pipeline-evidence-reuse.ts";

const COLLECTED_AT = "2026-09-05T12:00:00.000Z";
const OWNER = "reuse-boundary-owner";
const evidenceHash = (value) => `sha256:${createHash("sha256").update(canonicalizeEvidence(value)).digest("hex")}`;
const without = (value, ...keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

class MemoryRunStore {
  runs = new Map();
  events = new Map();
  async load(id) { return structuredClone(this.runs.get(id) ?? null); }
  async loadCurrent(owner) { return structuredClone([...this.runs.values()].find((run) => run.owner_key === owner) ?? null); }
  async loadActive(owner) { return structuredClone([...this.runs.values()].find((run) => run.owner_key === owner && run.status === "ACTIVE") ?? null); }
  async loadAudit(id) { return structuredClone(this.events.get(id) ?? []); }
  async initialize(run, event) {
    if (this.runs.has(run.run_id)) return false;
    this.runs.set(run.run_id, structuredClone(run));
    this.events.set(run.run_id, [structuredClone(event)]);
    return true;
  }
  async compareAndSwap(id, version, run, event) {
    if (this.runs.get(id)?.version !== version) return false;
    this.runs.set(id, structuredClone(run));
    this.events.set(id, [...this.events.get(id), structuredClone(event)]);
    return true;
  }
}

async function analyticsSnapshot() {
  return buildAnalyticsEvidence({
    generatedAt: COLLECTED_AT,
    site: {
      fetched_at: "2026-09-05T11:58:00.000Z", url: "https://owner.example/",
      pages: [{ url: "https://owner.example/", title: "Учёт для магазинов", text_excerpt: "Внедрение товарного учёта для магазинов", forms_detected: 1 }],
      research: { pages_analyzed: 1, scope: "FIRST_PARTY_PUBLIC_HTTPS" },
    },
    model: {
      product: "Внедрение товарного учёта для магазинов", audience: "Владельцы магазинов",
      value: "Настройка учёта", qualified_result: "Заявка на внедрение", exclusions: "Вакансии",
      field_evidence: {
        product: { source_url: "https://owner.example/", quote: "Внедрение товарного учёта для магазинов", confidence: "MEDIUM" },
      },
    },
    context: {
      direct: {
        ready: true, inventory_ready: true, authority: "VERIFIED", access: "YANDEX_DIRECT_API_V501",
        account: "owner-login", client_id: "101", campaigns_total: 1, observed_at: "2026-09-05T11:59:30.000Z",
        binding: { expected_account: "owner-login", api_account: "owner-login", matched: true },
        read_limitations: { inventory_complete: true, limited_by: null, methods_read: ["Campaigns.get"], methods_not_read: ["AdGroups.get", "Keywords.get", "Ads.get"], statistics_provisional_days: 3 },
      },
      campaign_catalog: { total: 1, active: [{ campaign_id: "1", name: "Учёт", state: "ON", status: "ACCEPTED" }] },
    },
  });
}

// Conservative uncertainty fixture: every content hash and reference is rebuilt, then the real verifier
// and orchestrator authenticate the new snapshot; no VERIFIED stamp or verification function is stubbed.
async function withDeclaredUnknown(snapshot, sourceIds) {
  const result = structuredClone(snapshot);
  const changedIds = new Map();
  for (const evidence of result.evidence.filter((item) => sourceIds.includes(item.source_id))) {
    const previousId = evidence.evidence_id;
    evidence.freshness.status = "unknown";
    evidence.freshness.age_seconds = null;
    evidence.limitations = [...evidence.limitations, "Observation timestamp is retained, but source freshness is explicitly unknown."];
    const body = without(evidence, "evidence_id", "record_hash");
    evidence.record_hash = evidenceHash(body);
    evidence.evidence_id = `urn:mox:evidence:${evidence.record_hash.slice(7)}`;
    changedIds.set(previousId, evidence.evidence_id);
  }
  for (const claim of result.claims) {
    if (claim.evidence_ids.some((id) => changedIds.has(id))) {
      claim.confidence.freshness = "unknown";
      claim.confidence.uncertainty = [...claim.confidence.uncertainty, "Source freshness remains unknown."];
    }
    claim.evidence_ids = claim.evidence_ids.map((id) => changedIds.get(id) ?? id).sort();
    const body = without(claim, "claim_id", "claim_hash");
    claim.claim_hash = evidenceHash(body);
  }
  for (const source of result.sources) {
    source.evidence_ids = source.evidence_ids.map((id) => changedIds.get(id) ?? id).sort();
    const body = without(source, "manifest_hash");
    source.manifest_hash = evidenceHash(body);
  }
  result.confidence.freshness = "UNKNOWN";
  for (const domain of result.domain_manifest.domains) {
    domain.freshness = { current: 0, aging: 0, stale: 0, unknown: 0 };
    for (const index of domain.claim_indexes) domain.freshness[result.claims[index].confidence.freshness] += 1;
  }
  for (const field of ["sources", "claims", "evidence", "domain_manifest"]) result.hashes[`${field}_sha256`] = evidenceHash(result[field]);
  result.hashes.input_root_sha256 = evidenceHash(Object.fromEntries([
    "scope", "generated_at", "as_of", "versions", "sources", "claims", "evidence", "conflicts", "gaps", "domain_manifest",
    "competitor_ad_observation", "competitor_matrix", "financial_competitor_intelligence", "product_catalog", "focus_opportunities", "market_evidence",
  ].map((field) => [field, result[field]])));
  const unsigned = without(result, "snapshot_id");
  result.snapshot_id = evidenceHash(unsigned);
  assert.equal(await verifyAnalyticsEvidenceSnapshot(result), true, "The uncertainty fixture must remain a valid sealed Analytics Evidence Snapshot.");
  return result;
}

async function fixture({ unknownSources = [] } = {}) {
  let snapshot = await analyticsSnapshot();
  assert.equal(await verifyAnalyticsEvidenceSnapshot(snapshot), true);
  if (unknownSources.length) snapshot = await withDeclaredUnknown(snapshot, unknownSources);
  const currentGoal = await createCurrentGoal({
    owner_key: OWNER, desired_outcome: "Получать квалифицированные заявки", qualified_action: "Компания подтвердила потребность во внедрении",
    customer_geography: "Россия", counting_policy: QUALIFIED_REQUEST_COUNTING_POLICY,
    success_criterion: { target_count: 20, deadline: "2026-10-31", max_result_cost_rub: 5000 }, created_at: "2026-09-05T11:55:00.000Z",
  });
  const currentState = { schema_version: "p0-application-document-v19", business_model: { product: "Внедрение товарного учёта" } };
  const versions = await pipelineInputVersions({ revision: 1, state: currentState });
  const goalReference = { schema_version: currentGoal.revision.schema_version, revision_id: currentGoal.revision.goal_revision_id, digest: currentGoal.revision.digest };
  versions.goal_revision = goalReference;
  const snapshotReference = { schema_version: snapshot.schema_version, revision_id: snapshot.snapshot_id, digest: await pipelineDigest(snapshot) };
  const store = new MemoryRunStore();
  let tick = 0;
  const orchestrator = new PipelineOrchestrator({ store, newRunId: () => "boundary-source-run", now: () => new Date(Date.parse(COLLECTED_AT) + tick++ * 1000).toISOString() });
  const started = await orchestrator.start(OWNER, versions);
  const evidenceStage = await orchestrator.acceptGoalRevision({ run_id: started.run_id, expected_version: started.version, revision: currentGoal.revision });
  const schemaReference = { schema_version: "analytics-verifier-contract-v1", revision_id: "analytics-verifier:1", digest: await pipelineDigest({ verifier: "verifyAnalyticsEvidenceSnapshot" }) };
  const run = await orchestrator.advance({
    run_id: started.run_id, expected_version: evidenceStage.version, source_stage: "EVIDENCE_COLLECTION",
    reason_code: "EVIDENCE_VERIFIED", reason: "The real snapshot verifier accepted the exact sealed evidence.",
    attempt: {
      actor: { actor_id: "boundary-evidence-analyst", actor_type: "AGENT", role: "EVIDENCE_ANALYST" },
      inputs: [goalReference], evidence: [snapshotReference], output: snapshotReference,
      checks: [{ check_id: "ANALYTICS_SNAPSHOT_VERIFIED", status: "PASSED", policy: versions.pipeline_policy }],
      schemas: [schemaReference], policies: [versions.pipeline_policy], campaign_playbook: versions.campaign_playbook,
    },
  });
  const audit = await orchestrator.audit(run.run_id);
  assert.ok(await verifyPipelineRunState(run));
  assert.equal((await verifyPipelineAuditTrail(audit, run)).length, 3);
  const evidence = await retainVerifiedPipelineEvidence({
    run, snapshot, stateRevision: 1,
    researchScopeDigest: await pipelineEvidenceResearchScope({ versions, state: currentState }),
  });
  assert.ok(evidence);
  assert.equal(await verifyRetainedPipelineEvidence(evidence), true);
  const assessmentInput = {
    currentOwnerKey: OWNER, evidence, sourceRun: run, sourceAudit: audit, currentGoal: currentGoal.revision,
    currentVersions: versions, currentState, stateRevision: 1, evaluatedAt: "2026-09-05T12:10:00.000Z",
  };
  return { snapshot, audit, run, evidence, assessmentInput };
}

test("replay requires the current owner even when Goal and all document references are identical", async () => {
  const input = await fixture();
  assert.equal((await assessPipelineEvidenceReuse(input.assessmentInput)).availability.available, true);
  const otherOwner = await assessPipelineEvidenceReuse({ ...input.assessmentInput, currentOwnerKey: "another-owner" });
  assert.equal(otherOwner.availability.available, false);
  assert.equal(otherOwner.plan, null);
  assert.match(otherOwner.availability.reason, /владельц/iu);
});

test("declared unknown first-party freshness stays unknown despite a parseable recent observation timestamp", async () => {
  const input = await fixture({ unknownSources: ["first-party-web", "owner-confirmed"] });
  const firstParty = input.snapshot.evidence.filter((item) => item.source_id === "first-party-web");
  assert.ok(firstParty.length > 0);
  assert.ok(firstParty.every((item) => item.freshness.status === "unknown" && Number.isFinite(Date.parse(item.observed_at))));
  const result = await assessPipelineEvidenceReuse(input.assessmentInput);
  assert.equal(result.availability.available, false);
  assert.equal(result.plan, null);
  assert.match(result.availability.reason, /подтверждённых фактов/iu);
});

test("declared unknown operational freshness remains in replay diagnostics and never becomes readiness", async () => {
  const input = await fixture({ unknownSources: ["direct"] });
  const direct = input.snapshot.evidence.filter((item) => item.source_id === "direct");
  assert.ok(direct.length > 0);
  const result = await assessPipelineEvidenceReuse({ ...input.assessmentInput, evaluatedAt: "2026-09-05T12:01:00.000Z" });
  assert.equal(result.availability.available, true);
  for (const item of direct) {
    assert.ok(result.plan.assessment.unknown_freshness_evidence_refs.includes(item.evidence_id));
    assert.ok(result.plan.assessment.expired_operational_evidence_refs.includes(item.evidence_id));
  }
  assert.equal(result.plan.assessment.current_operational_readiness, "UNVERIFIED");
  assert.equal(result.plan.assessment.publication_freshness, "UNVERIFIED");
  assert.deepEqual(result.plan.evidence.snapshot, input.snapshot);
});

test("original verification time is tied to the authenticated stage event and cannot be refreshed by rehashing retention", async () => {
  const input = await fixture();
  const sourceEvent = await verifiedEvidenceSourceEvent({ evidence: input.evidence, run: input.run, audit: input.audit });
  assert.ok(sourceEvent);
  const accepted = await assessPipelineEvidenceReuse(input.assessmentInput);
  assert.equal(accepted.plan.assessment.original_verified_at, sourceEvent.recorded_at);
  const changed = structuredClone(input.evidence);
  changed.verified_at = "2026-09-05T12:09:00.000Z";
  const body = without(changed, "digest");
  changed.digest = await pipelineDigest(body);
  assert.equal(await verifyRetainedPipelineEvidence(changed), true, "A valid retained content hash alone must not replace audit provenance.");
  assert.equal(await verifiedEvidenceSourceEvent({ evidence: changed, run: input.run, audit: input.audit }), null);
  const rejected = await assessPipelineEvidenceReuse({ ...input.assessmentInput, evidence: changed });
  assert.equal(rejected.availability.available, false);
  assert.equal(rejected.plan, null);
  const beforeVerification = await assessPipelineEvidenceReuse({ ...input.assessmentInput, evaluatedAt: "2026-09-05T12:00:01.000Z" });
  assert.equal(beforeVerification.availability.available, false);
});

test("expired five-minute operational evidence is retained only for historical planning without changing original freshness", async () => {
  const input = await fixture();
  const direct = input.snapshot.evidence.filter((item) => item.source_id === "direct" && item.freshness.policy_id.includes("/5m"));
  assert.ok(direct.length > 0);
  assert.ok(direct.every((item) => item.freshness.status === "fresh"));
  const result = await assessPipelineEvidenceReuse(input.assessmentInput);
  assert.equal(result.availability.available, true);
  assert.equal(result.plan.assessment.use, "HISTORICAL_PLANNING");
  assert.equal(result.availability.strategyReusable, false);
  assert.equal(result.plan.assessment.current_operational_readiness, "UNVERIFIED");
  assert.equal(result.plan.assessment.publication_freshness, "UNVERIFIED");
  for (const item of direct) assert.ok(result.plan.assessment.expired_operational_evidence_refs.includes(item.evidence_id));
  assert.equal(result.plan.evidence.collected_at, COLLECTED_AT);
  assert.equal(result.plan.assessment.original_collected_at, COLLECTED_AT);
  assert.deepEqual(result.plan.evidence.snapshot, input.snapshot);
  assert.equal(await verifyAnalyticsEvidenceSnapshot(result.plan.evidence.snapshot), true);
});
