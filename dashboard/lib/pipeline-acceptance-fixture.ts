import { buildPublishProjection } from "./campaign-draft.ts";
import { DIRECT_V501_DRAFT_FIELD_REGISTRY } from "./campaign-draft-fields.ts";
import { fingerprintDirectProjection } from "./campaign-fanout.ts";
import { D1PipelineRunStore } from "./pipeline-orchestrator-d1-store.ts";
import { D1CurrentGoalStore } from "./goal-revision-d1-store.ts";
import {
  PipelineOrchestrator,
  pipelineDigest,
  type PipelineDiscardedAttempt,
  type PipelineRunState,
  type PipelineStageId,
  type PipelineVerifiedAttempt,
  type PipelineVersionReference,
} from "./pipeline-orchestrator.ts";
import type { PipelineHistoricalView } from "./pipeline-owner-dashboard.ts";

export const PIPELINE_ACCEPTANCE_FIXTURE_SCENARIO = "pipeline-acceptance";

const MODEL = {
  product: "Участие со стендом в выставке ИННОПРОМ",
  audience: "Руководители промышленных компаний",
  value: "Встречи с заказчиками и промышленными партнёрами",
  qualified_result: "Отправленная заявка на участие",
};

const STRATEGY = {
  schema_version: "campaign-strategy-v4",
  strategy_revision_id: "pipeline-acceptance-strategy-r1",
  goal: "Получать заявки на участие",
  advertised_offer: MODEL.product,
  target_audience: MODEL.audience,
  qualified_result: MODEL.qualified_result,
  exclusions: "Вакансии и бесплатные билеты",
  geography: "Россия",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  landing_page: "https://innoprom.com/participant/",
  weekly_budget_rub: "10000",
  target_cpa_rub: "2000",
  message: "Подайте заявку на участие в выставке",
  playbook: { release_id: "p0-curated-playbook-v1" },
};

const EVIDENCE = {
  schema_version: "analytics-evidence-snapshot-v7",
  snapshot_id: "pipeline-acceptance-evidence-r1",
  observations: [{ claim: "Предложение и аудитория подтверждены разрешёнными публичными источниками." }],
  sources: [
    { source_id: "first-party", status: "AVAILABLE" },
    { source_id: "wordstat", status: "AVAILABLE", source_kind: "wordstat_ui" },
    { source_id: "direct", status: "UNAVAILABLE", limitation: "Cold start: private Direct history is not required by the base profile." },
    { source_id: "metrika", status: "UNAVAILABLE", limitation: "The base profile does not consume an exact Metrika goal." },
    { source_id: "financial", status: "UNAVAILABLE", limitation: "Optional financial evidence remains unavailable rather than zero." },
  ],
};

async function draft(suffix: string) {
  const draftId = `pipeline-acceptance-draft-${suffix}`;
  const hypothesisId = `pipeline-acceptance-hypothesis-${suffix}@1`;
  const value: Record<string, unknown> = {
    schema_version: "campaign-draft-v4",
    draft_id: draftId,
    draft_revision_id: `${draftId}@1`,
    strategy_revision_id: STRATEGY.strategy_revision_id,
    capability_profile_id: "p0-campaign-creation-profile-v1",
    capability_profile_version: "1.0.0",
    direct_capability_snapshot_id: null,
    playbook_release_id: null,
    playbook_rule_id: null,
    campaign_name: `ИННОПРОМ · заявки · ${suffix}`,
    group_name: `Заявка на участие · ${suffix}`,
    negative_keywords: "вакансии, бесплатно",
    keyword: suffix === "focus" ? "участие в иннопром со стендом" : "стенд на иннопром для компании",
    ad_title: suffix === "focus" ? "Стенд на ИННОПРОМ" : "Участие в ИННОПРОМ",
    ad_text: "Подайте заявку на участие со стендом",
    advertiser_account: "",
    currency: "",
    capability_snapshot_id: null,
    measurement_requirement: "NOT_CONSUMED",
    variant: {
      kind: "IMPROVEMENT",
      code: "QUALIFIED_ACTION",
      hypothesis: {
        hypothesis_id: hypothesisId,
        source: "EVIDENCE_GROUNDED_DESIGN",
        mechanism: suffix === "focus"
          ? "Уточнить квалифицированное действие в объявлении."
          : "Отделить самостоятельное предложение для участия со стендом.",
        evidence_refs: [EVIDENCE.snapshot_id],
      },
    },
    campaign_hypothesis_id: hypothesisId,
    campaign_hypothesis_revision_id: hypothesisId,
    future_campaign_id: `future-campaign-${suffix}`,
    capability_selection: {
      eligible: true,
      selected_capabilities: [],
      selected_fields: [],
      unsupported_fields: [],
      blockers: [],
      capability_snapshot_id: null,
    },
    unsupported_fields: [],
    suppression_reason: null,
    duplicate_of: null,
  };
  value.publish_projection = buildPublishProjection(MODEL, STRATEGY, value);
  value.publish_fingerprint = await fingerprintDirectProjection(value.publish_projection as Parameters<typeof fingerprintDirectProjection>[0]);
  return value;
}

/**
 * Localhost-only fixture document used to prove the cut-over pipeline. It uses
 * the complete base Direct Projection without private Direct/Metrika history,
 * keeps optional unavailable evidence explicit, and includes one defective
 * optional direction that authoritative pair checks must discard.
 */
