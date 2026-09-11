import { FORMATION_AREA_LABELS, type FormationPlan, type FormationResearch } from "./campaign-formation-method.ts";
import type { FormationPortfolio } from "./campaign-formation-portfolio.ts";
import { businessText } from "./owner-business-copy.ts";

const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
const sentences = (value: string) => [...new Intl.Segmenter("ru", { granularity: "sentence" }).segment(value)].map(item => item.segment.trim()).filter(Boolean);

/** Full qualifications are retained for source/record views. */
export function findingLead(value: string): string {
  return sentences(value).filter((sentence, index) => index === 0 || /(?:^|\s)(?:не|нет|нельзя|только|кроме|если|без|пустая|неизвест\S*|отсутств\S*|огранич\S*)(?=\s|[.,;:!?]|$)/iu.test(sentence)).join(" ") || value;
}

// Collection progress and repair narration belongs to the original record, not a business conclusion.
const operational = (value: string) => /^(?:API\s|Автоматическое извлечение|Ошибка исправлена|На странице это(?=\s|$)|Начальная фаза|Последующая автоматическая фаза|Датированные прежние|Из \d+ уникальных возвращённых)/iu.test(value);
export function researchBrief(value: string, fallback = ""): string {
  const content = sentences(value).map(sentence => {
    if (/^Ошибка исправлена/iu.test(sentence) && sentence.includes(";")) {
      const conclusion = sentence.slice(sentence.indexOf(";") + 1).trim();
      return conclusion.charAt(0).toLocaleUpperCase("ru-RU") + conclusion.slice(1);
    }
    return sentence;
  }).filter(sentence => !operational(sentence));
  const fallbackSentences = sentences(fallback).filter(sentence => !operational(sentence));
  const lead = content[0] ?? fallbackSentences.find(sentence => /неизвест|не установ|не получ|недоступ|не выполн/iu.test(sentence)) ?? fallbackSentences[0];
  return lead?.replace(/^Сохранённые сегодняшние проверки отдельно исследовали /u, "Исследовали ") ?? "Результат проверки сохранён в источниках.";
}
const genericReason = (value: string) => /^(?:Вывод определяет соответствующие|Учтено в (?:соответствующих|указанных)|Предложение и следующий шаг соответствуют|Соответствует намерению)/iu.test(value);
const groups: Record<string, { id: string; title: string }> = {
  offer: { id: "offer", title: "Предложение и покупатели" },
  buyers: { id: "offer", title: "Предложение и покупатели" },
  objections: { id: "offer", title: "Предложение и покупатели" },
  landing: { id: "measurement", title: "Заявка и подтверждение результата" },
  measurement: { id: "measurement", title: "Заявка и подтверждение результата" },
};
const targets: Record<string, string> = { landing: "посадочной странице", measurement: "учёте обращений", budget: "бюджете", planning: "расчёте результата", semantics: "поисковых фразах" };

/** Short owner copy, without collection notes or instructions to the preparing agent. */
export function ownerBrief(value: string): string {
  const readable = businessText(value)
    .replace(/Владелец подтвердил отсутствие истории\./gu, "Сопоставимой истории нет.")
    .replace(/Посадочная предлагает/gu, "На сайте предлагается")
    .replace(/Искомый покупатель/gu, "Покупатель")
    .replace(/доставка реальной формы/giu, "доставка заявок с сайта")
    .replace(/доставка и учёт обращений-квалификация/giu, "доставка и проверка обращений")
    .replace(/Не установлен доступный счётчик (.+?) и импорт квалификации/gu, "Не проверен учёт посещений $1 и подходящих обращений")
    .replace(/(?:счетчик|счётчик) (.+?) не подтверждён/gu, "учёт посещений $1 не проверен")
    .replace(/Нет сопоставимой конверсии/gu, "Нет данных о результативности")
    .replace(/время квалификации/giu, "сроки проверки обращений")
    .replace(/Доставка формы и фактическая квалификация не проверялись\./gu, "Доставка заявок и учёт подходящих обращений пока не проверены.")
    .replace(/фактическая квалификация/giu, "проверка обращений")
    .replace(/время до квалификации/giu, "сроки проверки обращений")
    .replace(/конверсия клика в уникальную квалифицированную заявку/giu, "доля подходящих обращений после перехода")
    .replace(/Не известны/gu, "Неизвестны")
    .replace(/организационное окно квалификации/giu, "время на проверку обращений")
    .replace(/реальный лаг неизвестен/giu, "фактические сроки проверки обращений неизвестны")
    .replace(/Численная итоговая оценка остаётся неизвестной без этих поправок\./gu, "Прогноз обращений пока неизвестен.");
  return sentences(readable).filter(sentence => !/^(?:Повторно\s|Завершить\s|Не утверждать\s|Новые варианты\s|Добавить\s|Создать\s|Дополнительные\s.+\sучтены|Из\s\d+\sуникальных)/iu.test(sentence)).join(" ");
}

