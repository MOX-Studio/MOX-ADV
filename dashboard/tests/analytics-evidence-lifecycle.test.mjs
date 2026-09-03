import assert from "node:assert/strict";
import test from "node:test";

import { buildAnalyticsEvidence } from "../lib/analytics-evidence.ts";
import {
  ANALYTICS_EVIDENCE_DOMAINS,
  emptyAnalyticsEvidenceLifecycle,
  invalidateAnalyticsEvidenceSnapshot,
  migrateAnalyticsEvidenceLifecycle,
  recordAnalyticsEvidenceSnapshot,
  verifyAnalyticsEvidenceLifecycle,
} from "../lib/analytics-evidence-lifecycle.ts";

function evidenceInput(product, generatedAt) {
  return {
    generatedAt,
    site: {
      fetched_at: generatedAt,
      url: "https://owner.example/",
      pages: [{
        url: "https://owner.example/",
        title: "Owner",
        description: product,
        headings: [product],
        forms_detected: 1,
        text_excerpt: `${product}. Оставьте заявку.`,
      }],
      research: { pages_analyzed: 1, scope: "FIRST_PARTY_PUBLIC_HTTPS" },
    },
    model: {
      product,
      audience: "Руководители компаний",
      value: "Проверяемый результат",
      qualified_result: "Заявка",
      exclusions: "Случайные обращения",
      missing_questions: [],
      field_evidence: {
        product: {
          confidence: "OWNER_CONFIRMED",
          source_url: "https://owner.example/",
          quote: product,
          owner_confirmed: true,
          owner_confirmed_at: generatedAt,
        },
      },
    },
    context: {
      direct: {
        ready: false,
        inventory_ready: false,
        authority: "UNAVAILABLE",
        access: "YANDEX_DIRECT_API_V501",
        account: "",
        client_id: "",
        binding: { expected_account: "", api_account: "", matched: false },
        blockers: ["Нет подтверждённого доступа"],
      },
      metrika: {
        ready: false,
        authority: "UNAVAILABLE",
        access: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API",
        counter_id: "",
        goal_id: "",
        binding: { expected_counter_id: "", api_counter_id: "", matched: false },
        goal_binding: { expected_goal_id: "", api_goal_id: "", matched: false },
      },
      performance: null,
      campaign_catalog: null,
      competitor_observations: [],
    },
  };
}

function lineage(version) {
  return {
    context_revision_id: `context-r${version}`,
    context_material_fingerprint: `sha256:${String(version).repeat(64).slice(0, 64)}`,
    business_model_revision_id: `model-r${version}`,
    business_model_material_fingerprint: `sha256:${String(version + 1).repeat(64).slice(0, 64)}`,
  };
}

test("analytics evidence lifecycle reuses one active version and records an explicit material replacement", async () => {
  const first = await buildAnalyticsEvidence(evidenceInput("Участие в выставке", "2026-08-21T10:00:00.000Z"));
  const second = await buildAnalyticsEvidence(evidenceInput("Партнёрский пакет выставки", "2026-08-21T11:00:00.000Z"));
  let lifecycle = emptyAnalyticsEvidenceLifecycle();

  lifecycle = await recordAnalyticsEvidenceSnapshot({
    lifecycle,
    currentSnapshot: null,
    nextSnapshot: first,
    recordedAt: first.generated_at,
    trigger: "INITIAL_COLLECTION",
    changedDomains: ANALYTICS_EVIDENCE_DOMAINS,
    inputLineage: lineage(1),
    invalidatedOutputs: [],
  });
  assert.equal(lifecycle.active_version, 1);
  assert.equal(lifecycle.active_snapshot_id, first.snapshot_id);
  assert.equal(lifecycle.versions[0].comparison.result, "INITIAL");
  assert.equal(await verifyAnalyticsEvidenceLifecycle(lifecycle, first), true);

  const reused = await recordAnalyticsEvidenceSnapshot({
    lifecycle,
    currentSnapshot: first,
    nextSnapshot: first,
    recordedAt: "2026-08-21T10:30:00.000Z",
    trigger: "MODEL_MATERIAL_CHANGE",
    changedDomains: ANALYTICS_EVIDENCE_DOMAINS,
    inputLineage: lineage(1),
    invalidatedOutputs: ["campaign_strategy"],
  });
  assert.deepEqual(reused, lifecycle, "the same content-addressed snapshot must not create a hidden version");

  lifecycle = await invalidateAnalyticsEvidenceSnapshot({
    lifecycle,
    currentSnapshot: first,
    invalidatedAt: "2026-08-21T10:45:00.000Z",
    trigger: "MODEL_MATERIAL_CHANGE",
    changedDomains: ANALYTICS_EVIDENCE_DOMAINS,
    inputLineage: lineage(1),
    invalidatedOutputs: ["recommendation_set", "campaign_strategy", "campaign_strategy"],
  });
  assert.equal(lifecycle.active_version, null);
  assert.equal(lifecycle.active_snapshot_id, null);
  assert.equal(lifecycle.pending_replacement.previous_snapshot_id, first.snapshot_id);
  assert.deepEqual(lifecycle.pending_replacement.invalidated_outputs, ["campaign_strategy", "recommendation_set"]);
  assert.equal(await verifyAnalyticsEvidenceLifecycle(lifecycle, null), true);

  lifecycle = await recordAnalyticsEvidenceSnapshot({
    lifecycle,
    currentSnapshot: null,
    nextSnapshot: second,
    recordedAt: second.generated_at,
    trigger: "MODEL_MATERIAL_CHANGE",
    changedDomains: ANALYTICS_EVIDENCE_DOMAINS,
    inputLineage: lineage(2),
    invalidatedOutputs: [],
  });
  assert.equal(lifecycle.active_version, 2);
  assert.equal(lifecycle.versions[1].previous_snapshot_id, first.snapshot_id);
  assert.equal(lifecycle.versions[1].snapshot_id, second.snapshot_id);
  assert.equal(lifecycle.versions[1].comparison.result, "MATERIAL_REPLACEMENT");
  assert.deepEqual(lifecycle.versions[1].invalidated_outputs, ["campaign_strategy", "recommendation_set"]);
  assert.equal(await verifyAnalyticsEvidenceLifecycle(lifecycle, second), true);

  const corrupted = structuredClone(lifecycle);
  corrupted.versions[1].previous_snapshot_id = "sha256:forged";
  assert.equal(await verifyAnalyticsEvidenceLifecycle(corrupted, second), false);
});

test("legacy migration preserves the current snapshot as a verified version without duplicating analytics", async () => {
  const snapshot = await buildAnalyticsEvidence(evidenceInput("Участие в выставке", "2026-08-21T10:00:00.000Z"));
  const lifecycle = await migrateAnalyticsEvidenceLifecycle({
    snapshot,
    recordedAt: "2026-08-21T10:05:00.000Z",
    inputLineage: lineage(7),
  });

  assert.equal(lifecycle.versions.length, 1);
  assert.equal(lifecycle.versions[0].trigger, "LEGACY_MIGRATION");
  assert.equal(lifecycle.versions[0].snapshot_id, snapshot.snapshot_id);
  assert.equal(lifecycle.versions[0].input_lineage.business_model_revision_id, "model-r7");
  assert.equal(Object.hasOwn(lifecycle.versions[0], "snapshot"), false);
  assert.equal(await verifyAnalyticsEvidenceLifecycle(lifecycle, snapshot), true);
});
