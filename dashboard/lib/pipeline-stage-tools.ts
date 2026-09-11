import { KEYWORD_PREPARATION_VERSION, keywordPreparationInstructions, verifyKeywordResearch } from "./keyword-preparation.ts";
import { buildFindingsReport } from "./findings-research.ts";
import { verifyAnalyticsEvidenceSnapshot } from "./analytics-evidence.ts";
import { verifyGoalEvidenceScope } from "./goal-evidence-scope.ts";
import { CAMPAIGN_STRATEGY_DIMENSIONS, compileCampaignStrategy, type CampaignStrategyAgentInput } from "./campaign-strategy-agent.ts";
import { validateCampaignStrategyGrounding } from "./campaign-design-content.ts";
import { evidenceIndex, evidenceProjection, strategyInputs, strategyPlanningInput, evidenceRefMap, sameMaterialValue, hasPriorityMaterialValue } from "./pipeline-stage-context.ts";
import { compileCampaignPortfolio, prepareCampaignPortfolio } from "./pipeline-campaign-tools.ts";
import { pipelineDigest, type PipelineRunState, type PipelineStageId, type PipelineVersionReference, type PipelineVerifiedAttempt } from "./pipeline-orchestrator.ts";
import type { CampaignPlaybookStrategySnapshot } from "./campaign-playbook-governance.ts";
import type { ProductionHistoricalView, ProductionStageAgentResult, ProductionEvidenceInterpretation, ProductionStrategyArtifact } from "./production-stage-agents.ts";
import type { PipelineVerifiedProduct } from "./pipeline-current-products.ts";
import { pipelineEvidenceResearchScope } from "./pipeline-evidence-reuse.ts";
import { CAMPAIGN_FORMATION_METHOD, formationResearchSchema, formationPlanSchema, validateFormationShape, verifyFormationResearch, verifyFormationPlan, formationInstructions, formationError, type FormationResearch, type FormationPlan } from "./campaign-formation-method.ts";
import { prepareFormationPortfolio, compileFormationPortfolio } from "./pipeline-formation-tools.ts";
import { GOAL_PREPARATION_VERSION, GOAL_OUTCOME_PREPARATION_VERSION, GOAL_PREPARATION_VERSIONS, LEGACY_GOAL_PREPARATION_VERSION, goalPreparationInstructions, verifyGoalPreparation, type GoalPreparationVersion } from "./campaign-goal-preparation.ts";
import { goalMeasurement, goalResultCostCeiling, goalTotalBudgetRub } from "./goal-revision.ts";
import { goalPrelaunchInstructions, verifyGoalRequirements } from "./goal-prelaunch.ts";
import { directTemplateResearchContext } from "./direct-template-research.ts";
import { DIRECT_PREPARATION_RULES } from "./direct-preparation-check.ts";
import { CAMPAIGN_OPTIMIZATION_VERSION, campaignOptimizationInstructions } from "./campaign-optimization.ts";
import { CAMPAIGN_REFINEMENT_VERSION, campaignCritiqueSchema, campaignRefinementInstructions, type CampaignRefinementState, type CampaignCritique } from "./campaign-refinement.ts";

export const CODEX_ACTOR = { actor_id: "codex", actor_type: "AGENT", role: "SINGLE_CODEX" } as const;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export type PipelineToolInput = {
  campaign_refinement_version?: typeof CAMPAIGN_REFINEMENT_VERSION;
  campaign_refinement?: CampaignRefinementState;
  previous_campaign_draft?: import("./campaign-formation-portfolio.ts").FormationPortfolio;
  refinement_research_requests?: CampaignCritique["issues"];
  repair_context?: { rejected_candidate: unknown; message: string; violations: unknown[] };
  saved_campaign_candidate?: { source_version: number; input_digest: string; candidate: import("./campaign-formation-portfolio.ts").FormationPortfolio; readiness: import("./goal-portfolio-analysis.ts").GoalPortfolioReadiness; saved_at: string };
  research_request?: string;
  keyword_preparation_version?: typeof KEYWORD_PREPARATION_VERSION;
  campaign_optimization_version?: typeof CAMPAIGN_OPTIMIZATION_VERSION;
  formation_method?: typeof CAMPAIGN_FORMATION_METHOD;
  goal_preparation_version?: GoalPreparationVersion;
  test_data_allowed?: boolean;
  run: PipelineRunState;
  view: ProductionHistoricalView;
  snapshot: Record<string, unknown> | null;
  interpretation: ProductionEvidenceInterpretation | null;
  strategy: ProductionStrategyArtifact | null;
  playbook: CampaignPlaybookStrategySnapshot;
  preparedAt: string;
};
export type PipelineStageTask = {
  schema_version: "p0-single-codex-task-v1";
  run_id: string;
  run_version: number;
  stage: Exclude<PipelineStageId, "CAMPAIGN_GOAL">;
  input_digest: string;
  source: PipelineToolInput;
  context: Record<string, unknown>;
  output_schema: Record<string, unknown>;
};

