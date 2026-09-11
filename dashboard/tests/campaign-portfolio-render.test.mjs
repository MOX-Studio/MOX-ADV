import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { projectCampaignKeywords } from "../lib/campaign-keyword-presentation.ts";
import { searchEvidence } from "./fixtures/search-semantics-fixture.mjs";

async function loadCampaignPortfolio(t, exportName = "default") {
  const sourceUrl = new URL("../app/CampaignPortfolio.tsx", import.meta.url);
  const outputUrl = new URL(`../app/.campaign-portfolio-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  let source = await readFile(sourceUrl, "utf8");
  const formationUrl = new URL(`../app/.campaign-formation-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const basisUrl = new URL(`../app/.campaign-basis-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const basisSource = (await readFile(new URL("../app/EvidenceBasis.tsx", import.meta.url), "utf8"))
    .replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(basisUrl, ts.transpileModule(basisSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(basisUrl, { force: true }));
  const archiveUrl = new URL(`../app/.campaign-archive-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const archiveSource = (await readFile(new URL("../app/FormationArchive.tsx", import.meta.url), "utf8"))
    .replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(archiveUrl, ts.transpileModule(archiveSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(archiveUrl, { force: true }));
  const formationSource = (await readFile(new URL("../app/CampaignFormation.tsx", import.meta.url), "utf8"))
    .replace('import styles from "./campaign-formation.module.css";', 'const styles = new Proxy({}, { get(_target, key) { return String(key); } });')
    .replace('"./EvidenceBasis.tsx"', JSON.stringify(basisUrl.href))
    .replace('"./FormationArchive.tsx"', JSON.stringify(archiveUrl.href));
  await writeFile(formationUrl, ts.transpileModule(formationSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(formationUrl, { force: true }));
  source = source.replace('import { FormationPortfolioView } from "./CampaignFormation.tsx";', `import { FormationPortfolioView } from "./${formationUrl.pathname.split("/").pop()}";`);
  source = source
    .replace('import { localizedText, ownerFieldLabel } from "./ui-copy";', 'const localizedText = (value) => String(value ?? "");\nconst ownerFieldLabel = (value) => String(value ?? "");')
    .replace('import styles from "./campaign-portfolio.module.css";', 'const styles = new Proxy({}, { get(_target, key) { return String(key); } });');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  await writeFile(outputUrl, compiled, "utf8");
  t.after(() => rm(outputUrl, { force: true }));
  return (await import(outputUrl.href))[exportName];
}

function currentResult({ strategyRevision = "strategy-current", pairStrategyRevision = strategyRevision, validation = "VALID" } = {}) {
  return {
    stateRevision: 4,
    products: {
      updatedAt: "2026-09-02T10:00:00.000Z",
      strategy: {
        revisionId: strategyRevision,
        status: "AGENT_ACCEPTED",
        dimensions: [
          { id: "advertised_offer", value: "Участие со стендом", confidence: "HIGH", rationale: "" },
          { id: "target_audience", value: "Промышленные компании", confidence: "HIGH", rationale: "" },
          { id: "qualified_result", value: "Заявка на участие", confidence: "HIGH", rationale: "" },
          { id: "geography", value: "Россия", confidence: "HIGH", rationale: "" },
          { id: "period", value: { start_date: "2026-09-01", end_date: "2027-06-30" }, confidence: "HIGH", rationale: "" },
        ],
      },
      campaignPairs: [{
        pairKey: "pair-internal-r1",
        hypothesisRevisionId: "hypothesis-internal-r1",
        draftRevisionId: "draft-internal-r1",
        hypothesis: {
          strategy_revision_id: pairStrategyRevision,
          mechanism: "Отделить прямой спрос на участие со стендом.",
          primary_metric: "Квалифицированная заявка",
          baseline: "Первый безопасный запуск",
        },
        publishProjection: {
          lineage: { strategy_revision_id: pairStrategyRevision },
          business: {
            product: "Участие со стендом в ИННОПРОМ",
            audience: "Промышленные компании",
            value: "Покажите компанию ключевым заказчикам",
            qualified_result: "Заявка на участие",
          },
          direct: {
            campaign: {
              Name: "ИННОПРОМ · прямой спрос",
              StartDate: "2026-09-01",
              EndDate: "2027-06-30",
              UnifiedCampaign: {
                BiddingStrategy: {
                  Search: {
                    BiddingStrategyType: "WB_MAXIMUM_CLICKS",
                    PlacementTypes: { SearchResults: "YES" },
                    WbMaximumClicks: { WeeklySpendLimit: 25_000_000_000, BidCeiling: 800_000_000 },
                  },
                  Network: { BiddingStrategyType: "SERVING_OFF" },
                },
              },
            },
            ad_group: { Name: "Участие со стендом", NegativeKeywords: { Items: ["вакансии", "бесплатно"] } },
            keyword: { Keyword: "участие в иннопром со стендом" },
            ad: {
              ResponsiveAd: {
                Titles: [{ Text: "Стенд на ИННОПРОМ" }],
                Texts: [{ Text: "Подайте заявку на участие" }],
                Href: "https://innoprom.com/participant/",
              },
            },
          },
        },
        auctionProtocol: { measurement_goal: "Заявка на участие" },
        reproducibility: [{ label: "Direct Compiler", value: "internal-version" }],
      }],
      pairValidation: { status: validation, disposition: "CURRENT_PAIRS_AVAILABLE", violations: validation === "VALID" ? [] : ["Нужно перепроверить обязательные поля."] },

    },
  };
}

function props(result, overrides = {}) {
  return {
    result,
    active: false,
    busy: false,
    economicLimitRub: 30_000,
    onPair: async () => undefined,
    onOpenStrategy: () => undefined,
    ...overrides,
  };
}

test("minimal Campaigns keeps the campaign, budget and status visible with preparation details collapsed", async (t) => {
  const CampaignPortfolio = await loadCampaignPortfolio(t);
  const html = renderToStaticMarkup(React.createElement(CampaignPortfolio, props(currentResult())));

  assert.match(html, /1 кампания · Черновики/u);
  assert.match(html, /ИННОПРОМ · прямой спрос/u);
  assert.match(html, /innoprom\.com\/participant/u);
  assert.match(html, /25(?:\u00a0| )000 ₽/u);
  const campaignOverview = html.slice(html.indexOf('<article class="campaignCard"'), html.indexOf('<details class="campaignDisclosure"'));
  assert.match(campaignOverview, /Промышленные компании/u);
  assert.match(campaignOverview, /Отделить прямой спрос на участие со стендом/u);
  assert.equal(html.split("Отделить прямой спрос на участие со стендом.").length - 1, 1);
  assert.doesNotMatch(html, /Действий владельца не требуется|auditSteps/u);
  assert.match(html, /<details class="preparationDetails"><summary>Подробности подготовки/u);
  assert.doesNotMatch(html, /Открыть проверку публикации|Следующий этап/u);
  assert.match(html, /Подготовка кампаний завершена/u);
  assert.doesNotMatch(html, /pair-internal-r1|hypothesis-internal-r1|draft-internal-r1|internal-version/u);
  assert.doesNotMatch(html, /Подтвердить пакет|Опубликовать кампани/u);
});

test("an out-of-date pair is routed back to Strategy after the review stage is removed", async (t) => {
  const CampaignPortfolio = await loadCampaignPortfolio(t);
  const html = renderToStaticMarkup(React.createElement(CampaignPortfolio, props(currentResult({ pairStrategyRevision: "strategy-old" }))));

  assert.match(html, /Кампании устарели/u);
  assert.match(html, /Открыть действующую стратегию/u);
  assert.doesNotMatch(html, /Открыть проверку публикации/u);
});

test("missing current Strategy is not labelled current and cannot borrow the working-set update date", async (t) => {
  const Component = await loadCampaignPortfolio(t);
  const result = currentResult();
  result.products.strategy = null;
  result.products.campaignPairs = [];
  result.products.updatedAt = "2026-09-05T12:00:00.000Z";
  const html = renderToStaticMarkup(React.createElement(Component, props(result)));
  assert.match(html, /Кампании ещё не подготовлены/u);
  assert.doesNotMatch(html, /Подробности подготовки|<details/u);
  assert.doesNotMatch(html, /<strong>Текущая<\/strong>|обновлено|версия зафиксирована/u);
  const actionable = renderToStaticMarkup(React.createElement(Component, props(result, {
    preparationActions: React.createElement("button", { type: "button" }, "Повторить подготовку"),
  })));
  assert.match(actionable, /Повторить подготовку/u);
  assert.doesNotMatch(actionable, /0 кампаний|Будет доступна после проверки/u);
});

test("only an accepted Strategy receives the current label, without a working-set timestamp", async (t) => {
  const Component = await loadCampaignPortfolio(t);
  const result = currentResult();
  result.products.strategy.status = "DRAFT";
  const pending = renderToStaticMarkup(React.createElement(Component, props(result)));
  assert.match(pending, /<strong>Проверяется<\/strong>/u);
  assert.doesNotMatch(pending, /<strong>Текущая<\/strong>|обновлено/u);
  result.products.strategy.status = "AGENT_ACCEPTED";
  const accepted = renderToStaticMarkup(React.createElement(Component, props(result)));
  assert.match(accepted, /<strong>Текущая<\/strong>/u);
  assert.doesNotMatch(accepted, /Будет доступна после проверки/u);
  assert.doesNotMatch(accepted, /обновлено/u);
});

function localResult() {
  const result = currentResult();
  const pair = result.products.campaignPairs[0];
  pair.publicationReadiness = { status: "UNAVAILABLE", localContentValid: true, blockers: [] };
  const old = pair.publishProjection.direct;
  pair.publishProjection.schema_version = "p0-direct-projection-v5";
  pair.publishProjection.direct = {
    campaign: old.campaign,
    ad_groups: [1, 2].map((index) => ({ local_ref: `ad-group:${index}`, provider_fields: { Name: `Направление ${index}`, NegativeKeywords: { Items: [] } } })),
    keywords: [1, 2].flatMap((index) => [
      { local_ref: `keyword:${index}:1`, ad_group_ref: `ad-group:${index}`, kind: "EXPLICIT_KEYWORD", provider_fields: { Keyword: `Фраза ${index} первая` } },
      { local_ref: `keyword:${index}:2`, ad_group_ref: `ad-group:${index}`, kind: "EXPLICIT_KEYWORD", provider_fields: { Keyword: `Фраза ${index} вторая` } },
      { local_ref: `auto:${index}`, ad_group_ref: `ad-group:${index}`, kind: "AUTOTARGETING", provider_fields: { AutotargetingSettings: { Categories: { Exact: "YES", Narrow: "YES", Broader: "NO" }, BrandOptions: { WithoutBrands: "YES", WithAdvertiserBrand: "YES", WithCompetitorsBrand: "NO" } } } },
    ]),
    ads: [1, 2].map((index) => ({ local_ref: `ad:${index}`, ad_group_ref: `ad-group:${index}`, provider_fields: { ResponsiveAd: { Titles: [`Заголовок ${index} первый`, `Заголовок ${index} второй`], Texts: [`Описание ${index}`], Href: `https://innoprom.com/participant/${index}` } } })),
  };
  const search = pair.publishProjection.direct.campaign.UnifiedCampaign.BiddingStrategy.Search;
  search.BiddingStrategyType = "WB_MAXIMUM_CONVERSION_RATE";
  search.WbMaximumConversionRate = { WeeklySpendLimit: 15_000_000_000, GoalId: "123" };
  delete search.WbMaximumClicks;
  return result;
}

test("local portfolio displays conversion allocation and labels publication support as unavailable", async (t) => {
  const Component = await loadCampaignPortfolio(t);
  const html = renderToStaticMarkup(React.createElement(Component, props(localResult())));
  assert.match(html, /Черновики подготовлены/u);
  assert.match(html, /15(?:\u00a0| )000 ₽/u);
  assert.match(html, /Направление 1/u);
  assert.match(html, /Направление 2/u);
  assert.match(html, /Размещение этих кампаний пока недоступно/u);
  assert.doesNotMatch(html, /Ключевая фраза не подтверждена/u);
});

test("local content retains every group phrase, creative, destination and described audience scope", async (t) => {
  const view = await loadCampaignPortfolio(t, "campaignView");
  const Structure = await loadCampaignPortfolio(t, "CampaignStructure");
  const result = localResult();
  const campaign = view(result.products.campaignPairs[0], 0, result);
  const html = renderToStaticMarkup(React.createElement(Structure, { campaign, active: false, busy: false, onPair: async () => undefined }));
  for (const index of [1, 2]) {
    for (const value of [`Направление ${index}`, `Фраза ${index} первая`, `Фраза ${index} вторая`, `Заголовок ${index} первый`, `Заголовок ${index} второй`, `Описание ${index}`, `https://innoprom.com/participant/${index}`]) assert.ok(html.includes(value), value);
  }
  assert.match(html, /Привлечение обращений/u);
  assert.match(html, /Дополнительно подбираемые запросы/u);
  assert.match(html, /без брендов, с брендом рекламодателя/u);
  assert.doesNotMatch(html, /1 ключевая фраза|минус-фразы проверены/u);
});

test("the owner view retains literal ads while excluding technical editors, compiler records and trace counters", async (t) => {
  const View = await loadCampaignPortfolio(t);
  const result = localResult();
  const pair = result.products.campaignPairs[0];
  pair.publishProjection.direct.ads[0].provider_fields.ResponsiveAd.Titles = ["CRM для отдела продаж"];
  pair.publishProjection.direct.ads[0].provider_fields.ResponsiveAd.Texts = ["Условия участия — 30 000 ₽."];
  pair.reproducibility = [{ label: "Direct Compiler", value: "sha256:1234567890abcdef1234567890abcdef" }];
  pair.searchSemantics = { keywords: [], coverage: { status: "REVIEWED", trace: { observed: 600, admitted: 120, forwarded: 80, selected: 4 }, groups: [], exclusions: [] } };
  const html = renderToStaticMarkup(React.createElement(View, props(result)));
  assert.match(html, /CRM для отдела продаж/u);
  assert.match(html, /Условия участия — 30 000 ₽\./u);
  assert.match(html, /Фраза 1 первая/u);
  assert.doesNotMatch(html, /Direct Compiler|sha256:|Campaign Draft|Campaign Hypothesis|Технические основания|Строк в срезе|передано агенту|Редактировать черновик|name="(?:group_ref|keywords|measurement_goal)"/u);
});

test("every explicit phrase displays its own scoped frequency or an explicit unknown, never an invented zero", async (t) => {
  const view = await loadCampaignPortfolio(t, "campaignView");
  const Structure = await loadCampaignPortfolio(t, "CampaignStructure");
  const result = localResult();
  const pair = result.products.campaignPairs[0];
  for (const group of pair.publishProjection.direct.ad_groups) group.provider_fields.RegionIds = [213];
  const snapshot = searchEvidence([{ phrase: "Фраза 1 первая", count: 49 }, { phrase: "Фраза 1 вторая", count: 9 }, { phrase: "Фраза 2 первая", count: 0 }]);
  pair.searchSemantics = projectCampaignKeywords({ snapshot, projection: pair.publishProjection, design: {}, fingerprint: "draft:1" });
  const campaign = view(pair, 0, result);
  const html = renderToStaticMarkup(React.createElement(Structure, { campaign, active: false, busy: false, onPair: async () => undefined }));
  for (const count of [49, 9, 0]) assert.match(html, new RegExp(`${count} <small>запросов за период`));
  assert.equal((html.match(/Частотность не подтверждена/gu) ?? []).length, 1);
  assert.equal((html.match(/06\.08\.2026 — 06\.09\.2026/gu) ?? []).length, 3);
  assert.match(html, /Москва · все устройства · широкая частота/u);
  assert.match(html, /не прогноз показов/u);
  assert.doesNotMatch(html, /Запросы со словами|Число запросов|sha256/u);
});

test("an unreviewed semantic set cannot be labelled ready merely because its local graph is valid", async (t) => {
  const Component = await loadCampaignPortfolio(t);
  const result = localResult();
  result.products.campaignPairs[0].searchSemantics = { keywords: [], coverage: { status: "NEEDS_RESEARCH", trace: null, groups: [], exclusions: [] } };
  const html = renderToStaticMarkup(React.createElement(Component, props(result)));
  assert.match(html, /Нужна повторная проверка/u);
  assert.match(html, /Покрытие поисковых намерений не подтверждено/u);
  assert.doesNotMatch(html, /Открыть проверку публикации/u);
});
