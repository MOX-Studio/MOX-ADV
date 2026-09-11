import type { FormationDirection, FormationPlan, FormationResearch } from "./campaign-formation-method.ts";
import { findingLead } from "./formation-presentation.ts";

/** Display-only excerpts. The complete saved intent remains in the stage archive. */
export function firstDirectionSentence(value: string): string {
  return [...new Intl.Segmenter("ru", { granularity: "sentence" }).segment(value)]
    .map(item => item.segment.trim()).find(Boolean) ?? value.trim();
}

export function buyerSituation(intent: string): string {
  const sentence = firstDirectionSentence(intent);
  const clauses = sentence.split(/;\s*/u);
  // Some older intents append instructions for the writer to the buyer's situation.
  // Remove only an explicit instruction tail; retain buyer qualifications such as "но" or "только".
  const instruction = clauses.findIndex((clause, index) => index > 0 && /^(?:вопросы\s.+\s(?:выделяются|отделяются)|объявление\s|реклама\s|сразу\s(?:назвать|указать)|отдельные\sгруппы\s)/iu.test(clause));
  if (instruction < 0) return sentence;
  return `${clauses.slice(0, instruction).join("; ").replace(/[.;\s]+$/u, "")}.`;
}

export function genericSelectionReason(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  return /^(?:предложение(?: и следующий шаг)?|объявление|текст)\s+соответств(?:ует|уют)\s+(?:намерению|подтвержд[её]нным условиям)/iu.test(value.trim())
    || /^подтвержд[её]нное предложение с конкретным следующим действием[.!]?$/iu.test(value.trim())
    || /^предложение положено в основу кампании[.!]?$/iu.test(value.trim());
}

export function presentDirection(direction: FormationDirection, plan: FormationPlan, research: FormationResearch) {
  const prepared = plan.goal_preparation?.directions.find(item => item.direction_id === direction.id);
  const candidate = plan.goal_preparation?.portfolio_search?.candidates.find(item => item.direction_id === direction.id && item.disposition === "SELECTED");
  const decision = plan.decisions.find(item => item.disposition === "APPLIED" && item.target_ids.includes(direction.id));
  const savedReason = [candidate?.reason, prepared?.audience_reason, decision?.reason].find(reason => !genericSelectionReason(reason));
  const finding = research.findings.find(item => direction.finding_ids.includes(item.id));
  return {
    id: direction.id,
    situation: buyerSituation(direction.intent),
    response: firstDirectionSentence(direction.message),
    reason: savedReason ? findingLead(savedReason) : finding ? findingLead(finding.finding) : "Основание выбора не сохранено.",
    reasonKind: savedReason ? "DECISION" as const : finding ? "FINDING" as const : "UNKNOWN" as const,
  };
}

export function strategyApproach(plan: FormationPlan): string {
  const selected = plan.goal_preparation?.alternatives.find(item => item.id === plan.goal_preparation?.selected_alternative_id);
  const mechanism = selected?.mechanism ? firstDirectionSentence(selected.mechanism) : "";
  if (mechanism && !/[→←]/u.test(mechanism) && !genericSelectionReason(mechanism) && mechanism !== selected?.approach) return mechanism;
  return plan.directions.length === 1 ? "Реклама для выбранной ситуации покупателя." : "Отдельная реклама для каждой ситуации покупателя.";
}
