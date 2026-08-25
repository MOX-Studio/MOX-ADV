import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const ownerSource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");
const applicationSource = await readFile(new URL("../lib/p0-application.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/owner-journey.css", import.meta.url), "utf8");
const prototypeStyles = await readFile(new URL("../app/prototype/prd-149/prototype.module.css", import.meta.url), "utf8");

test("owner campaign surface renders an independent business editor without exposing internal draft identifiers", () => {
  assert.match(clientSource, /Кампании для бизнес-проверки/u);
  assert.match(clientSource, /campaign\.offer/u);
  assert.match(clientSource, /campaign\.audience/u);
  assert.match(clientSource, /campaign\.destination/u);
  assert.match(clientSource, /Редактировать черновик/u);
  assert.match(clientSource, /Сохранить новую версию/u);
  assert.match(clientSource, /Отменить правки/u);
  assert.match(clientSource, /Сохранить протокол/u);
  assert.match(clientSource, /Поддерживаемые, условные и неподдерживаемые значения/u);
  assert.match(clientSource, /Точный предпросмотр публикации/u);
  assert.match(ownerSource, /matchingDraftEditorAction/u);
  assert.match(ownerSource, /save_draft/u);
  assert.match(ownerSource, /save_auction_protocol/u);
  assert.doesNotMatch(clientSource, /publish_fingerprint|draft_revision_id|provider_ids|field_registry|draft_id/u);
  assert.doesNotMatch(clientSource, /Фильтр вариантов|Открыть точную проекцию|Показать скрытые/u);
});

test("owner surface renders exactly one opaque primary action seam", () => {
  assert.match(clientSource, /projection\.primaryAction\.handle/u);
  assert.match(clientSource, /projection\.primaryAction\.fields/u);
  assert.match(clientSource, /className="owner-action"/u);
  assert.match(ownerSource, /return `act_\$\{token\}`/u);
  assert.match(ownerSource, /P0_OWNER_ACTION_STALE/u);
  assert.doesNotMatch(clientSource, /expected_revision|allowed_commands|CONFIRM_EXACT_SHORTLIST_PACKAGE/u);
});

test("owner package review shows exact business outcomes and one no-write accept/reject decision", () => {
  assert.match(ownerSource, /preflightGates/u);
  assert.match(clientSource, /Предпубликационная проверка/u);
  assert.match(clientSource, /Месячный бюджет Strategy/u);
  assert.match(clientSource, /ОДНО ЯВНОЕ РЕШЕНИЕ ВЛАДЕЛЬЦА/u);
  assert.match(clientSource, /Отклонить и вернуться к редактированию/u);
  assert.match(clientSource, /Принять точный пакет/u);
  assert.match(ownerSource, /Внешних записей — 0, показы — 0, расходы — 0/u);
  assert.match(ownerSource, /confirm_package/u);
  assert.match(ownerSource, /reject_package/u);
  assert.doesNotMatch(clientSource, /package_id|gate_id|package_review_id|account_lock/u);
});

test("safe continuation remains agent-owned while initial real creation needs a separate stage", () => {
  assert.match(ownerSource, /continueSafeWork\(ownerKey, initial, false\)/u);
  assert.match(ownerSource, /const current = await this\.application\.query\(ownerKey\);\s+return project\(ownerKey, current, agent/u);
  assert.match(applicationSource, /campaign-package:live-creation-authority/u);
  assert.match(applicationSource, /LIVE_CREATION_CONFIRMATION_TOKEN/u);
  assert.match(applicationSource, /Package dispatch требует отдельное точное одноразовое live creation authority/u);
  assert.match(applicationSource, /p0_continue_due_safe_work/u);
  assert.match(applicationSource, /p0_dispatch_approved_package/u);
  assert.match(applicationSource, /p0_prepare_rejected_correction/u);
  assert.match(applicationSource, /P0_AGENT_APPROVED_DISPATCH_DENIED/u);
  assert.doesNotMatch(ownerSource, /create-authorized-package|Подготовить исправление|Сохранить исправленную формулировку/u);
  assert.doesNotMatch(clientSource, /Проверить запланированный элемент|Повторить запрос|Сверить идентификаторы|Продолжить создание без запуска/u);
});

test("1920 desktop layout uses the accepted PRD-149 shell and fixed five-stage hierarchy", () => {
  assert.match(prototypeStyles, /\.stageNavhorizontal \{[^}]*grid-template-columns: repeat\(5, 1fr\)/u);
  assert.match(prototypeStyles, /\.ownerWorkspace \{[^}]*grid-template-columns: 280px minmax\(0, 1fr\)/u);
  assert.match(prototypeStyles, /\.agentRail \{[^}]*position: sticky/u);
  assert.match(prototypeStyles, /\.artifact \{[^}]*min-width: 0/u);
  assert.match(styles, /\.owner-main \{[^}]*min-width: 0/u);
  assert.match(styles, /\.owner-campaigns article \{[^}]*min-width: 0/u);
});