export async function pipelineAcceptanceHistoricalView(input: {
  ownerGoal?: string;
  sharedMandatoryGap?: boolean;
} = {}): Promise<PipelineHistoricalView> {
  const complete = [await draft("focus"), await draft("stand")];
  const defective = await draft("discarded");
  const defectiveProjection = defective.publish_projection as {
    direct: { ad: { ResponsiveAd: { Texts?: string[] } } };
  };
  delete defectiveProjection.direct.ad.ResponsiveAd.Texts;
  defective.publish_fingerprint = await fingerprintDirectProjection(
    defective.publish_projection as Parameters<typeof fingerprintDirectProjection>[0],
  );
  const strategy = input.sharedMandatoryGap ? { ...STRATEGY, geography: "" } : STRATEGY;
  const ownerGoal = input.ownerGoal ?? STRATEGY.goal;
  return {
    revision: 1,
    state: {
      schema_version: "p0-application-document-v19",
      context_state: {
        business_goal_decision: {
          schema_version: "p0-business-goal-decision-v1",
          decision_id: "pipeline-acceptance-goal-input-r1",
          value: ownerGoal,
        },
      },
      owner_goal_interview: { revision: 1, confirmed_answers: [ownerGoal] },
      business_model: { schema_version: "p0-business-model-v1", ...MODEL },
      analytics_evidence_snapshot: EVIDENCE,
      strategy,
      recommendation_set: {
        schema_version: "campaign-recommendation-set-v4",
        recommendation_set_id: "pipeline-acceptance-pairs-r1",
        strategy_revision_id: STRATEGY.strategy_revision_id,
        analytics_evidence_snapshot_id: EVIDENCE.snapshot_id,
        direct_capability_snapshot_id: null,
        field_registry: DIRECT_V501_DRAFT_FIELD_REGISTRY,
        playbook_release: { status: "NOT_APPLICABLE", release_id: null },
        drafts: [...complete, defective],
      },
    },
  };
}

async function reference(name: string, sequence: number): Promise<PipelineVersionReference> {
  const value = { schema_version: `${name}-v1`, revision_id: `${name}:${sequence}` };
  return { ...value, digest: await pipelineDigest(value) };
}

async function verifiedAttempt(
  run: PipelineRunState,
  stage: PipelineStageId,
  sequence: number,
): Promise<PipelineVerifiedAttempt> {
  return {
    actor: { actor_id: `fixture-${stage.toLowerCase()}`, actor_type: "AGENT", role: "STAGE_EXECUTOR" },
    inputs: [await reference(`${stage.toLowerCase()}-input`, sequence)],
    evidence: [await reference(`${stage.toLowerCase()}-evidence`, sequence)],
    output: await reference(`${stage.toLowerCase()}-output`, sequence),
    checks: [{ check_id: `${stage}_CHECK`, status: "PASSED", policy: run.input_versions.pipeline_policy }],
    schemas: [await reference(`${stage.toLowerCase()}-schema`, sequence)],
    policies: [run.input_versions.pipeline_policy],
    campaign_playbook: run.input_versions.campaign_playbook,
  };
}

async function discardedAttempt(
  run: PipelineRunState,
  stage: PipelineStageId,
): Promise<PipelineDiscardedAttempt> {
  const attempt = await verifiedAttempt(run, stage, 1);
  return {
    ...attempt,
    output: await reference(`${stage.toLowerCase()}-discarded`, 1),
    checks: attempt.checks.map((check) => ({ ...check, status: "FAILED" as const })),
  };
}

/** Runs controlled downstream agent products through the real durable orchestrator. */
export async function completePipelineAcceptanceRun(db: D1Database, ownerKey: string) {
  const orchestrator = new PipelineOrchestrator({ store: new D1PipelineRunStore(db) });
  let run = await orchestrator.current(ownerKey);
  if (!run || run.status !== "ACTIVE") throw new Error("Pipeline acceptance fixture requires one active run.");
  const currentGoal = await new D1CurrentGoalStore(db).loadCurrent(ownerKey);
  if (!currentGoal?.revision.success_criterion) throw new Error("Pipeline acceptance fixture requires one complete owner Goal.");
  run = await orchestrator.acceptGoalRevision({
    run_id: run.run_id,
    expected_version: run.version,
    revision: currentGoal.revision,
  });
  run = await orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "EVIDENCE_COLLECTION",
    reason_code: "EVIDENCE_VERIFIED",
    reason: "Разрешённые сведения и явные необязательные пробелы проверены.",
    attempt: await verifiedAttempt(run, "EVIDENCE_COLLECTION", 1),
  });
  run = await orchestrator.retry({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "STRATEGY",
    reason_code: "STRATEGY_AUTONOMOUS_CORRECTION",
    reason: "Консолидированный пакет содержательных нарушений исправляется автономно один раз.",
    attempt: await discardedAttempt(run, "STRATEGY"),
  });
  run = await orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "STRATEGY",
    reason_code: "STRATEGY_VERIFIED",
    reason: "Исправленная Strategy прошла обязательные проверки.",
    attempt: await verifiedAttempt(run, "STRATEGY", 2),
  });
  return orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "CAMPAIGNS",
    reason_code: "DRAFTS_COMPLETE",
    reason: "Две независимые полные пары переданы без публикации; дефектное необязательное направление отброшено.",
    attempt: await verifiedAttempt(run, "CAMPAIGNS", 1),
  });
}
