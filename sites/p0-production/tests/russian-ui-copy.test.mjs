import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localizedText, machineLabel } from "../app/ui-copy.ts";

const uiSources = (await Promise.all([
  "../app/P0Client.tsx",
  "../app/RecommendationSetDisclosure.tsx",
  "../app/MarketEvidenceDisclosure.tsx",
  "../app/page.tsx",
  "../app/layout.tsx",
  "../lib/wordstat-presentation.ts",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");

const obsoleteVisiblePhrases = [
  "Production Module",
  "PRODUCTION MODULE",
  "production-контекст",
  "Official scoped market evidence",
  "Qualified pre-launch cost",
  "Business model",
  "LANDING PAGE · ADVISORY ONLY",
  "ADVISORY · NON-BLOCKING",
  "Campaign Canvas",
  "Показать hidden Drafts",
  "Review доступен · Publish readiness",
  "Исключить из shortlist",
  "Создать package review",
  "Human Decision Gate",
  "Package campaign executions",
  "Focused correction",
  "Provider rejection correction",
  "Initial package verdict",
  "Correction progress",
  "Corrected terminal outcome",
  "Prepared corrected Human Decision Gate packet",
  "External writes performed",
  "CAMPAIGN HYPOTHESIS + ПОЛНЫЙ CAMPAIGN DRAFT",
  "EVIDENCE ANALYST",
  "PUBLICATION REVIEW · БЕЗ ПУБЛИКАЦИИ",
  "STRATEGY AGENT · PRIORITY BUSINESS INPUT",
  "ПРОВЕРЕННАЯ GOAL REVISION",
  "ТЕКУЩИЕ CAMPAIGN DRAFT",
  "ДИАЛОГ С АГЕНТОМ",
];

test("видимые тексты интерфейса не содержат прежнюю английскую терминологию", () => {
  for (const phrase of obsoleteVisiblePhrases) {
    assert.equal(uiSources.includes(phrase), false, `Найден непереведённый текст: ${phrase}`);
  }
});

test("частоты Wordstat показывают русские подписи метода, ограничений и следующего шага", () => {
  for (const phrase of [
    "Популярные запросы Wordstat",
    "Частота недоступна",
    "Квота Wordstat исчерпана",
    "Повторить только недоступные формулировки",
    "отсутствие частоты не означает нулевой спрос",
  ]) {
    assert.equal(uiSources.includes(phrase), true, `Не найдена русская подпись: ${phrase}`);
  }
});

test("машинные состояния и серверные пояснения получают русское представление", () => {
  assert.equal(machineLabel("PASS_AFTER_CORRECTION"), "Пройдено после исправления");
  assert.equal(machineLabel("REJECTED_NEEDS_EDIT"), "Отклонено — требуется исправление");
  assert.equal(machineLabel("CONFIRMED_SUSPENDED"), "Остановка подтверждена");
  assert.equal(
    localizedText("Campaign Draft requires persisted official API evidence and exact account binding."),
    "Черновик кампании требует сохранённых данных из официального программного интерфейса и точной привязки аккаунта.",
  );
  assert.equal(machineLabel("AGENT_ACCEPTED"), "Принято системой");
  assert.equal(localizedText("Campaign Hypothesis → Campaign Draft"), "гипотеза кампании → черновик кампании");
});
