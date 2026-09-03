import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const journeySource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/owner-journey.css", import.meta.url), "utf8");
const decisionStart = clientSource.indexOf("function PackageOwnerDecision(");
const decisionEnd = clientSource.indexOf("\nfunction StrategyOwnerReview", decisionStart);
const decisionComponent = decisionStart >= 0 && decisionEnd > decisionStart
  ? clientSource.slice(decisionStart, decisionEnd)
  : "";

test("owner receives one explicit accept/reject surface for the exact visible package", () => {
  assert.ok(decisionComponent);
  assert.match(decisionComponent, /ОДНО ЯВНОЕ РЕШЕНИЕ ВЛАДЕЛЬЦА/u);
  assert.match(decisionComponent, /Принять или отклонить точный пакет/u);
  assert.match(decisionComponent, /Точная видимая версия/u);
  assert.match(decisionComponent, /Рекомендация/u);
  assert.match(decisionComponent, /Альтернативы/u);
  assert.match(decisionComponent, /Последствия/u);
  assert.match(decisionComponent, /Риски и границы/u);
  assert.match(decisionComponent, /Следующий реальный этап/u);
  assert.match(decisionComponent, /Отклонить и вернуться к редактированию/u);
  assert.match(decisionComponent, /Принять точный пакет/u);
  assert.match(decisionComponent, /decision\.campaigns\.map/u);
});

test("decision handles are revision-bound and stale actions fail through the trusted owner seam", () => {
  assert.match(journeySource, /kind: "package-owner-decision"/u);
  assert.match(journeySource, /state: view\.revision/u);
  assert.match(journeySource, /packageReview: review\.package_review_id/u);
  assert.match(journeySource, /package: review\.package_id/u);
  assert.match(journeySource, /matchingPackageDecisionAction/u);
  assert.match(journeySource, /REJECT_EXACT_SHORTLIST_PACKAGE/u);
  assert.match(journeySource, /CONFIRM_EXACT_SHORTLIST_PACKAGE/u);
});

test("owner copy states the zero-write boundary and separate real stage without technical identifiers", () => {
  assert.match(journeySource, /Внешних записей, показов и расходов не будет/u);
  assert.match(journeySource, /Внешних записей — 0, показы — 0, расходы — 0/u);
  assert.match(journeySource, /отдельно разрешаемом реальном этапе/u);
  assert.match(journeySource, /Агент и модель не могут расширить/u);
  assert.doesNotMatch(decisionComponent, /package_id|review_id|gate_id|sha256:|provider|Campaigns\.(?:add|resume)/u);
});

test("decision surface has a dedicated reviewable visual hierarchy", () => {
  for (const className of [
    "owner-package-decision",
    "owner-package-safety",
    "owner-package-recommendation",
    "owner-package-exact",
    "owner-package-decision-grid",
    "owner-package-history",
    "owner-package-accept",
  ]) {
    assert.match(stylesSource, new RegExp(`\\.${className}\\b`, "u"));
  }
});
