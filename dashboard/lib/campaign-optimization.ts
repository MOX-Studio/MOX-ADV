import { formArray, formEnum, formId, formIds, formObject, formRefs, formText, type FormationPlan, type FormationResearch, type FormationViolation } from "./campaign-formation-method.ts";
import type { FormationPortfolio } from "./campaign-formation-portfolio.ts";

export const CAMPAIGN_OPTIMIZATION_VERSION = "goal-campaign-optimization-v1";
export const OPTIMIZATION_PARAMETERS = ["AUDIENCE_AND_INTENT", "OFFER_AND_COPY", "CREATIVE", "LANDING_AND_QUALIFICATION", "DELIVERY", "BUDGET_AND_TIMING"] as const;
type Parameter = typeof OPTIMIZATION_PARAMETERS[number];
export type CampaignOptimizationReview = {
  version: typeof CAMPAIGN_OPTIMIZATION_VERSION;
  goal_revision_id: string;
  basis: "PRELAUNCH_JUDGMENT";
  groups: Array<{ group_id: string; strongest_counterargument: string; selection_reason: string;
    parameters: Array<{ parameter: Parameter; selected_value_json: string; decision: "COMPARED" | "HELD"; reason: string; finding_ids: string[];
      alternatives: Array<{ label: string; value_json: string; expected_advantage: string; principal_risk: string; rejection_reason: string; finding_ids: string[] }> }> }>;
  issues: Array<{ id: string; kind: "PREPARATION_DEFECT" | "PERFORMANCE_UNKNOWN"; status: "OPEN" | "REPAIRED" | "ACCEPTED_LIMITATION";
    finding: string; action: string; affected_ids: string[]; evidence_refs: string[];
    repair: { group_id: string; parameter: Parameter; before_value_json: string; after_value_json: string } | null }>;
  stopping_reason: string;
};

// The enclosing task transport bounds resources; this must not become an ad-count quota.
const jsonText = () => ({ type: "string", minLength: 1 });
export function campaignOptimizationSchema(refs: string[]) {
  return formObject({ version: formEnum([CAMPAIGN_OPTIMIZATION_VERSION]), goal_revision_id: formText(255), basis: formEnum(["PRELAUNCH_JUDGMENT"]),
    groups: formArray(formObject({ group_id: formId(), strongest_counterargument: formText(), selection_reason: formText(),
      parameters: formArray(formObject({ parameter: formEnum(OPTIMIZATION_PARAMETERS), selected_value_json: jsonText(), decision: formEnum(["COMPARED", "HELD"]), reason: formText(), finding_ids: formIds(null, 1),
        alternatives: formArray(formObject({ label: formText(255), value_json: jsonText(), expected_advantage: formText(), principal_risk: formText(), rejection_reason: formText(), finding_ids: formIds(null, 1) })) }), OPTIMIZATION_PARAMETERS.length, OPTIMIZATION_PARAMETERS.length) }), null, 1),
    issues: formArray(formObject({ id: formId(), kind: formEnum(["PREPARATION_DEFECT", "PERFORMANCE_UNKNOWN"]), status: formEnum(["OPEN", "REPAIRED", "ACCEPTED_LIMITATION"]), finding: formText(), action: formText(), affected_ids: formIds(null, 1), evidence_refs: formRefs(refs),
      repair: { ...formObject({ group_id: formId(), parameter: formEnum(OPTIMIZATION_PARAMETERS), before_value_json: jsonText(), after_value_json: jsonText() }), type: ["object", "null"] } })),
    stopping_reason: formText(4000) });
}

