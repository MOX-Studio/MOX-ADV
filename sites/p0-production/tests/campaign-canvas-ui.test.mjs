import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const ownerSource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/owner-journey.css", import.meta.url), "utf8");

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
  assert.match(ownerSource, /9\/9 бизнес-проверок пройдено/u);
  assert.match(ownerSource, /Создана и оставлена без показов/u);
  assert.match(ownerSource, /Нужно исправить формулировку/u);
  assert.match(ownerSource, /authorize-and-create/u);
  assert.match(ownerSource, /confirm_package/u);
  assert.match(ownerSource, /dispatch_package/u);
  assert.doesNotMatch(clientSource, /package_id|gate_id|package_review_id|account_lock/u);
});

test("safe continuation and correction remain agent-owned behind the owner action", () => {
  assert.match(ownerSource, /continueSafeWork/u);
  assert.match(ownerSource, /poll_package_moderation/u);
  assert.match(ownerSource, /poll_package_correction_moderation/u);
  assert.match(clientSource, /Ожидание, повторные проверки и безопасная сверка не требуют действий владельца/u);
  assert.doesNotMatch(clientSource, /Проверить запланированный элемент|Повторить запрос|Сверить идентификаторы/u);
});

test("1920 desktop layout uses minmax-zero columns and fixed five-stage hierarchy", () => {
  assert.match(styles, /\.owner-journey \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/u);
  assert.match(styles, /\.owner-workspace \{[^}]*grid-template-columns: minmax\(0, 1fr\) 320px/u);
  assert.match(styles, /\.owner-main \{[^}]*min-width: 0/u);
  assert.match(styles, /\.owner-campaigns article \{[^}]*min-width: 0/u);
});
