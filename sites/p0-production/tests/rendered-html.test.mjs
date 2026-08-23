import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const focusSource = await readFile(new URL("../app/ProductFocusDisclosure.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the MOX-ADV production P0 shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Стратегия — MOX-ADV<\/title>/i);
  assert.match(html, /Стратегия и создание кампании/);
  assert.doesNotMatch(html, /Агент выполняет всю безопасную работу|Рабочий модуль · P0|ТОЛЬКО РЕАЛЬНЫЕ ДАННЫЕ/);
  assert.doesNotMatch(html, /Production Module|AI-first|production-кандидат/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Test Scenario/i);
});

test("marked supporting copy and panels stay out of the P0 interface", () => {
  assert.doesNotMatch(clientSource, /className="real-badge"|className="agent-message"/u);
  assert.doesNotMatch(clientSource, /GPT Sites · только рабочие данные|До полной аналитики модуль проверяет/u);
  assert.doesNotMatch(clientSource, /Отчёты формируются асинхронно/u);
  assert.doesNotMatch(clientSource, /Что агент сделает сам до полной аналитики|HTTPS добавляется технически/u);
  assert.doesNotMatch(clientSource, /Ревизия \{revision\} · только рабочие данные/u);
  assert.doesNotMatch(clientSource, /direct\.account\} · привязка подтверждена|Счётчик \$\{metrika\.counter_id\} · цель/u);
  assert.doesNotMatch(clientSource, /className="write-boundary"|className="recomputation-pending"/u);
  assert.doesNotMatch(clientSource, /Пересчёт зависимых данных обязателен|Идёт пересчёт зависимых данных|Это проверяемая сводка из разрешённых источников|ИЗВЛЕЧЁННЫЕ ДАННЫЕ/u);
  assert.doesNotMatch(clientSource, /До существенного изменения контекста|Одна предварительная бизнес-цель|Подтвердите или исправьте до полной аналитики|ПОДТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ|ПРЕДВАРИТЕЛЬНО/u);
  assert.doesNotMatch(clientSource, /<label><span>Бизнес-цель<\/span>|provisional_business_goal\.rationale/u);
  assert.match(clientSource, /<textarea aria-label="Бизнес-цель"/u);
  assert.doesNotMatch(clientSource, /className="evidence-source-body"|source\.facts|source\.limitations|source\.observed_at|source\.source_kind/u);
  assert.doesNotMatch(clientSource, /Неопределённость раскрыта, а не заполнена догадкой|Указатель доказательств|Где нужна проверка|className="evidence-index"|className="evidence-uncertainty"|className="assumption"|evidence\.generated_at/u);
  assert.doesNotMatch(focusSource, /Материально различимые продукты, услуги и предложения|Карточки не смешивают рыночную возможность|НУЖНО ОДНО РЕШЕНИЕ|Почему этот вариант не выбран автоматически|<strong>\{statusLabel\(card\.disposition\)\}<\/strong>/u);
  assert.doesNotMatch(styles, /\.real-badge|\.agent-message|\.agent-work|\.actions > span|\.goal-decision (?:>|h3|header|label|blockquote)|\.write-boundary|\.recomputation-pending|\.focus-reasons|\.product-focus > header > strong|\.focus-card > header > strong|\.assumption|\.evidence-index|\.evidence-uncertainty|\.evidence-claim|\.evidence-record|\.evidence-source-body/u);
});