export async function artifactReference(value: Record<string, unknown>): Promise<PipelineVersionReference> {
  const schema = String(value.schema_version ?? "");
  const revision = String(value.snapshot_id ?? value.strategy_revision_id ?? record(value.strategy).strategy_revision_id ?? "");
  if (!schema || !revision) throw new Error("Отсутствует версия результата этапа.");
  return { schema_version: schema, revision_id: revision, digest: await pipelineDigest(value) };
}
async function toolSchemaReference(name: string, schema: unknown): Promise<PipelineVersionReference> {
  return { schema_version: `${name}-v1`, revision_id: "1.0.0", digest: await pipelineDigest(schema) };
}
function goalReference(input: PipelineToolInput) {
  if (input.run.goal_formation.status !== "VERIFIED") throw new Error("Сначала сохраните проверенную цель.");
  const goal = input.run.goal_formation.revision;
  return { schema_version: goal.schema_version, revision_id: goal.goal_revision_id, digest: goal.digest };
}
async function campaignInput(input: PipelineToolInput) {
  if (!input.snapshot || !input.strategy) throw new Error("Отсутствуют принятые сведения или стратегия.");
  if (input.run.goal_formation.status !== "VERIFIED") throw new Error("Цель не проверена.");
  const seed = { schema_version: "campaign-pair-set-v1", pairs: input.run.input_versions.campaign_pairs, validation: input.run.input_versions.campaign_pair_checks };
  const digest = await pipelineDigest(seed);
  return {
    run: input.run, view: input.view, autonomousStrategy: input.strategy.strategy,
    strategy: await artifactReference((input.strategy.formation_plan ? input.strategy : input.strategy.strategy) as unknown as Record<string, unknown>),
    evidence: await artifactReference(input.snapshot), evidenceSnapshot: input.snapshot,
    evidenceInterpretation: input.interpretation ?? undefined,
    pairSet: { schema_version: seed.schema_version, revision_id: `campaign-pair-set:${digest.slice(7, 39)}`, digest },
    now: () => input.preparedAt, allowedEvidenceIds: evidenceIndex(input.snapshot),
    trustedBusinessValues: strategyPlanningInput(input.view, input.run.goal_formation.revision, input.formation_method === CAMPAIGN_FORMATION_METHOD).locked,
  };
}