function compactResearch(findings: FormationResearch["findings"], id: string) {
  // Keep the main subject and buyer together. Other topics begin with their actual first finding.
  // Each dated condition remains visible; terms can qualify a price in later sentences.
  const primary = id === "offer"
    ? [findings.find(f => f.area === "offer"), findings.find(f => f.area === "buyers")].filter((f): f is FormationResearch["findings"][number] => Boolean(f))
    : id === "formats_and_calendar" ? findings : [findings[0]];
  const selected = primary.length ? primary : [findings[0]];
  const lead = selected.map(f => ownerBrief(id === "formats_and_calendar" ? f.finding : id === "demand" || id === "measurement" ? findingLead(f.finding) : researchBrief(f.finding, f.limitation))).filter(Boolean);
  const exceptions = findings.filter(f => f.state === "CONFLICT" || f.state === "UNKNOWN" || f.state === "NO_ROWS_RETURNED");
  const visible = unique([...lead, ...exceptions.map(f => ownerBrief(researchBrief(f.finding, f.limitation))).filter(Boolean)]);
  const numericScope = selected.filter(f => /\d/u.test(f.finding) && /частот|строк|сумм|нижн|пересек|спрос|клик|прогноз|выборк/iu.test(f.limitation));
  const notes = unique([...numericScope, ...exceptions].map(f => ownerBrief(findingLead(f.limitation))).filter(Boolean))
    .filter(note => !visible.some(statement => statement.includes(note)) && !/^Владелец.+подтвердил.+истори/iu.test(note));
  return { briefStatement: visible.join(" "), briefLimitations: notes };
}

/** Read-only display. Every original finding, qualification and source remains linked, without a count cap. */
export function presentFormationResearch(research: FormationResearch, plan?: FormationPlan, portfolio?: FormationPortfolio) {
  const byTopic = new Map<string, { title: string; findings: FormationResearch["findings"] }>();
  for (const finding of research.findings) {
    const topic = groups[finding.area] ?? { id: finding.area, title: FORMATION_AREA_LABELS[finding.area] ?? finding.area };
    const entry = byTopic.get(topic.id) ?? { title: topic.title, findings: [] };
    entry.findings.push(finding); byTopic.set(topic.id, entry);
  }
  return { rows: [...byTopic.entries()].map(([id, { title, findings }]) => {
    const findingIds = findings.map(finding => finding.id);
    const decisions = plan?.decisions.filter(decision => findingIds.includes(decision.finding_id)) ?? [];
    const specific = unique(decisions.filter(decision => !genericReason(decision.reason)).map(decision => `${decision.disposition === "DEFERRED" ? "Отложено: " : decision.disposition === "EXCLUDED" ? "Исключено: " : ""}${researchBrief(decision.reason)}`));
    const applications = portfolio?.applications.filter(application => findingIds.includes(application.finding_id) && !genericReason(application.explanation)) ?? [];
    const applied = decisions.filter(decision => decision.disposition === "APPLIED");
    const appliedTargets = unique(applied.flatMap(decision => decision.target_ids));
    const directions = plan?.directions.filter(direction => appliedTargets.includes(direction.id)) ?? [];
    const changes: string[] = [];
    if (directions.length && !applications.length && !applied.some(decision => !genericReason(decision.reason))) {
      const messages = unique(directions.map(direction => direction.message));
      changes.push(`В объявлениях: ${messages.map(message => `«${message}»`).join("; ")}.`);
    }
    if (appliedTargets.includes("planning") && plan?.planning_inputs.some(input => input.value === null)) changes.push("Прогноз числа результатов остаётся неизвестным.");
    if (appliedTargets.includes("measurement") && !directions.length && plan?.measurement.qualified_result) changes.push(`Результат засчитывается после проверки: ${plan.measurement.qualified_result.replace(/[.!?]$/u, "")}.`);
    if (appliedTargets.includes("budget") && !directions.length && plan) changes.push(`План расходов: до ${plan.budget.total_cap_rub.toLocaleString("ru-RU")} ₽.`);
    const impact = unique([...specific, ...applications.map(application => researchBrief(application.explanation)), ...changes]).join(" ")
      || (appliedTargets.length ? `Применение в ${unique(appliedTargets.map(target => targets[target] ?? "решении плана")).join(", ")} сохранено. Конкретное изменение не описано.` : "Решение по этим сведениям ещё не принято.");
    const primaryUnknowns = findings.filter(finding => ["UNKNOWN", "CONFLICT", "NO_ROWS_RETURNED"].includes(finding.state)
      || /\d/u.test(researchBrief(finding.finding)) && /нижн|частот|не\s+(?:отражает|прогноз|равн)|пересек/iu.test(finding.limitation));
    const state = findings.some(finding => finding.state === "CONFLICT") ? "CONFLICT" : findings.some(finding => finding.state === "UNKNOWN") ? "UNKNOWN" : findings.some(finding => finding.state === "NO_ROWS_RETURNED") ? "NO_ROWS_RETURNED" : findings.some(finding => finding.state === "INFERRED") ? "INFERRED" : "OBSERVED";
    return {
      id, title,
      ...compactResearch(findings, id),
      statement: unique(findings.map(finding => researchBrief(finding.finding, finding.limitation))).join(" "),
      impact, findingIds, sourceRefs: unique(findings.flatMap(finding => finding.evidence_refs)),
      state: state as FormationResearch["findings"][number]["state"],
      limitations: unique(findings.map(finding => finding.limitation)),
      visibleLimitations: unique(primaryUnknowns.map(finding => findingLead(finding.limitation))),
    };
  }) };
}