/** Concrete values to inspect. This projection never chooses an alternative or rates persuasion. */
export function campaignOptimizationParameters(plan: FormationPlan, portfolio: FormationPortfolio) {
  return portfolio.campaigns.flatMap(c => c.groups.map(g => {
    const direction = plan.directions.find(d => d.id === c.direction_id);
    const values: Record<Parameter, unknown> = {
      AUDIENCE_AND_INTENT: { channel: c.channel, audience: direction?.audience ?? null, intent: g.intent, keywords: g.keywords.map(k => k.phrase), themes: g.themes, include_segments: g.include_segments, exclude_segments: g.exclude_segments, campaign_exclude_segments: c.exclude_segments, negative_keywords: g.negative_keywords, campaign_negative_keywords: c.negative_keywords, segments: portfolio.segments.filter(s => [...g.include_segments, ...g.exclude_segments, ...c.exclude_segments].includes(s.id)) },
      OFFER_AND_COPY: { offer: direction?.offer ?? null, message: direction?.message ?? null, ads: g.ads.map(a => ({ id: a.id, titles: a.titles, texts: a.texts, source_refs: a.source_refs })) },
      CREATIVE: { ads: g.ads.map(a => ({ id: a.id, image_ids: a.image_ids, extensions: a.extensions ?? null })), images: portfolio.images.filter(i => g.ads.some(a => a.image_ids.includes(i.id))) },
      LANDING_AND_QUALIFICATION: { ads: g.ads.map(a => ({ id: a.id, url: a.url })), landing: plan.landing, measurement: plan.measurement },
      DELIVERY: { bidding: c.bidding, autotargeting: c.autotargeting, activation_condition: c.activation_condition, direction_activation_condition: direction?.activation_condition ?? null },
      BUDGET_AND_TIMING: { goal: plan.goal_preparation?.goal ?? null, period: plan.goal_preparation?.forecast.period ?? null, weekly_budget_rub: c.weekly_budget_rub, campaign_allocations: c.allocations, group_allocations: g.allocations, budget: plan.budget, ad_validity: g.ads.map(a => ({ id: a.id, valid_until: a.valid_until })) },
    };
    return { group_id: g.id, parameters: OPTIMIZATION_PARAMETERS.map(parameter => ({ parameter, selected_value_json: JSON.stringify(values[parameter]) })) };
  }));
}

const canonical = (value: unknown): string => JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonical(v))])) : value);
const parsed = (value: string): unknown => JSON.parse(value);
const equalJson = (a: string, b: string) => canonical(parsed(a)) === canonical(parsed(b));
const exact = (a: string[], b: readonly string[]) => a.length === b.length && new Set(a).size === a.length && b.every(id => a.includes(id));

