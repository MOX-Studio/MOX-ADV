import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const ownerSource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");
const applicationSource = await readFile(new URL("../lib/p0-application.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/owner-journey.css", import.meta.url), "utf8");
const prototypeStyles = await readFile(new URL("../app/prototype/prd-149/prototype.module.css", import.meta.url), "utf8");

test("owner campaign surface renders business options without internal draft controls", () => {
  assert.match(clientSource, /Кампании для бизнес-проверки/u);
  assert.match(clientSource, /campaign\.offer/u);
  assert.match(clientSource, /campaign\.audience/u);
  assert.match(clientSource, /campaign\.destination/u);
  assert.doesNotMatch(clientSource, /publish_fingerprint|draft_revision_id|provider_ids|field_registry/u);
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

test("owner package review shows business outcomes while exact authority stays behind the interface", () => {
  assert.match(ownerSource, /preflightGates/u);
  assert.match(clientSource, /Предпубликационная проверка/u);
  assert.match(clientSource, /Месячный бюджет Strategy/u);
  assert.match(ownerSource, /Создана и оставлена без показов/u);
  assert.match(ownerSource, /Нужно исправить формулировку/u);
  assert.match(ownerSource, /authorize-and-create/u);
  assert.match(ownerSource, /confirm_package/u);
  assert.match(ownerSource, /allowDispatch.*dispatch_package/su);
  assert.doesNotMatch(clientSource, /package_id|gate_id|package_review_id|account_lock/u);
});

test("safe continuation and approved dispatch remain agent-owned without technical owner controls", () => {
  assert.match(ownerSource, /if \(!this\.agentProjection\) return project\(ownerKey, await this\.continueSafeWork/u);
  assert.match(ownerSource, /const current = await this\.application\.query\(ownerKey\);\s+return project\(ownerKey, current, agent/u);
  assert.match(applicationSource, /p0_continue_due_safe_work/u);
  assert.match(applicationSource, /p0_dispatch_approved_package/u);
  assert.match(applicationSource, /p0_prepare_rejected_correction/u);
  assert.match(applicationSource, /No exact persisted Human Decision Gate authorizes dispatch/u);
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
