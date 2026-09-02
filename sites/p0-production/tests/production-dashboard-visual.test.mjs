import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const productionSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const prototypeSource = await readFile(new URL("../app/prototype/prd-149/PrototypeClient.tsx", import.meta.url), "utf8");
const goalStageSummarySource = productionSource.slice(
  productionSource.indexOf("function GoalStageSummary"),
  productionSource.indexOf("function OwnerField"),
);

const sharedVisualClasses = [
  "prototype",
  "topbar",
  "brand",
  "activeNav",
  "pageA",
  "stageNav",
  "stageNavhorizontal",
  "ownerWorkspace",
  "artifact",
];

test("production Dashboard uses the accepted PRD-149 visual layer instead of a parallel reskin", () => {
  assert.match(productionSource, /import styles from "\.\/prototype\/prd-149\/prototype\.module\.css"/u);
  for (const className of sharedVisualClasses) {
    assert.match(prototypeSource, new RegExp(`styles\\.${className}\\b`, "u"));
    assert.match(productionSource, new RegExp(`styles\\.${className}\\b`, "u"));
  }
  assert.doesNotMatch(productionSource, /owner-topbar|owner-hero|owner-workspace|owner-agent-rail/u);
});

test("production stage cards switch the visible owner section without mutating workflow state", () => {
  assert.match(productionSource, /useState<OwnerJourneyStageId \| null>/u);
  assert.match(productionSource, /<StageNavigation projection=\{projection\} selectedStage=\{activeStage\} onStage=\{chooseStage\}/u);
  assert.match(productionSource, /<button[\s\S]*aria-pressed=\{selectedStage === stage\.id\}[\s\S]*aria-controls="owner-stage-panel"/u);
  for (const stage of ["goal", "findings", "strategy", "campaigns", "review"]) {
    assert.match(productionSource, new RegExp(`activeStage === "${stage}"`, "u"));
  }
  assert.doesNotMatch(productionSource, /function StageUnavailable|ЭТАП ЕЩЁ НЕ ОТКРЫТ/u);
});

test("production starts with the stage navigation and omits the removed Goal hero", () => {
  assert.doesNotMatch(productionSource, /function Hero|styles\.hero\b|styles\.heroOutcome\b/u);
  assert.doesNotMatch(productionSource, /prototypeFlag|ПРОТОТИП · ЦЕЛЕВОЕ СОСТОЯНИЕ/u);
});

test("Campaign Goal uses one atomic editor for the business goal, qualified result, and measurable criterion", () => {
  for (const label of ["Бизнес-цель", "Квалифицированный результат", "Критерий успеха"]) {
    assert.match(goalStageSummarySource, new RegExp(label, "u"));
  }
  for (const field of ["desired_outcome", "qualified_action", "target_count", "deadline", "max_result_cost_rub"]) {
    assert.match(goalStageSummarySource, new RegExp(`name="${field}"`, "u"));
  }
  assert.match(goalStageSummarySource, /owner-goal-editor/u);
  assert.match(goalStageSummarySource, /Изменить цель/u);
  assert.match(goalStageSummarySource, /Сохранить и начать сбор сведений/u);
  assert.match(goalStageSummarySource, /Требует уточнения/u);
  const saveGoalIndex = productionSource.indexOf('pipeline_action: "CORRECT_GOAL"');
  const startEvidenceIndex = productionSource.indexOf('pipeline_action: "START"', saveGoalIndex);
  assert.ok(saveGoalIndex > -1 && startEvidenceIndex > saveGoalIndex);
  assert.match(productionSource, /по цене не выше/u);
  assert.doesNotMatch(goalStageSummarySource, /goalField|editingField|Границы результата|knownConstraints/u);
  assert.doesNotMatch(productionSource, /GoalFormationSummary|GoalInterview|goal-agent|Рекомендация агента|Помочь сформулировать|Проверить на противоречия/u);
  assert.doesNotMatch(productionSource, /ПРОВЕРЕННАЯ ВЕРСИЯ ЦЕЛИ|Цель кампании и модель бизнеса|Что требует пересборки|owner-goal-rebuild/u);
});

test("production omits redundant status and the removed top outcome summary", () => {
  for (const className of ["connectionState", "agentMessage", "railSnapshot", "safetyCard"]) {
    assert.doesNotMatch(productionSource, new RegExp(`styles\\.${className}\\b`, "u"));
  }
  assert.doesNotMatch(productionSource, /owner-outcome|ТЕКУЩИЙ БИЗНЕС-РЕЗУЛЬТАТ/u);
});

test("prototype automation map distinguishes forbidden launch from available Direct reads", () => {
  assert.match(prototypeSource, /Запуск показов и расходов/u);
  assert.match(prototypeSource, /ЗАПРЕЩЁН В P0/u);
  assert.doesNotMatch(prototypeSource, />Показы и расходы<[^\n]*>НЕДОСТУПНО</u);
});
