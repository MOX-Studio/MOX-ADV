import { GOAL_PREPARATION_VERSION, GOAL_REVIEW_AREAS } from "../../lib/campaign-goal-preparation.ts";
import { CAMPAIGN_OPPORTUNITY_AXES } from "../../lib/campaign-opportunity-search.ts";

export function goalPreparationFixture(plan, goal, refs, period) {
  const unknown = () => ({ range: null, basis: "UNKNOWN", evidence_refs: [], explanation: "Сопоставимых наблюдений квалифицированного обращения пока нет." });
  const candidates = [...plan.directions.map(d => ({ id: `candidate-${d.id}`, name: d.name, audience: d.audience, intent: d.intent, offer: d.offer, channel: d.channel, mechanism: `Участие через ${d.intent}`, added_value: "Отдельное намерение потенциального покупателя", disposition: "SELECTED", direction_id: d.id, reason: "Соответствует предложению", evidence_refs: refs.slice(0, 1) })),
    { id: "industry-opportunity", name: "Широкий отраслевой интерес", audience: "Посетители отраслевых ресурсов", intent: "Информация об отрасли", offer: "Участие со стендом", channel: "NETWORK", mechanism: "Привлечение из общего интереса", added_value: "Дополнительный охват", disposition: "DEFERRED", direction_id: null, reason: "Квалификация неизвестна; сначала явное намерение", evidence_refs: refs.slice(0, 1) }];
  const allocations = plan.directions.map((d, i) => ({ direction_id: d.id, budget_rub: i === 0 ? plan.budget.total_cap_rub - Math.floor(plan.budget.total_cap_rub / plan.directions.length) * (plan.directions.length - 1) : Math.floor(plan.budget.total_cap_rub / plan.directions.length) }));
  return { version: GOAL_PREPARATION_VERSION,
    goal: { revision_id: goal.goal_revision_id, qualified_result: goal.qualified_action, customer_geography: goal.customer_geography ?? "Россия", ...goal.success_criterion },
    portfolio_search: { axes: CAMPAIGN_OPPORTUNITY_AXES.map(axis => ({ axis, status: "RESEARCHED", finding_ids: ["F1"], candidate_ids: candidates.map(c => c.id), conclusion: "Изолированный пример проверки рассмотренных возможностей" })), candidates: candidates.map(c => ({ ...c, viability: { status: c.disposition === "SELECTED" ? "VIABLE" : "NEEDS_EVIDENCE", contribution: c.disposition === "SELECTED" ? "QUALIFIED_REACH" : "NONE", overlap_with: [], overlap_resolution: "Изолированный пример разных намерений", budget_and_deadline: "Выделенный лимит учитывается один раз в пределах срока", evidence_refs: refs.slice(0, 1) } })),
      investigations: [{ id: "research-cpc", metric: "CPC", question: "Какие расходы нужны для обращения?", decision_impact: "Выбор бюджета направлений", material: true, status: "UNAVAILABLE", candidate_ids: candidates.map(c => c.id), evidence_refs: [], outcome: "Сопоставимая история не получена", next_action: "Сохранить неопределённость прогноза" }],
      continuation: { first_candidate_id: candidates[0].id, considered_after_first: candidates.slice(1).map(c => c.id), additional_value: "Рассмотрен дополнительный отраслевой охват", stopping_reason: "Дополнительные варианты не имеют подтверждённого вклада при доступных данных", single_campaign_reason: plan.directions.length === 1 ? "После сравнения дополнительных вариантов бюджет сосредоточен на явном намерении" : null } },
    alternatives: [
      { id: "explicit", approach: "Явный запрос участия", audience: "Компании, выбирающие участие", offer: "Участие со стендом", mechanism: "Ответить на запрос условий и получить квалифицированное обращение", strongest_reason: "Запрос ближе к предмету предложения", principal_risk: "Объём спроса неизвестен", evidence_refs: refs.slice(0, 1) },
      { id: "industry", approach: "Отраслевой поиск", audience: "Интересующиеся оборудованием", offer: "Промышленная выставка", mechanism: "Предложить участие отраслевой аудитории", strongest_reason: "Возможен дополнительный охват", principal_risk: "Посетители не обязательно покупают участие", evidence_refs: refs.slice(0, 1) },
    ], selected_alternative_id: "explicit", selection_reason: "Выбран явный запрос условий участия; дополнительный охват имеет менее определённое намерение.",
    directions: plan.directions.map(d => ({ direction_id: d.id, commercial_intent: "EXPLICIT", role: "ACQUISITION", budget_rub: allocations.find(a => a.direction_id === d.id).budget_rub,
      audience_reason: "Ищет условия участия компании", qualification_path: "Запрос → представитель компании → подтверждённый интерес", budget_reason: "Бюджет сосредоточен на явном намерении; количество результатов пока не оценено.", evidence_refs: refs.slice(0, 1) })),
    forecast: { scope: "INITIAL_PERIOD", period, inputs: plan.directions.map(d => ({ direction_id: d.id, cpc_rub: unknown(), click_to_qualified_percent: unknown(), obtainable_clicks: unknown() })),
      duplicate_result_percent: unknown(), result_before_deadline_percent: unknown(), allocation_options: [{ id: "selected", allocations, goal_support_vs_selected: "COMPARABLE", rationale: "Рабочий вариант" }, { id: "less", goal_support_vs_selected: "COMPARABLE", allocations: allocations.map(a => ({ ...a, budget_rub: Math.floor(a.budget_rub / 2) })), rationale: "Проверка достижения цели с меньшими расходами" }], selected_allocation_id: "selected",
      contribution_to_goal: "Подготовлен первый период. Достижение всей количественной цели пока не обосновано.", conditions: ["Получить сопоставимые данные конверсии и доступного спроса"] },
  };
}
export function goalReviewFixture(portfolio, plan, copy) {
  const offer = copy.sources.find(s => s.source_ref === "strategy:advertised_offer");
  return { version: GOAL_PREPARATION_VERSION, goal_revision_id: plan.goal_preparation.goal.revision_id, recommendation: "BEST_SUPPORTED", goal_attainment: "UNASSESSED",
    summary: "Из рассмотренных вариантов выбран поиск явного участия. Количество и стоимость обращений пока не оценены.",
    groups: portfolio.campaigns.flatMap(c => c.groups.map(g => ({ group_id: g.id, commercial_intent: "EXPLICIT", audience_fit: "Запрос участия соответствует предложению компании", qualification_mechanism: "Подтверждение интереса, формата и сроков менеджером", budget_reason: "Сосредоточение бюджета на запросе участия", selection_reason: "Выбраны варианты с понятным следующим действием", reuse_reason: null,
      candidates: [...g.ads.map(a => ({ id: `candidate-${a.id}`, disposition: "SELECTED", ad_id: a.id, titles: [...a.titles], texts: [...a.texts], source_refs: [...a.source_refs], additional_value: "Ответ на отдельное возражение потенциального участника", overlap_with: [], reason: "Подтверждённое предложение с конкретным следующим действием" })),
        { id: `rejected-${g.id}`, disposition: "REJECTED", ad_id: null, titles: [offer.text], texts: [offer.text + "."], source_refs: [offer.source_ref], additional_value: "Дополнительная польза не установлена", overlap_with: [], reason: "Повторяет предмет предложения и не объясняет следующий шаг" }],
    }))),
    checks: GOAL_REVIEW_AREAS.map(area => ({ area, status: area === "BUDGET_AND_GOAL" || area === "EVIDENCE_LIMITS" ? "LIMITATION" : "PASS", finding: area === "BUDGET_AND_GOAL" ? "Прогноз количества обращений неизвестен" : "Сопоставлены цель и подготовленные материалы", action: "Сохранены ограничения; численная достижимость не утверждается", affected_ids: ["portfolio"] })),
  };
}