/** Enforces review coverage, unchanged decisions and actual repairs; semantic judgment stays with Codex. */
export function verifyCampaignOptimization(plan: FormationPlan, research: FormationResearch, portfolio: FormationPortfolio): FormationViolation[] {
  const review = portfolio.optimization_review;
  if (!review) return [];
  const violations: FormationViolation[] = [];
  const add = (code: string, message: string) => violations.push({ code, pointer: "/optimization_review", message });
  const actual = campaignOptimizationParameters(plan, portfolio), findingIds = new Set(research.findings.map(f => f.id));
  const currentValue = (groupId: string, parameter: Parameter) => actual.find(g => g.group_id === groupId)?.parameters.find(p => p.parameter === parameter)?.selected_value_json;
  const compare = (a: string, b: string) => { try { return equalJson(a, b); } catch { add("OPTIMIZATION_VALUE_INVALID", "Сравниваемые значения должны содержать корректный JSON."); return false; } };
  if (review.goal_revision_id !== plan.goal_preparation?.goal.revision_id) add("OPTIMIZATION_GOAL_CHANGED", "Выбор объявлений должен относиться к точной цели текущего запуска.");
  if (!exact(review.groups.map(g => g.group_id), actual.map(g => g.group_id))) add("OPTIMIZATION_GROUP_MISSING", "Проверьте параметры и сильнейшее возражение для каждой фактической группы.");
  const checkFindings = (ids: string[]) => { if (!ids.length || ids.some(id => !findingIds.has(id))) add("OPTIMIZATION_FINDING_UNKNOWN", "Основание выбора должно ссылаться на выводы принятого исследования."); };
  for (const group of review.groups) {
    if (!exact(group.parameters.map(p => p.parameter), OPTIMIZATION_PARAMETERS)) add("OPTIMIZATION_PARAMETER_MISSING", "Рассмотрите аудиторию, предложение и текст, оформление, посадочную, показ, бюджет и сроки.");
    for (const row of group.parameters) {
      checkFindings(row.finding_ids);
      const expected = currentValue(group.group_id, row.parameter);
      if (!expected || !compare(row.selected_value_json, expected)) add("OPTIMIZATION_SELECTION_CHANGED", "Фактические объявления или настройки изменились после сравнения. Пересмотрите затронутый выбор.");
      if (row.decision === "HELD" ? row.alternatives.length !== 0 : row.alternatives.length === 0) add("OPTIMIZATION_COMPARISON_EMPTY", "Для сравнения нужны конкретные альтернативы; для сохранённого параметра — причина без фиктивных вариантов.");
      const signatures: string[] = [];
      for (const alternative of row.alternatives) {
        checkFindings(alternative.finding_ids);
        if (compare(row.selected_value_json, alternative.value_json)) add("OPTIMIZATION_ALTERNATIVE_IDENTICAL", "Альтернатива должна менять конкретное значение, а не только объяснение.");
        try {
          const value = parsed(alternative.value_json), selected = parsed(row.selected_value_json);
          if (!value || typeof value !== "object" || Array.isArray(value) || !selected || typeof selected !== "object" || !exact(Object.keys(value), Object.keys(selected))) add("OPTIMIZATION_ALTERNATIVE_INCOMPLETE", "Сравнивайте полный набор значений одного параметра в одинаковом формате.");
          signatures.push(canonical(value));
        } catch { add("OPTIMIZATION_VALUE_INVALID", "Сравниваемые значения должны содержать корректный JSON."); }
      }
      if (new Set(signatures).size !== signatures.length) add("OPTIMIZATION_ALTERNATIVE_DUPLICATE", "Повтор одного набора настроек не является дополнительным сравнением.");
    }
    if (group.parameters.find(p => p.parameter === "OFFER_AND_COPY")?.decision !== "COMPARED") add("OPTIMIZATION_COPY_NOT_COMPARED", "Сопоставьте фактические тексты с содержательной альтернативой под намерение группы.");
    const copyRow = group.parameters.find(p => p.parameter === "OFFER_AND_COPY");
    const rejected = portfolio.goal_review?.groups.find(g => g.group_id === group.group_id)?.candidates.filter(c => c.disposition === "REJECTED") ?? [];
    if (copyRow && !copyRow.alternatives.some(a => {
      try { const value = parsed(a.value_json) as { ads?: Array<{ titles: string[]; texts: string[]; source_refs: string[] }> }; return value.ads?.some(ad => rejected.some(c => canonical([ad.titles, ad.texts, ad.source_refs]) === canonical([c.titles, c.texts, c.source_refs]))); } catch { return false; }
    })) add("OPTIMIZATION_REJECTED_COPY_MISSING", "Сравнение должно содержать реальный отклонённый текст из итогового разбора объявлений.");
  }
  const targets = new Set(["portfolio", "landing", "measurement", "budget", ...portfolio.campaigns.flatMap(c => [c.id, ...c.groups.flatMap(g => [g.id, ...g.ads.map(a => a.id)])])]);
  if (new Set(review.issues.map(i => i.id)).size !== review.issues.length) add("OPTIMIZATION_ISSUE_DUPLICATE", "Замечания должны иметь уникальные идентификаторы.");
  for (const issue of review.issues) {
    if (issue.affected_ids.some(id => !targets.has(id))) add("OPTIMIZATION_ISSUE_TARGET_UNKNOWN", "Замечание должно относиться к фактическому объекту или условию плана.");
    if (issue.status === "OPEN" || (issue.kind === "PREPARATION_DEFECT" && issue.status !== "REPAIRED")) add("OPTIMIZATION_REWORK_REQUIRED", "Недостаток подготовки нужно устранить или вернуться к исследованию до завершения.");
    if (issue.kind === "PERFORMANCE_UNKNOWN" && issue.status !== "ACCEPTED_LIMITATION") add("OPTIMIZATION_FALSE_PERFORMANCE_REPAIR", "Неизвестную результативность нельзя объявить исправленной редактированием объявления.");
    if (issue.status === "REPAIRED") {
      const repair = issue.repair, after = repair && currentValue(repair.group_id, repair.parameter);
      if (!repair || !after || !compare(repair.after_value_json, after) || compare(repair.before_value_json, repair.after_value_json)) add("OPTIMIZATION_REPAIR_NOT_IMPLEMENTED", "Исправление должно менять конкретный параметр и совпадать с готовым результатом.");
      if (repair && after) {
        const campaign = portfolio.campaigns.find(c => c.groups.some(g => g.id === repair.group_id));
        const group = campaign?.groups.find(g => g.id === repair.group_id);
        const related = ["portfolio", "landing", "measurement", "budget", campaign?.id, group?.id, ...group?.ads.map(a => a.id) ?? []];
        if (!issue.affected_ids.some(id => related.includes(id))) add("OPTIMIZATION_REPAIR_UNRELATED", "Изменение должно исправлять затронутую кампанию, группу или объявление.");
        try {
          const before = parsed(repair.before_value_json);
          if (!before || typeof before !== "object" || Array.isArray(before) || !exact(Object.keys(before), Object.keys(parsed(after) as object))) add("OPTIMIZATION_REPAIR_INCOMPLETE", "Сохраните конкретные значения параметра до исправления в том же формате.");
        } catch { add("OPTIMIZATION_VALUE_INVALID", "Значения до исправления должны содержать корректный JSON."); }
      }
    } else if (issue.repair !== null) add("OPTIMIZATION_REPAIR_STATE_INVALID", "Не приписывайте изменение параметров принятому ограничению.");
  }
  return violations;
}

