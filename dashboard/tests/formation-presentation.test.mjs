import test from "node:test";
import assert from "node:assert/strict";
import { presentFormationResearch, researchBrief } from "../lib/formation-presentation.ts";

const finding = (id, area, value, state = "OBSERVED", limitation = "") => ({ id, area, finding: value, state, limitation, evidence_refs: [`source:${id}`] });
const research = findings => ({ mode: "REAL_INPUTS", findings, test_data: [], coverage: [] });
const generic = "Вывод определяет соответствующие объекты, ограничения и сообщения; его неопределённость сохраняется.";

test("business conclusions survive collection and repair narration without exposing technical counters", () => {
  assert.equal(researchBrief("API прочитаны: 73 кампании, 12047 строк. Разделение намерений пригодно как пример структуры. Сопоставимой истории обращений нет."), "Разделение намерений пригодно как пример структуры.");
  assert.equal(researchBrief("Автоматическое извлечение ошибочно приняло 2000 ₽ за продажу. На странице это дополнительный бейдж. Ошибка исправлена в сборщике; средняя стоимость продажи не установлена."), "Средняя стоимость продажи не установлена.");
  assert.equal(researchBrief("Начальная фаза завершена: 18 из 18. Датированные прежние проверки сохранены.", "Направления исследованы. Сезонный объём кликов неизвестен."), "Сезонный объём кликов неизвестен.");
});

test("related facts share a topic while every source and original qualification remains available", () => {
  const input = research([
    finding("offer", "offer", "Предлагаются оборудованные места. Оснащение зависит от категории.", "OBSERVED", "Состав оснащения зависит от категории."),
    finding("buyer", "buyers", "Покупатель представляет компанию. Должность не определяет готовность купить.", "INFERRED"),
    finding("objection", "objections", "Покупателю нужны условия участия.", "INFERRED"),
  ]);
  const before = structuredClone(input);
  const display = presentFormationResearch(input);
  assert.equal(display.rows.length, 1);
  assert.deepEqual(display.rows[0].findingIds, ["offer", "buyer", "objection"]);
  assert.deepEqual(display.rows[0].sourceRefs, ["source:offer", "source:buyer", "source:objection"]);
  assert.ok(display.rows[0].limitations.includes("Состав оснащения зависит от категории."));
  assert.equal(display.rows[0].state, "INFERRED");
  assert.deepEqual(input, before);
  assert.equal(display.rows[0].impact, "Решение по этим сведениям ещё не принято.");
});

test("an actual saved advertising message replaces boilerplate without turning deferred work into an applied decision", () => {
  const input = research([finding("offer", "offer", "Есть платный формат."), finding("group", "buyers", "Коллективные условия неизвестны.", "UNKNOWN")]);
  const plan = { decisions: [
    { finding_id: "offer", disposition: "APPLIED", reason: generic, target_ids: ["D1"] },
    { finding_id: "group", disposition: "DEFERRED", reason: "Условия не подтверждены; направление отложено.", target_ids: [] },
  ], directions: [{ id: "D1", message: "Условия платного участия" }], planning_inputs: [] };
  const row = presentFormationResearch(input, plan).rows[0];
  assert.match(row.impact, /В объявлениях: «Условия платного участия»/);
  assert.match(row.impact, /Отложено: Условия не подтверждены/);
  assert.doesNotMatch(row.impact, /Вывод определяет|оба направления/);
});

test("zero, unknown and conflicting observations retain scope beside the visible number", () => {
  const input = research([
    finding("zero", "demand", "Запрос вернул 0 строк.", "NO_ROWS_RETURNED", "Это пустой ответ, не доказательство нулевого спроса."),
    finding("scope", "demand", "В регионе получено 120 запросов.", "OBSERVED", "Нижняя граница наблюдённых строк. Не прогноз обращений."),
    finding("unknown", "economics", "Конверсия не установлена.", "UNKNOWN", "Прогноз числа обращений неизвестен."),
    finding("conflict", "economics", "Стоимость в источниках различается.", "CONFLICT", "Источники относятся к разным периодам."),
  ]);
  const rows = presentFormationResearch(input).rows;
  assert.match(rows[0].statement, /0 строк/);
  assert.equal(rows[0].state, "NO_ROWS_RETURNED");
  assert.ok(rows[0].visibleLimitations.includes(input.findings[1].limitation));
  assert.equal(rows[1].state, "CONFLICT");
  assert.ok(rows[1].visibleLimitations.includes("Прогноз числа обращений неизвестен."));
  assert.ok(rows[1].visibleLimitations.includes("Источники относятся к разным периодам."));
});

test("condensed findings keep visible numeric scope and later uncertainty while preserving every original record", () => {
  const input = research([
    finding("scope", "demand", "В регионе получено 120 запросов. Повторно их не запрашивать.", "OBSERVED", "Нижняя граница наблюдённых строк. Не прогноз обращений."),
    ...Array.from({ length: 25 }, (_, index) => finding(`detail-${index}`, "demand", `Дополнительное наблюдение ${index}.`)),
    finding("unknown", "demand", "Частота другого запроса неизвестна.", "UNKNOWN", "Отсутствие измерения не означает нулевой спрос."),
    finding("conflict", "demand", "Источники дают разные значения спроса.", "CONFLICT", "Сведения относятся к разным регионам."),
  ]);
  const before = structuredClone(input);
  const row = presentFormationResearch(input).rows[0];
  assert.match(row.briefStatement, /В регионе получено 120 запросов/);
  assert.doesNotMatch(row.briefStatement, /Повторно|Дополнительное наблюдение/);
  assert.match(row.briefStatement, /Частота другого запроса неизвестна/);
  assert.match(row.briefStatement, /Источники дают разные значения спроса/);
  assert.ok(row.briefLimitations.includes("Нижняя граница наблюдённых строк. Не прогноз обращений."));
  assert.ok(row.briefLimitations.includes("Отсутствие измерения не означает нулевой спрос."));
  assert.ok(row.briefLimitations.includes("Сведения относятся к разным регионам."));
  assert.equal(row.state, "CONFLICT");
  assert.deepEqual(row.findingIds, input.findings.map(item => item.id));
  assert.deepEqual(row.sourceRefs, input.findings.flatMap(item => item.evidence_refs));
  for (const item of input.findings) assert.ok(row.statement.includes(researchBrief(item.finding)), `Full projection retains ${item.id}`);
  assert.deepEqual(input, before);
});
