import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const productionSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const dashboardStyles = await readFile(new URL("../app/production-dashboard.module.css", import.meta.url), "utf8");
const currentContractSource = await readFile(new URL("../lib/pipeline-current-contract.ts", import.meta.url), "utf8");
const pipelineDashboardSource = await readFile(new URL("../lib/pipeline-owner-dashboard.ts", import.meta.url), "utf8");
const goalStageSummarySource = productionSource.slice(
  productionSource.indexOf("function GoalStageSummary"),
  productionSource.indexOf("function OwnerField"),
);

const productionVisualClasses = [
  "dashboard",
  "topbar",
  "brand",
  "activeNav",
  "pageA",
  "stageNav",
  "stageNavhorizontal",
  "ownerWorkspace",
  "artifact",
];

test("production Dashboard owns its visual layer", () => {
  assert.match(productionSource, /import styles from "\.\/production-dashboard\.module\.css"/u);
  for (const className of productionVisualClasses) {
    assert.match(productionSource, new RegExp(`styles\\.${className}\\b`, "u"));
    assert.match(dashboardStyles, new RegExp(`\\.${className}\\b`, "u"));
  }
  assert.doesNotMatch(productionSource, /prototype\/prd-149|styles\.prototype\b/u);
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

test("production starts with the stage navigation and omits a prototype Goal hero", () => {
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
  assert.doesNotMatch(goalStageSummarySource, /criterionComplete \? "Завершено" : currentGoal \? "Требует уточнения" : "Не заполнено"/u);
  assert.doesNotMatch(goalStageSummarySource, /Что считаем успехом/u);
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

test("current production contract keeps publication and external writes denied", () => {
  assert.match(currentContractSource, /внешняя запись, публикация и расходы не разрешены/u);
  assert.doesNotMatch(currentContractSource, /"PUBLISH"|"DISPATCH_PACKAGE"|"CREATE_CAMPAIGN"/u);
  assert.match(pipelineDashboardSource, /externalWrite: "DENIED"/u);
  assert.match(pipelineDashboardSource, /publication: "NOT_AUTHORIZED"/u);
  assert.match(pipelineDashboardSource, /impressions: 0/u);
  assert.match(pipelineDashboardSource, /spendMicros: 0/u);
});
