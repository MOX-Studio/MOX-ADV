import test from "node:test";
import assert from "node:assert/strict";
import { businessError, businessText, businessSourceUrl } from "../lib/owner-business-copy.ts";

test("owner copy retains business numbers, uncertainty and dates while omitting machine identifiers", () => {
  const text = businessText("Бюджет 30 000 ₽ до 30.06.2027. CPC: неизвестно. source_refs urn:mox:claim:abc123 sha256:abcdef0123456789 F-OFFER 2f877932-1bbd-4444-8cae-699872b181d9.");
  assert.match(text, /30 000 ₽ до 30\.06\.2027/);
  assert.match(text, /цена клика: неизвестно/);
  assert.doesNotMatch(text, /CPC|source_refs|urn:|sha256:|F-OFFER|2f877932/);
  assert.equal(businessText("0 обращений. Доступный бюджет 0 ₽."), "0 обращений. Доступный бюджет 0 ₽.");
  assert.equal(businessText("Цена 403 ₽. До 401 обращения."), "Цена 403 ₽. До 401 обращения.");
});

test("source diagnostics retain the access failure as a plain business limitation", () => {
  const text = businessText("Network connection lost. HTTP 403. https://api.direct.yandex.com/json/v5/reports");
  assert.match(text, /Не удалось получить данные источника/);
  assert.match(text, /отказ в доступе/);
  assert.doesNotMatch(text, /Network|HTTP|403|https:|\/json/);
  assert.equal(businessText('{"schema_version":"internal-v2","source_refs":["private"]}'), "");
});

test("collection mechanics and console locations do not replace a business finding", () => {
  const text = businessText("К исходным 18 поверхностям и сохранённым целевым фазам добавлены ещё 9 явных запросов: производители и экспоненты. No recoverable first-party evidence span is available. Посадочная: проверка текущего прогона. /Users/private/work/project.ts");
  assert.match(text, /Дополнительно изучены запросы: производители и экспоненты/);
  assert.match(text, /нет доступной цитаты с сайта/);
  assert.doesNotMatch(text, /поверхност|фазам|прогона|first-party|\/Users\//);
  const empty = businessText("Wordstat UI returned a confirmed empty surface; absent rows remain unknown and are not zero demand.");
  assert.match(empty, /не вернул запросов/); assert.match(empty, /не означает отсутствия спроса/); assert.doesNotMatch(empty, /UI|surface|confirmed/);
});

test("public business sources remain available, service and credential links do not", () => {
  assert.equal(businessSourceUrl("https://expo.innoprom.com/participation-2027"), "https://expo.innoprom.com/participation-2027");
  for (const url of ["https://api.direct.yandex.com/json/v5/reports", "https://api-metrika.yandex.net/management/v1/counters", "https://127.0.0.1/", "https://example.com/?token=secret", "https://example.com/api/data"]) assert.equal(businessSourceUrl(url), null);
});

test("unknown runtime failures cannot leak through the owner error boundary while business constraints remain specific", () => {
  for (const error of ["Durable pipeline run version drift detected.", "TypeError: source is undefined at loader.ts:58", '{"code":"PRIVATE_ERROR"}', "Подготовка остановлена: D1 SQL failure"]) assert.equal(businessError(error), "Не удалось выполнить действие. Можно повторить попытку.");
  assert.equal(businessError("Бюджет кампаний превышает 30 000 ₽."), "Бюджет кампаний превышает 30 000 ₽.");
  assert.equal(businessError("HTTP 403"), "Нет доступа к части необходимых данных.");
});

test("owner sees the wrong edition after form submission and denied analytics access without losing the finding", () => {
  const text = businessText("В форме задан success_url условий 2026. Счётчик 95790263 установлен; API счётчика и целей дал 403. Расходы откладываются до исправления.");
  assert.match(text, /В форме настроен переход на условия 2026/);
  assert.match(text, /Счётчик аналитики установлен; доступ к аналитике отклонён/);
  assert.match(text, /Расходы откладываются до исправления/);
  assert.doesNotMatch(text, /success_url|95790263|API|403/);
});