const boundedString = (maximum: number) => ({ type: "string", minLength: 1, maxLength: maximum });
export async function preparePipelineStageTask(input: PipelineToolInput): Promise<PipelineStageTask> {
  const goal = goalReference(input);
  const stage = input.run.current_stage;
  const goalDirected = !!input.goal_preparation_version && GOAL_PREPARATION_VERSIONS.includes(input.goal_preparation_version);
  if (goalDirected && stage === "CAMPAIGNS" && !input.strategy?.formation_plan?.goal_preparation) throw new Error("Для нового запуска требуется обоснованный выбор стратегии под цель.");
  if (stage === "CAMPAIGN_GOAL" || input.run.status !== "ACTIVE") throw new Error("Нет активного этапа для решения Codex.");
  let context: Record<string, unknown>;
  let outputSchema: Record<string, unknown>;
  if (stage === "EVIDENCE_COLLECTION") {
    const projection = input.snapshot ? evidenceProjection(input.snapshot) : null;
    const refs = { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", enum: projection?.evidence_ids ?? [] } };
    context = { goal: input.run.goal_formation, evidence: projection, collection_required: !input.snapshot };
    outputSchema = {
      type: "object", additionalProperties: false, required: ["summary", "findings", "evidence_refs", "gap_refs"],
      properties: {
        summary: boundedString(2000), evidence_refs: refs,
        gap_refs: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", enum: projection?.gap_ids ?? [] } },
        findings: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false,
          required: ["implication", "finding", "evidence_refs"], properties: {
            implication: { type: "string", enum: ["OFFER", "AUDIENCE", "INTENT", "MESSAGE", "LANDING", "MEASUREMENT", "EXCLUSION"] },
            finding: boundedString(1000), evidence_refs: { ...refs, maxItems: 10 },
          } } },
      },
    };
  } else if (stage === "STRATEGY") {
    if (!input.snapshot || !input.interpretation || input.run.goal_formation.status !== "VERIFIED") throw new Error("Сведения и их анализ ещё не приняты.");
    const inputs = await strategyInputs(input.view, goal, input.run.goal_formation.revision, await artifactReference(input.snapshot), input.snapshot, async () => input.playbook, input.interpretation, input.formation_method === CAMPAIGN_FORMATION_METHOD, input.goal_preparation_version === GOAL_OUTCOME_PREPARATION_VERSION);
    const refs = [...evidenceRefMap(inputs).keys()];
    context = { inputs, canonical_dimensions: CAMPAIGN_STRATEGY_DIMENSIONS, evidence_reference_ids: refs };
    outputSchema = { type: "object", additionalProperties: false, required: ["dimensions", "rationale", "confidence"], properties: {
      dimensions: { type: "array", minItems: 12, maxItems: 12, items: { type: "object", additionalProperties: false,
        required: ["dimension_id", "value", "rationale", "confidence", "evidence_refs"], properties: {
          dimension_id: { type: "string", enum: CAMPAIGN_STRATEGY_DIMENSIONS }, value: { description: "Business value: string, positive integer, period object, or null for target_result_cost." },
          rationale: boundedString(2000), confidence: { enum: ["HIGH", "MEDIUM", "LOW"] },
          evidence_refs: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: { type: "string", enum: refs } },
        } } }, rationale: boundedString(2000), confidence: { enum: ["HIGH", "MEDIUM", "LOW"] },
    } };
  } else {
    const prepared = input.formation_method === CAMPAIGN_FORMATION_METHOD && input.strategy?.formation_plan && input.interpretation?.formation_research
      ? await prepareFormationPortfolio(await campaignInput(input), input.strategy.formation_plan, input.interpretation.formation_research, input.campaign_optimization_version === CAMPAIGN_OPTIMIZATION_VERSION, input.keyword_preparation_version === KEYWORD_PREPARATION_VERSION)
      : await prepareCampaignPortfolio(await campaignInput(input));
    context = prepared.context;
    outputSchema = prepared.toolSchema;
  }
  if (input.formation_method === CAMPAIGN_FORMATION_METHOD) {
    context = { ...context, working_method: formationInstructions(stage), test_data_allowed: input.test_data_allowed === true, research_request: input.research_request ?? null };
    if (input.repair_context) context.repair_context = structuredClone(input.repair_context);
    if (input.keyword_preparation_version === KEYWORD_PREPARATION_VERSION) context.keyword_preparation = keywordPreparationInstructions();
    if (input.campaign_optimization_version === CAMPAIGN_OPTIMIZATION_VERSION) context.campaign_optimization = campaignOptimizationInstructions(stage);
    if (input.campaign_refinement_version === CAMPAIGN_REFINEMENT_VERSION) {
      context.campaign_refinement = campaignRefinementInstructions(input.campaign_refinement);
      if (stage === "CAMPAIGNS" && input.campaign_refinement?.phase === "REVIEW") {
        context.saved_draft = input.campaign_refinement.draft;
        context.saved_draft_digest = input.campaign_refinement.draft_digest;
        outputSchema = campaignCritiqueSchema();
      }
    }
    if (goalDirected) context.goal_preparation = { version: input.goal_preparation_version, instructions: goalPreparationInstructions(), exact_goal: input.run.goal_formation };
    if (input.goal_preparation_version === GOAL_OUTCOME_PREPARATION_VERSION && input.run.goal_formation.status === "VERIFIED") {
      const metric = goalMeasurement(input.run.goal_formation.revision), prelaunch = goalPrelaunchInstructions(metric);
      context.goal_prelaunch = { ...prelaunch, exact_metric: metric };
      context.goal_preparation = { version: input.goal_preparation_version, exact_goal: input.run.goal_formation, instructions: {
        ...goalPreparationInstructions(),
        objective: "Choose the strongest supported route to the exact owner metric, threshold, comparison, accounting definition, geography, deadline and total budget. Inspect the declared family; paid orders, money and proportions retain their own meaning. Do not convert a money target into a lead count or a scenario into a probability.",
        efficiency: "First assess support for every owner goal constraint together, then minimize spending among comparably supported feasible plans. Total budget is a ceiling. Compare a lower-spend alternative, preserve the unallocated remainder, and keep differences in support explicit. A fixed-budget monetary or proportion projection must be reassessed when its allocation changes; do not scale it automatically. An upper-bound goal still requires the owner's activity scope and, for proportions, minimum denominator volume.",
        cold_start: "Complete the permitted investigation and repair of the buyer, offer, goal-specific action, landing, measurement, alternatives, overlap, timing and capacity. Unknown performance stays unknown. Preserve a bounded observation plan for the exact owner metric; completed prelaunch preparation does not establish measured outcome or authority to publish. Respect explicit owner statements that historical data are unavailable and avoid repeating unsuccessful collection without a decision-relevant reason.",
        forecast: prelaunch.forecast, strategy: prelaunch.strategy, review: prelaunch.completion,
      } };
    }
    const materials = record(record(input.snapshot).business_research).supporting_materials;
    context.direct_campaign_research = (Array.isArray(materials) ? materials : []).map(m => directTemplateResearchContext(record(m).content)).filter(Boolean);
    context.history_research_rule = "Use available API campaign structures, exact goal definitions and query outcomes as scoped references. If history would change the portfolio, use read-direct and attach-direct, import the complete updated source snapshot through the UI, then obtain new task materials. Do not infer qualified effectiveness from a platform form conversion or turn observed pay-per-conversion billing into a free-click forecast.";
    if (stage === "EVIDENCE_COLLECTION") {
      const projection = input.snapshot ? evidenceProjection(input.snapshot) : null;
      const refs = input.snapshot ? evidenceIndex(input.snapshot) : [];
      const gaps = input.snapshot && Array.isArray(input.snapshot.gaps) ? [...new Set(input.snapshot.gaps.map(g => String(record(g).gap_id)).filter(Boolean))] : [];
      context.evidence = projection ? { ...projection, evidence_ids: refs, gap_ids: gaps, complete_corpus: "source.snapshot" } : null;
      if (input.refinement_research_requests?.length) context.required_refinement_findings = input.refinement_research_requests.map(issue => ({ finding_id: `refinement:${issue.id}`, question: issue.problem, required_resolution: issue.required_change, rule: "Add this exact finding ID to research.findings and its coverage area. Answer the question with observed/inferred evidence or explicit unavailable/conflicting state and decision consequences. Returning upstream does not itself resolve the issue." }));
      outputSchema = formationResearchSchema(refs, gaps, input.goal_preparation_version === GOAL_OUTCOME_PREPARATION_VERSION, input.keyword_preparation_version === KEYWORD_PREPARATION_VERSION);
    } else if (stage === "STRATEGY") {
      context.direct_preparation_rules = DIRECT_PREPARATION_RULES;
      context.formation_research = input.interpretation?.formation_research;
      // Unversioned in-flight work keeps its frozen goal semantics; new runs carry an explicit version.
      const preparationVersion = input.goal_preparation_version ?? (goalTotalBudgetRub(input.run.goal_formation.status === "VERIFIED" ? input.run.goal_formation.revision.success_criterion : null) === null ? LEGACY_GOAL_PREPARATION_VERSION : GOAL_PREPARATION_VERSION);
      outputSchema = { ...outputSchema, required: [...outputSchema.required as string[], "formation_plan"], properties: { ...record(outputSchema.properties), formation_plan: formationPlanSchema(context.evidence_reference_ids as string[], goalDirected, preparationVersion) } };
    } else if (!input.strategy?.formation_plan || !input.interpretation?.formation_research) throw new Error("Для нового метода требуется полный анализ исследования и план формирования кампаний.");
  }
  const body = { schema_version: "p0-single-codex-task-v1" as const, run_id: input.run.run_id, run_version: input.run.version,
    stage, source: structuredClone(input), context, output_schema: outputSchema };
  return { ...body, input_digest: await pipelineDigest(body) };
}

