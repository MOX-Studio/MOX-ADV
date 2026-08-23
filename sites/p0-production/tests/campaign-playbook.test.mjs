import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  curatedPlaybookContentDigest,
  resolveCuratedPlaybookReleases,
  sealCuratedPlaybookRelease,
} from "../lib/campaign-playbook.ts";
import {
  P0_CURATED_PLAYBOOK_PROMOTION_POLICY_V1,
  P0_CURATED_PLAYBOOK_V1,
} from "../lib/p0-curated-playbook-v1.ts";

const evaluatedAt = "2026-08-24T00:00:00.000Z";

function applicability(overrides = {}) {
  return {
    campaign_fanout_contract: "campaign-fanout-v1",
    capability_profile_ids: ["p0-campaign-creation-profile-v1"],
    campaign_types: ["UNIFIED_CAMPAIGN"],
    placements: ["SEARCH"],
    required_strategy_fields: ["advertised_offer", "qualified_result"],
    measurement_statuses: ["READY"],
    ...overrides,
  };
}

async function governedRule(overrides = {}) {
  const rule = {
    rule_id: "qualified-result-alignment",
    rule_version: "1.0.0",
    contract_version: "1.0.0",
    content_digest: "",
    state: "ACTIVE",
    approval_status: "APPROVED",
    changed_family: "QUALIFIED_ACTION",
    mechanism: "Показать качественный результат прямо в формулировке предложения и проверить его как отдельную гипотезу.",
    changed_fields: ["/direct/keyword/Keyword", "/direct/ad/ResponsiveAd/Texts"],
    required_capabilities: [],
    evidence_quality: 100,
    priority: 10,
    promotion_policy_id: "p0-project-decisions-v1",
    qualified_evidence_refs: ["https://yandex.ru/support/direct/ru/efficiency/improve-your-ads"],
    applicability: applicability(),
    official_source: {
      authority: "YANDEX_DIRECT",
      title: "Как сделать объявления эффективнее",
      url: "https://yandex.ru/support/direct/ru/efficiency/improve-your-ads",
    },
    observed_at: "2026-08-23T00:00:00.000Z",
    review_due_at: "2026-11-21T00:00:00.000Z",
    expires_at: "2027-02-19T00:00:00.000Z",
    conflicts: [{ code: "MEASUREMENT_NOT_READY", effect: "NOT_APPLICABLE" }],
    exceptions: [{ code: "QUALIFIED_RESULT_UNCONFIRMED", effect: "NOT_APPLICABLE" }],
    eval_fixture: {
      fixture_id: "qualified-result-alignment-ready",
      path: "tests/fixtures/playbook/qualified-result-alignment-ready.json",
      expected_outcome: "APPLIED",
    },
    admission: {
      method: "CURATED_PROJECT_RELEASE",
      source_kind: "OFFICIAL_SOURCE_AND_ACCEPTED_PROJECT_DECISION",
      automatic_promotion: false,
      authority_effect: "NONE",
    },
    superseded_by_rule_id: null,
    ...overrides,
  };
  const unsigned = Object.fromEntries(Object.entries(rule).filter(([key]) => key !== "content_digest"));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonicalize(unsigned))));
  rule.content_digest = `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
  return rule;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalize(nested)]));
}

async function release(rules, overrides = {}) {
  return sealCuratedPlaybookRelease({
    schema_version: "p0-curated-playbook-release-v1",
    contract_version: "1.0.0",
    release_id: "governed-release",
    release_version: "1.0.0",
    status: "ACTIVE",
    approval_status: "APPROVED",
    observed_at: "2026-08-23T00:00:00.000Z",
    review_due_at: "2026-11-21T00:00:00.000Z",
    expires_at: "2027-02-19T00:00:00.000Z",
    previous_release_digest: null,
    promotion_policy: {
      policy_id: "p0-project-decisions-v1",
      policy_version: "1.0.0",
      content_digest: `sha256:${"b".repeat(64)}`,
    },
    approval_attestation: {
      decision_id: "github-issue-149-accepted-decision",
      actor_id: "github:ElJeskos",
      actor_role: "KNOWLEDGE_STEWARD",
      approved_at: "2026-08-23T04:30:16.000Z",
      basis_url: "https://github.com/ElJeskos/MOX-ADV/issues/149",
    },
    superseded_by_release_id: null,
    rules,
    competitive_sample_rules: [],
    ...overrides,
  });
}

const context = {
  campaign_fanout_contract: "campaign-fanout-v1",
  capability_profile_id: "p0-campaign-creation-profile-v1",
  campaign_type: "UNIFIED_CAMPAIGN",
  placement: "SEARCH",
  strategy_fields: ["advertised_offer", "qualified_result"],
  measurement_status: "READY",
};

test("checked-in curated playbook v1 is exact, official-source governed, and eval-backed", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/playbook/qualified-result-alignment-ready.json", import.meta.url), "utf8"));
  const resolved = await resolveCuratedPlaybookReleases([structuredClone(P0_CURATED_PLAYBOOK_V1)], { evaluatedAt, applicability: fixture.applicability });
  assert.equal(resolved.release?.release_id, "p0-curated-playbook-v1");
  assert.equal(resolved.rules.length, 1);
  assert.equal(resolved.rules[0].official_source.authority, "YANDEX_DIRECT");
  assert.equal(resolved.rules[0].eval_fixture.fixture_id, fixture.fixture_id);
  assert.equal(resolved.rules[0].admission.automatic_promotion, false);
  assert.equal(resolved.rules[0].admission.authority_effect, "NONE");
  assert.match(resolved.release.content_digest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(resolved.rules[0].content_digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    resolved.release.promotion_policy.content_digest,
    await curatedPlaybookContentDigest(P0_CURATED_PLAYBOOK_PROMOTION_POLICY_V1),
  );
});

test("selection is deterministic and rejects stale, malformed, unapproved, contradicted, quarantined, and superseded rules", async () => {
  const active = await governedRule();
  const variants = [
    await governedRule({ rule_id: "stale", review_due_at: "2026-08-24T00:00:00.000Z" }),
    await governedRule({ rule_id: "malformed", official_source: { authority: "BLOG", title: "Advice", url: "https://example.com" } }),
    await governedRule({ rule_id: "unknown-field", unexpected_default: true }),
    await governedRule({ rule_id: "unapproved", approval_status: "UNAPPROVED" }),
    await governedRule({ rule_id: "contradicted", state: "CONTRADICTED" }),
    await governedRule({ rule_id: "quarantined", state: "QUARANTINED" }),
    await governedRule({ rule_id: "superseded", state: "SUPERSEDED", superseded_by_rule_id: "replacement" }),
  ];
  const value = await release([active, ...variants]);
  const first = await resolveCuratedPlaybookReleases([value], { evaluatedAt, applicability: context });
  const second = await resolveCuratedPlaybookReleases([structuredClone(value)], { evaluatedAt, applicability: context });
  assert.deepEqual(first, second);
  assert.deepEqual(first.rules.map((rule) => rule.rule_id), ["qualified-result-alignment"]);
  for (const reason of [
    "PLAYBOOK_RULE_STALE",
    "PLAYBOOK_RULE_MALFORMED",
    "PLAYBOOK_RULE_UNAPPROVED",
    "PLAYBOOK_RULE_CONTRADICTED",
    "PLAYBOOK_RULE_QUARANTINED",
    "PLAYBOOK_RULE_SUPERSEDED",
  ]) assert.equal(first.audits.some((audit) => audit.reason_code === reason), true, reason);
});

test("stale releases and ambiguous active selection fail closed instead of choosing a default", async () => {
  const rule = await governedRule();
  const stale = await release([rule], {
    release_id: "stale-release",
    review_due_at: "2026-08-24T00:00:00.000Z",
  });
  const staleResult = await resolveCuratedPlaybookReleases([stale], { evaluatedAt, applicability: context });
  assert.equal(staleResult.release, null);
  assert.equal(staleResult.audits.some((audit) => audit.reason_code === "PLAYBOOK_RELEASE_STALE"), true);

  const unknownFieldRelease = await release([rule], { release_id: "unknown-field-release", unexpected_default: true });
  const malformed = await resolveCuratedPlaybookReleases([unknownFieldRelease], { evaluatedAt, applicability: context });
  assert.equal(malformed.release, null);
  assert.equal(malformed.audits.some((audit) => audit.reason_code === "PLAYBOOK_RELEASE_MALFORMED"), true);

  const first = await release([rule], { release_id: "active-a" });
  const second = await release([rule], { release_id: "active-b" });
  const ambiguous = await resolveCuratedPlaybookReleases([second, first], { evaluatedAt, applicability: context });
  assert.equal(ambiguous.release, null);
  assert.deepEqual(ambiguous.rules, []);
  assert.equal(ambiguous.audits.filter((audit) => audit.reason_code === "PLAYBOOK_MULTIPLE_ACTIVE_APPROVED_RELEASES").length, 2);
});

test("pre-launch observations, edits, moderation outcomes, and missing predicates never become rules or invented defaults", async () => {
  const observation = await governedRule({
    rule_id: "self-promoted-observation",
    admission: {
      method: "PRE_LAUNCH_OBSERVATION",
      source_kind: "MODERATION_OUTCOME",
      automatic_promotion: true,
      authority_effect: "EXPAND",
    },
  });
  const value = await release([observation]);
  const blocked = await resolveCuratedPlaybookReleases([value], { evaluatedAt, applicability: context });
  assert.deepEqual(blocked.rules, []);
  assert.equal(blocked.audits.some((audit) => audit.reason_code === "PLAYBOOK_RULE_SELF_PROMOTION_FORBIDDEN"), true);

  const missingMeasurement = await release([await governedRule()]);
  const notApplicable = await resolveCuratedPlaybookReleases([missingMeasurement], {
    evaluatedAt,
    applicability: { ...context, measurement_status: "UNAVAILABLE" },
  });
  assert.deepEqual(notApplicable.rules, []);
  assert.equal(notApplicable.audits.some((audit) => audit.reason_code === "PLAYBOOK_RULE_NOT_APPLICABLE"), true);
});
