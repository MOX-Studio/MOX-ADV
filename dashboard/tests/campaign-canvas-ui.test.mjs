import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const portfolioSource = await readFile(new URL("../app/CampaignPortfolio.tsx", import.meta.url), "utf8");
const ownerSource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");
const applicationSource = await readFile(new URL("../lib/p0-application.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/owner-journey.css", import.meta.url), "utf8");
const dashboardStyles = await readFile(new URL("../app/production-dashboard.module.css", import.meta.url), "utf8");

test("campaign business corrections remain available while technical editors leave the owner dashboard", () => {
  assert.match(clientSource, /<CampaignPortfolio/u);
  assert.match(portfolioSource, /campaign\.offer/u);
  assert.match(portfolioSource, /campaign\.audience/u);
  assert.doesNotMatch(portfolioSource, /TechnicalEditor|onPair\(event, campaign\.pair, "technical"\)/u);
  assert.match(portfolioSource, /onPair\(event, campaign\.pair, "semantic"\)/u);
  assert.doesNotMatch(clientSource, /activeStage === "review"|stage === "review"|publication-review-boundary/u);
  assert.doesNotMatch(portfolioSource, /onOpenReview|Открыть проверку публикации/u);
});

test("owner surface renders exactly one opaque primary action seam", () => {
  assert.match(clientSource, /projection\.primaryAction\.handle/u);
  assert.match(clientSource, /projection\.primaryAction\.fields/u);
  assert.match(clientSource, /className="owner-action"/u);
  assert.match(ownerSource, /return `act_\$\{token\}`/u);
  assert.match(ownerSource, /P0_OWNER_ACTION_STALE/u);
  assert.doesNotMatch(clientSource, /expected_revision|allowed_commands|CONFIRM_EXACT_SHORTLIST_PACKAGE/u);
});

test("owner Dashboard keeps current campaigns but omits the legacy package gate", () => {
  assert.match(portfolioSource, /Список кампаний/u);
  assert.match(portfolioSource, /campaigns\.map/u);
  assert.match(portfolioSource, /campaign\.offer/u);
  assert.match(ownerSource, /confirm_package/u);
  assert.match(ownerSource, /reject_package/u);
  assert.doesNotMatch(clientSource, /projection\.packageSummary|projection\.packageDecision/u);
  assert.doesNotMatch(clientSource, /Принять точный пакет|Предпубликационная проверка|Месячный бюджет Strategy/u);
});

test("safe continuation remains agent-owned while initial real creation needs a separate stage", () => {
  assert.match(ownerSource, /continueSafeWork\(ownerKey, initial, false\)/u);
  assert.match(ownerSource, /const current = await this\.application\.query\(ownerKey\);\s+return project\(ownerKey, current, agent/u);
  assert.match(applicationSource, /Feature #246 deliberately stops after the local owner decision/u);
  assert.match(applicationSource, /authorization in #250/u);
  assert.match(applicationSource, /p0_continue_due_safe_work/u);
  assert.match(applicationSource, /p0_dispatch_approved_package/u);
  assert.match(applicationSource, /p0_prepare_rejected_correction/u);
  assert.match(applicationSource, /P0_AGENT_APPROVED_DISPATCH_DENIED/u);
  assert.doesNotMatch(ownerSource, /create-authorized-package|Подготовить исправление|Сохранить исправленную формулировку/u);
  assert.doesNotMatch(clientSource, /Проверить запланированный элемент|Повторить запрос|Сверить идентификаторы|Продолжить создание без запуска/u);
});

test("production Campaigns is portfolio-first and uses current complete pairs without a package approval gate", () => {
  assert.match(clientSource, /<CampaignPortfolio/u);
  assert.match(clientSource, /result=\{projection\.currentResult\}/u);
  assert.match(portfolioSource, /Список кампаний/u);
  assert.match(portfolioSource, /Подробности подготовки/u);
  assert.doesNotMatch(portfolioSource, /Действий владельца не требуется/u);
  assert.doesNotMatch(portfolioSource, /Открыть проверку публикации|onOpenReview/u);
  assert.match(portfolioSource, /Подготовка кампаний завершена/u);
  assert.match(portfolioSource, /onPair\(event, campaign\.pair, "semantic"\)/u);
  assert.doesNotMatch(portfolioSource, /TechnicalEditor|Технические основания|Строк в срезе/u);
  assert.match(portfolioSource, /Общий лимит в неделю/u);
  assert.doesNotMatch(portfolioSource, /viability|comparativeScore|вероятност/u);
  assert.doesNotMatch(portfolioSource, /Подтвердить пакет|Одобрить пакет|Опубликовать кампани/u);
});

test("1920 desktop layout uses the production shell and fixed four-stage hierarchy", () => {
  assert.match(dashboardStyles, /\.stageNavhorizontal \{[^}]*grid-template-columns: repeat\(4, 1fr\)/u);
  assert.match(dashboardStyles, /\.ownerWorkspace \{[^}]*grid-template-columns: 280px minmax\(0, 1fr\)/u);
  assert.match(dashboardStyles, /\.ownerWorkspace\.ownerWorkspaceFull \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
  assert.match(dashboardStyles, /\.artifact \{[^}]*min-width: 0/u);
  assert.match(styles, /\.owner-main \{[^}]*min-width: 0/u);
  assert.match(styles, /\.owner-campaigns article \{[^}]*min-width: 0/u);
});