async function compileEvidence(input: PipelineToolInput, candidate: unknown, context: PipelineStageTask): Promise<ProductionStageAgentResult> {
  let formationResearch: FormationResearch | undefined;
  if (input.formation_method === CAMPAIGN_FORMATION_METHOD) {
    const violations = validateFormationShape(context.output_schema, candidate);
    if (violations.length) formationError(violations);
    formationResearch = record(candidate).research as FormationResearch;
    verifyFormationResearch(formationResearch);
    if (input.keyword_preparation_version === KEYWORD_PREPARATION_VERSION) {
      const issues = verifyKeywordResearch(formationResearch);
      if (issues.length) formationError(issues);
    }
    if (input.goal_preparation_version === GOAL_OUTCOME_PREPARATION_VERSION && input.run.goal_formation.status === "VERIFIED") {
      const requirementsIssues = verifyGoalRequirements(formationResearch, input.run.goal_formation.revision);
      if (requirementsIssues.length) formationError(requirementsIssues);
    }
    const unanswered = input.refinement_research_requests?.filter(issue => !formationResearch!.findings.some(f => f.id === `refinement:${issue.id}`)) ?? [];
    if (unanswered.length) formationError(unanswered.map(issue => ({ code: "REFINEMENT_RESEARCH_UNANSWERED", pointer: "/research/findings", message: `Ответьте на вопрос из разбора объявлений отдельным выводом refinement:${issue.id}: ${issue.problem}` })));
    if (formationResearch.mode === "TEST_SCENARIO" && input.test_data_allowed !== true) formationError([{ code: "TEST_DATA_NOT_AUTHORIZED", pointer: "/research/mode", message: "Тестовые подстановки не разрешены для этого запуска." }]);
    const original = record(candidate);
    const implications: Record<string, string> = { offer: "OFFER", buyers: "AUDIENCE", objections: "MESSAGE", formats_and_calendar: "OFFER", competitors: "MESSAGE", contractor_cases: "MESSAGE", demand: "INTENT", landing: "LANDING", measurement: "MEASUREMENT", economics: "MEASUREMENT" };
    candidate = { summary: original.summary, evidence_refs: original.evidence_refs, gap_refs: original.gap_refs,
      findings: formationResearch.findings.filter(f => f.evidence_refs.length).map(f => ({ implication: implications[f.area], finding: f.finding, evidence_refs: f.evidence_refs })) };
  }
  const snapshot = input.snapshot;
  if (!snapshot || !await verifyAnalyticsEvidenceSnapshot(snapshot)) throw new Error("Сначала соберите и проверьте источники.");
  const goal = goalReference(input);
  if (Object.hasOwn(snapshot, "goal_context")) await verifyGoalEvidenceScope({ goal, goalRevision: snapshot.goal_context as never });
  const evidence = await artifactReference(snapshot);
  const projection = evidenceProjection(snapshot);
      const implications = ["OFFER", "AUDIENCE", "INTENT", "MESSAGE", "LANDING", "MEASUREMENT", "EXCLUSION"];
      const allowed = new Set(formationResearch ? evidenceIndex(snapshot) : projection.evidence_ids);
      const allowedGaps = new Set(formationResearch && Array.isArray(snapshot.gaps) ? snapshot.gaps.map(g => String(record(g).gap_id)).filter(Boolean) : projection.gap_ids);
      type Violation = { code: string; pointer: string; message: string };
      const validate = (value: unknown): Violation[] => {
        const violations: Violation[] = [];
        const add = (code: string, pointer: string, message: string) => violations.push({ code, pointer, message });
        const shape = (value: unknown, keys: string[], pointer: string) => {
          if (!value || typeof value !== "object" || Array.isArray(value)
            || JSON.stringify(Object.keys(record(value)).sort()) !== JSON.stringify([...keys].sort())) {
            add("EVIDENCE_ANALYSIS_SHAPE_INVALID", pointer, `Return exactly these fields: ${keys.join(", ")}.`);
          }
        };
        const refs = (value: unknown, allowedValues: Set<string>, minimum: number, maximum: number, pointer: string) => {
          if (!Array.isArray(value)) {
            add("EVIDENCE_ANALYSIS_REFS_INVALID", pointer, "References must be an array of exact published string identifiers.");
            return;
          }
          if (value.length < minimum || value.length > maximum) add("EVIDENCE_ANALYSIS_REF_COUNT_INVALID", pointer, `Select ${minimum}-${maximum} published references; use [] when no gaps are published.`);
          if (new Set(value).size !== value.length) add("EVIDENCE_ANALYSIS_DUPLICATE_REF", pointer, "Every reference must occur exactly once.");
          value.forEach((ref, index) => {
            if (typeof ref !== "string" || !allowedValues.has(ref)) add("EVIDENCE_ANALYSIS_REF_UNKNOWN", `${pointer}/${index}`, "Use an exact evidence_ids or gap_catalog identifier from this unchanged input; descriptions and new IDs are not references.");
          });
        };
        const boundedText = (value: unknown, maximum: number, pointer: string) => {
          if (typeof value !== "string" || !value.trim() || value.length > maximum) add("EVIDENCE_ANALYSIS_TEXT_INVALID", pointer, `Supply nonempty text of at most ${maximum} characters; overlong findings are rejected, not shortened.`);
        };
        shape(value, ["summary", "findings", "evidence_refs", "gap_refs"], "/");
        const result = record(value);
        boundedText(result.summary, formationResearch ? 4000 : 2000, "/summary");
        refs(result.evidence_refs, allowed, 1, formationResearch ? 500 : 100, "/evidence_refs");
        refs(result.gap_refs, allowedGaps, 0, Math.min(formationResearch ? 500 : 100, allowedGaps.size), "/gap_refs");
        if (!Array.isArray(result.findings)) add("EVIDENCE_ANALYSIS_FINDINGS_INVALID", "/findings", "Findings must be an array; use [] when the snapshot supports no concrete implication.");
        else {
          if (result.findings.length > (formationResearch ? 500 : 16)) add("EVIDENCE_ANALYSIS_FINDING_COUNT_INVALID", "/findings", "Превышен размер пакета выводов.");
          const seenFindings = new Set<string>();
          result.findings.forEach((value, index) => {
            const pointer = `/findings/${index}`;
            shape(value, ["implication", "finding", "evidence_refs"], pointer);
            const finding = record(value);
            if (typeof finding.implication !== "string" || !implications.includes(finding.implication)) add("EVIDENCE_ANALYSIS_IMPLICATION_INVALID", `${pointer}/implication`, `Select one of: ${implications.join(", ")}.`);
            boundedText(finding.finding, formationResearch ? 2000 : 1000, `${pointer}/finding`);
            refs(finding.evidence_refs, allowed, 1, formationResearch ? 500 : 10, `${pointer}/evidence_refs`);
            const identity = JSON.stringify([finding.implication, typeof finding.finding === "string" ? finding.finding.trim() : finding.finding]);
            if (seenFindings.has(identity)) add("EVIDENCE_ANALYSIS_DUPLICATE_FINDING", pointer, "Do not repeat the same implication and finding under different references.");
            seenFindings.add(identity);
          });
        }
        return violations;
      };

  const violations = validate(candidate);
  if (violations.length) throw Object.assign(new Error("Анализ сведений не прошёл проверку."), { code: "EVIDENCE_ANALYSIS_INVALID", violations });
  const result = record(candidate);
        const findings = result.findings as Array<Record<string, import("./p0-agent-runtime.ts").JsonValue>>;
        const interpretation: ProductionEvidenceInterpretation = {
          ...(formationResearch ? { formation_research: structuredClone(formationResearch) } : {}),
          schema_version: "p0-evidence-stage-interpretation-v1",
          source_snapshot: structuredClone(evidence),
          decision_support: buildFindingsReport(snapshot),
          summary: (result.summary as string).trim(),
          findings: findings.map((item) => ({
            implication: item.implication as ProductionEvidenceInterpretation["findings"][number]["implication"],
            finding: (item.finding as string).trim(), evidence_refs: [...item.evidence_refs as string[]],
          })),
          evidence_refs: [...result.evidence_refs as string[]],
          gap_refs: [...result.gap_refs as string[]],
        };
        return {
          actor: CODEX_ACTOR,
          output: structuredClone(evidence),
          artifact: structuredClone(snapshot),
          evidence: [structuredClone(goal), structuredClone(evidence)],
          check_id: "EVIDENCE_ANALYST_SNAPSHOT_INTERPRETATION_VERIFIED",
          schema: await toolSchemaReference("p0-evidence-interpretation", context.output_schema),
          summary: interpretation.summary,
          interpretation,
        };
}