export function campaignOptimizationInstructions(stage: string) {
  return { version: CAMPAIGN_OPTIMIZATION_VERSION, stage,
    objective: "Create the ads and supporting campaign settings with the strongest evidence-supported prospect of attaining the exact owner Goal. Rank by qualified unique results within its region, deadline and total budget; minimize spending only among comparably credible plans. Do not optimize for copy count, clicks or CTR in place of that result.",
    autonomy: "You are the pipeline's persistent controlling agent. After Start, complete Evidence, Strategy and Campaigns without routine owner prompts. Read the next task after each accepted save. Investigate material gaps, compare feasible options, repair weaknesses and continue until a reviewed local portfolio is saved. No provider uploads, publication, spend or post-launch execution belongs to this preparation task.",
    search: "Research buyer intent, motives, objections, offer proof, competing approaches, landing qualification, attainable demand and applicable history. Explore meaningful parameter changes where they can change a decision. Keep a good shared headline or fixed setting when justified. Do not make A/B testing or arbitrary counts mandatory. Changing channel, offer, landing or budget outside the accepted strategy requires returning upstream and recompiling from fresh task materials.",
    review: "Before Campaigns submission, fill optimization_review for every actual group. Use optimization-inputs to inspect exact parameter values. For each parameter compare concrete alternatives or explain why it is held. Offer/copy comparison must include a real rejected candidate from goal_review. Record each alternative's strongest advantage, principal risk and why the selected value better serves Goal. Cover targeting, copy, images/extensions, landing/qualification, delivery and shared budget/timing. No unsupported success scores or fabricated performance winners: basis is PRELAUNCH_JUDGMENT. Record concise decision evidence, not private reasoning traces.",
    repair: "Challenge the strongest counterargument, fix preparation defects, and record actual before/after values linked to the final objects. OPEN defects cannot finish; unavailable performance is a limitation, never a defect repaired by new text. Changed final settings invalidate their earlier comparison. Refresh the affected decision after editing, not just its selected JSON. Validation feedback is a repair task, not a request for the owner to troubleshoot.",
    completion: "Stop when all material permitted prelaunch research and repairs are complete, every selected ad has a credible incremental role and further parameter search is unlikely to change a material choice. No history is a normal cold start: retain unknown performance and use the existing explicit local preparation decision. A compiled graph does not prove persuasive quality, live test superiority, or actual goal achievement.",
  };
}