export function preparationDecisionFixture(plan) {
  const observations = plan.goal_preparation.version === "goal-directed-preparation-v4" ? ["COST", "CLICKS", "GOAL_OUTCOME_RECORDS", "GOAL_OUTCOME_DATE", "CAMPAIGN_AND_AD", ...(plan.goal_preparation.goal.metric?.family === "SUM" ? ["OUTCOME_AMOUNT", "REVERSALS_AND_COSTS"] : []), ...(plan.goal_preparation.goal.metric?.family === "RATIO" ? ["METRIC_NUMERATOR", "METRIC_DENOMINATOR"] : [])] : ["COST", "CLICKS", "UNIQUE_QUALIFIED_RESULTS", "QUALIFICATION_DATE", "CAMPAIGN_AND_AD"];
  return { scope: "LOCAL_CAMPAIGN_PREPARATION", decision: "READY_FOR_VALIDATION", reasoning: "Изолированный пример: подготовка проверена, результативность ещё не измерена.",
    remaining_unknowns: ["CPC", "QUALIFICATION", "OBTAINABLE_CLICKS", "DUPLICATES", "QUALIFICATION_DELAY"].map(metric => ({ metric, why_unavailable: "Сопоставимой истории нет", resolution: "MEASURED_VALIDATION", decision_impact: "Пересчитать выбор и остаток цели после измерения" })),
    validation_plan: { phase_id: plan.budget.phases[0].id, maximum_spend_rub: plan.budget.phases[0].cap_rub, qualified_result: plan.goal_preparation.goal.qualified_result,
      observations: observations.map(field => ({ field, collection_method: `Изолированный метод наблюдения ${field}` })),
      reassess_remaining_goal: "Пересчитать уникальные результаты, оставшийся срок и общий бюджет", stop_rule: "Остановить при лимите фазы или достижении цели", prepublication_dependencies: ["Отдельное разрешение запуска и настройка измерения"] },
    evidence_refs: plan.goal_preparation.directions[0].evidence_refs.slice(0, 1) };
}