export async function compilePipelineStageTask(task: PipelineStageTask, candidate: unknown): Promise<{ product: PipelineVerifiedProduct; attempt: PipelineVerifiedAttempt; summary: string }> {
  const { input_digest: expected, ...body } = task;
  if (expected !== await pipelineDigest(body)) throw new Error("Входные данные этапа изменились.");
  const input = task.source;
  const fresh = await preparePipelineStageTask(input);
  if (fresh.input_digest !== expected) throw new Error("Контракт этапа изменился. Получите входные данные заново.");
  let result: ProductionStageAgentResult<unknown>;
  let product: PipelineVerifiedProduct;
  if (task.stage === "EVIDENCE_COLLECTION") {
    result = await compileEvidence(input, candidate, task);
    product = { stage: task.stage, value: result.artifact as Record<string, unknown>, interpretation: result.interpretation,
      researchScopeDigest: await pipelineEvidenceResearchScope({ versions: input.run.input_versions, state: input.view.state }) };
  } else if (task.stage === "STRATEGY") {
    let raw = record(candidate);
    let formationPlan: FormationPlan | undefined;
    if (input.formation_method === CAMPAIGN_FORMATION_METHOD) {
      const planSchema = record(record(task.output_schema.properties).formation_plan);
      const violations = validateFormationShape(planSchema, raw.formation_plan, "/formation_plan");
      if (violations.length) formationError(violations);
      formationPlan = raw.formation_plan as FormationPlan;
      const { formation_plan: ignored, ...rest } = raw;
      void ignored; raw = rest;
    }
    if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(["confidence", "dimensions", "rationale"]) || !Array.isArray(raw.dimensions)) throw new Error("Неверная структура стратегии.");
    const inputs = task.context.inputs as CampaignStrategyAgentInput;
    const refs = evidenceRefMap(inputs);
    const dimensions = raw.dimensions.map((value) => {
      const dimension = record(value);
      if (!Array.isArray(dimension.evidence_refs) || !dimension.evidence_refs.length || dimension.evidence_refs.length > 8
        || new Set(dimension.evidence_refs).size !== dimension.evidence_refs.length
        || dimension.evidence_refs.some(ref => typeof ref !== "string" || !refs.has(ref))) throw new Error("Стратегия ссылается на неизвестные или повторяющиеся источники.");
      return { ...dimension, evidence_refs: dimension.evidence_refs.map(ref => refs.get(String(ref))) };
    });
    if (input.run.goal_formation.status !== "VERIFIED" || !input.snapshot) throw new Error("Нет проверенной цели или сведений.");
    const goal = input.run.goal_formation.revision;
    const planning = strategyPlanningInput(input.view, goal, input.formation_method === CAMPAIGN_FORMATION_METHOD);
    const strategy = await compileCampaignStrategy({ inputs, proposal: { ...raw, dimensions, conflicts: [] }, acceptedAt: input.preparedAt,
      validateContent: proposal => [
        ...validateCampaignStrategyGrounding({ proposal, trustedBusinessValues: planning.locked, evidenceSnapshot: input.snapshot! }).map(v => ({ code: v.code, path: v.pointer, message: v.message })),
        ...proposal.dimensions.flatMap((dimension, index) => {
          const priority = planning.locked[dimension.dimension_id];
          if (dimension.dimension_id === "target_result_cost" && Number(dimension.value) > Number(goalResultCostCeiling(goal.success_criterion))) return [{ code: "STRATEGY_TARGET_COST_EXCEEDS_GOAL", path: `/dimensions/${index}/value`, message: "Целевая стоимость превышает бюджет на нужное количество результатов." }];
          return hasPriorityMaterialValue(priority) && !sameMaterialValue(dimension.value, priority)
            ? [{ code: "STRATEGY_PRIORITY_CONSTRAINT_CHANGED", path: `/dimensions/${index}/value`, message: `Изменено бизнес-ограничение ${dimension.dimension_id}.` }] : [];
        }),
      ],
    });
    if (formationPlan) {
      const values = Object.fromEntries(strategy.dimensions.map(d => [d.dimension_id, d.value]));
      verifyFormationPlan(formationPlan, input.interpretation!.formation_research!, Number(values.weekly_budget), String(values.landing_page), String(values.qualified_result));
      const totalBudget = goalTotalBudgetRub(goal.success_criterion);
      if (totalBudget !== null && (formationPlan.budget.total_cap_rub > totalBudget || Number(values.weekly_budget) > totalBudget)) formationError([{ code: "GOAL_TOTAL_BUDGET_EXCEEDED", pointer: "/formation_plan/budget", message: "Общий или недельный бюджет кампаний превышает весь бюджет цели." }]);
      if (formationPlan.goal_preparation) {
        const violations = verifyGoalPreparation(formationPlan.goal_preparation, formationPlan, goal, values.period as { start_date: string; end_date: string }, input.interpretation!.formation_research);
        if (violations.length) formationError(violations);
      }
    }
    const artifact: ProductionStrategyArtifact = { schema_version: formationPlan ? "p0-formation-strategy-product-v1" : "p0-strategy-stage-product-v1", strategy, inputs, ...(formationPlan ? { formation_plan: formationPlan } : {}) };
    result = { actor: CODEX_ACTOR, output: await artifactReference((formationPlan ? artifact : strategy) as unknown as Record<string, unknown>), artifact,
      evidence: [goalReference(input), await artifactReference(input.snapshot)], check_id: "CODEX_STRATEGY_VERIFIED",
      schema: await toolSchemaReference("p0-codex-strategy", task.output_schema), summary: strategy.rationale };
    product = { stage: task.stage, value: artifact as unknown as Record<string, unknown> };
  } else {
    result = input.formation_method === CAMPAIGN_FORMATION_METHOD
      ? await compileFormationPortfolio(await campaignInput(input), candidate, input.strategy!.formation_plan!, input.interpretation!.formation_research!, input.campaign_optimization_version === CAMPAIGN_OPTIMIZATION_VERSION, input.keyword_preparation_version === KEYWORD_PREPARATION_VERSION)
      : await compileCampaignPortfolio(await campaignInput(input), candidate);
    product = { stage: task.stage, value: result.artifact as Record<string, unknown>[] };
  }
  return { product, summary: result.summary, attempt: {
    actor: CODEX_ACTOR, inputs: [goalReference(input), ...result.evidence], evidence: result.evidence,
    output: result.output, checks: [{ check_id: result.check_id, status: "PASSED", policy: input.run.input_versions.pipeline_policy }],
    schemas: [result.schema], policies: [input.run.input_versions.pipeline_policy], campaign_playbook: input.run.input_versions.campaign_playbook,
  } };
}
