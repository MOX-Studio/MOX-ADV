#!/usr/bin/env node

import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "playwright-core";

import {
  collectAndSaveWordstatBatch,
  createWordstatFileArtifactStore,
} from "./wordstat-ui-collector.mjs";
import { withWordstatProfileSession } from "./wordstat-profile-session.mjs";

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WORDSTAT_ORIGIN = "https://wordstat.yandex.com";
const TOP_HEADERS = Object.freeze(["rank", "phrase", "count"]);
const DYNAMICS_HEADERS = Object.freeze(["period_start", "count", "share"]);
const REGIONS_HEADERS = Object.freeze(["provider_region_id", "region_label", "count", "share", "affinity_index"]);
const RUSSIAN_MONTHS = Object.freeze([
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
]);

function cleanText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function processHandle(browser) {
  return {
    isRunning: async () => browser.isConnected(),
    terminate: async () => {
      if (browser.isConnected()) await browser.close();
    },
    waitForExit: async () => {},
  };
}

function numeric(value) {
  const parsed = Number(cleanText(value).replace(/[\s\u00a0]/gu, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) throw Object.assign(new Error("Wordstat numeric cell changed."), { code: "CSV_SCHEMA_CHANGED" });
  return parsed;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ";" && !quoted) {
      cells.push(current);
      current = "";
    } else current += character;
  }
  cells.push(current);
  return cells.map(cleanText);
}

function csvLines(payload) {
  return String(payload ?? "").split(/\r\n|\n|\r/u).map((line) => line.trim()).filter(Boolean);
}

function periodStart(value) {
  const normalized = cleanText(value).toLocaleLowerCase("ru-RU");
  const match = /^(январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)\s+(\d{4})$/u.exec(normalized);
  if (!match) throw Object.assign(new Error("Wordstat period cell changed."), { code: "CSV_SCHEMA_CHANGED" });
  return `${match[2]}-${String(RUSSIAN_MONTHS.indexOf(match[1]) + 1).padStart(2, "0")}-01`;
}

function monthLabel(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return `${RUSSIAN_MONTHS[date.getUTCMonth()][0].toLocaleUpperCase("ru-RU")}${RUSSIAN_MONTHS[date.getUTCMonth()].slice(1)} ${date.getUTCFullYear()}`;
}

async function stableTableRows(page) {
  const rows = page.locator("table tbody tr");
  await page.locator("table thead").waitFor({ state: "visible", timeout: 30_000 });
  const first = await rows.count();
  await page.waitForTimeout(900);
  const second = await rows.count();
  if (first !== second) throw Object.assign(new Error("Wordstat table did not stabilize."), { code: "TABLE_INCOMPLETE" });
  return second;
}

async function closeTour(page) {
  const close = page.getByRole("button", { name: "Close Tour" });
  if (await close.count() && await close.isVisible().catch(() => false)) await close.click();
}

async function assertAuthenticated(page) {
  const challenge = await page.getByText(/captcha|робот|подтвердите, что вы не робот|проверка безопасности/iu).count();
  if (challenge) throw Object.assign(new Error("Wordstat challenge requires manual resolution."), { code: "CAPTCHA_OR_CHALLENGE" });
  const login = page.getByText(/^Войти$/u);
  if (await login.count() && await login.isVisible().catch(() => false)) {
    throw Object.assign(new Error("Wordstat authentication is required."), { code: "AUTH_REQUIRED" });
  }
}

async function configureDevice(page, device) {
  const desired = {
    desktop: device === "ALL" || device === "DESKTOP",
    phone: device === "ALL" || device === "SMARTPHONE",
    tablet: device === "ALL" || device === "TABLET",
  };
  for (const [value, checked] of Object.entries(desired)) {
    const input = page.locator(`input[type="checkbox"][value="${value}"]`);
    if (await input.count() !== 1) throw Object.assign(new Error("Wordstat device controls changed."), { code: "DOM_CHANGED" });
    if (await input.isChecked() !== checked) await input.click({ force: true });
  }
  await page.waitForTimeout(800);
  for (const [value, checked] of Object.entries(desired)) {
    if (await page.locator(`input[type="checkbox"][value="${value}"]`).isChecked() !== checked) {
      throw Object.assign(new Error("Wordstat device scope was not applied."), { code: "TABLE_INCOMPLETE" });
    }
  }
}

async function selectSurface(page, surface) {
  if (surface === "TOP_SIMILAR") {
    await page.locator("label.RadioButton-Radio").filter({ hasText: "Похожие" }).click();
  } else if (surface === "DYNAMICS") {
    await page.locator("label.control").filter({ hasText: "Динамика" }).click();
  } else if (surface === "REGIONS") {
    await page.locator("label.control").filter({ hasText: "Регионы" }).click();
  }
  await page.waitForTimeout(1_200);
}

async function captureOfficialCsv(page) {
  await page.evaluate(() => { window.__moxWordstatCsvArtifacts = []; });
  const button = page.locator("button.save-button");
  if (await button.count() !== 1) throw Object.assign(new Error("Wordstat CSV control changed."), { code: "DOM_CHANGED" });
  await button.click();
  await page.waitForFunction(() => Array.isArray(window.__moxWordstatCsvArtifacts)
    && window.__moxWordstatCsvArtifacts.some((artifact) => typeof artifact.text === "string"), null, { timeout: 10_000 });
  const artifacts = await page.evaluate(() => window.__moxWordstatCsvArtifacts
    .filter((artifact) => typeof artifact.text === "string")
    .map((artifact) => ({ content_type: artifact.type, payload: artifact.text, size: artifact.size })));
  const csv = artifacts.find((artifact) => cleanText(artifact.content_type).toLocaleLowerCase("en-US").includes("text/csv"));
  if (!csv?.payload || csv.size <= 0) throw Object.assign(new Error("Wordstat CSV export is unavailable."), { code: "CSV_SCHEMA_CHANGED" });
  return csv;
}

function topRows(cells) {
  return cells.map((row, index) => ({ rank: index + 1, phrase: cleanText(row[0]), count: numeric(row[1]) }))
    .filter((row) => row.phrase);
}

function dynamicsRows(cells) {
  return cells.map((row) => ({ period_start: periodStart(row[0]), count: numeric(row[1]), share: numeric(row[2]) }));
}

function regionRows(cells, region) {
  return cells.filter((row) => cleanText(row[0]) === region.label).map((row) => ({
    provider_region_id: region.provider_id,
    region_label: region.label,
    count: numeric(row[1]),
    share: numeric(row[2]),
    affinity_index: numeric(row[3]),
  }));
}

function officialRows(surface, payload, region) {
  const lines = csvLines(payload);
  const cells = lines.slice(1).map(parseCsvLine).filter((row) => row.some(Boolean));
  if (surface === "DYNAMICS") return dynamicsRows(cells);
  if (surface === "REGIONS") return regionRows(cells, region);
  return [];
}

function headersFor(surface) {
  if (surface === "DYNAMICS") return DYNAMICS_HEADERS;
  if (surface === "REGIONS") return REGIONS_HEADERS;
  return TOP_HEADERS;
}

async function readDomRows(page, surface, region) {
  const cells = await page.locator("table tbody tr").evaluateAll((rows) => rows.map((row) => [...row.children]
    .map((cell) => (cell.textContent ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim())));
  if (surface === "DYNAMICS") return dynamicsRows(cells);
  if (surface === "REGIONS") return regionRows(cells, region);
  return topRows(cells);
}

async function assertScope(page, plan, surface) {
  const region = plan.scope.regions[0];
  const url = new URL(page.url());
  if (url.searchParams.get("region") !== String(region.provider_id)) {
    throw Object.assign(new Error("Wordstat region provider ID was not retained."), { code: "TABLE_INCOMPLETE" });
  }
  if (surface !== "REGIONS") {
    const regionButton = page.getByRole("button", { name: region.label, exact: true });
    if (await regionButton.count() !== 1) throw Object.assign(new Error("Wordstat region label was not confirmed."), { code: "TABLE_INCOMPLETE" });
  }
  if (surface === "DYNAMICS") {
    const expected = `${monthLabel(plan.scope.dynamics.from_date)} — ${monthLabel(plan.scope.dynamics.to_date)}`;
    const selectedRange = page.getByRole("button", { name: expected, exact: true });
    if (await selectedRange.count() !== 1) throw Object.assign(new Error("Wordstat dynamics window differs from the frozen plan."), { code: "TABLE_INCOMPLETE" });
  }
}

async function createDriver({ context, browser, plan }) {
  if (plan.scope.regions.length !== 1) throw Object.assign(new Error("The production Wordstat UI driver currently requires one exact provider region."), { code: "DOM_CHANGED" });
  const region = plan.scope.regions[0];
  let cleaned = false;
  return {
    async readSurface({ seed, surface, signal }) {
      if (signal?.aborted) return { state: "UNAVAILABLE", failure_code: "STOPPED" };
      const page = await context.newPage();
      try {
        const url = new URL(WORDSTAT_ORIGIN);
        url.searchParams.set("region", String(region.provider_id));
        url.searchParams.set("view", "table");
        await page.goto(url.href, { waitUntil: "networkidle", timeout: 60_000 });
        await assertAuthenticated(page);
        const query = page.locator("input.textinput__control").first();
        await query.fill(seed.exact_query);
        await query.press("Enter");
        await page.waitForTimeout(1_500);
        await closeTour(page);
        await assertAuthenticated(page);
        await configureDevice(page, plan.scope.device);
        await selectSurface(page, surface);
        await assertAuthenticated(page);
        await stableTableRows(page);
        await assertScope(page, plan, surface);
        if (await query.inputValue() !== seed.exact_query) {
          throw Object.assign(new Error("Wordstat query changed after submission."), { code: "TABLE_INCOMPLETE" });
        }
        const official = await captureOfficialCsv(page);
        const domRows = await readDomRows(page, surface, region);
        const csvRows = officialRows(surface, official.payload, region);
        const metadataOnly = (surface === "TOP_POPULAR" || surface === "TOP_SIMILAR") && csvRows.length === 0;
        const rows = metadataOnly ? domRows : csvRows;
        const declaredWindow = cleanText(csvLines(official.payload)[0]);
        if (!rows.length) throw Object.assign(new Error("Wordstat returned no confirmed rows for the exact scope."), { code: "TABLE_INCOMPLETE" });
        return {
          state: "COMPLETE",
          observed_at: new Date().toISOString(),
          confirmed_query: await query.inputValue(),
          scope: {
            provider_region_ids: [region.provider_id],
            region_labels: [region.label],
            device: plan.scope.device,
            declared_window: declaredWindow,
            from_date: surface === "DYNAMICS" ? plan.scope.dynamics.from_date : null,
            to_date: surface === "DYNAMICS" ? plan.scope.dynamics.to_date : null,
            granularity: surface === "DYNAMICS" ? "MONTH" : null,
          },
          official_csv: {
            headers: headersFor(surface),
            rows,
            metadata_only: metadataOnly,
            provider_content_type: official.content_type,
            provider_export_row_count: csvRows.length,
            provider_payload: official.payload,
          },
          dom: {
            headers: headersFor(surface),
            rows: domRows,
            displayed_row_count: domRows.length,
            explicit_empty_state: false,
            stable: true,
          },
        };
      } catch (error) {
        const code = ["AUTH_REQUIRED", "CAPTCHA_OR_CHALLENGE", "DOM_CHANGED", "TABLE_INCOMPLETE", "CSV_SCHEMA_CHANGED", "STOPPED"].includes(error?.code)
          ? error.code
          : error?.name === "TimeoutError" ? "LOAD_TIMEOUT" : "TRANSIENT_NETWORK";
        return { state: ["AUTH_REQUIRED", "CAPTCHA_OR_CHALLENGE", "DOM_CHANGED"].includes(code) ? code : "UNAVAILABLE", failure_code: code };
      } finally {
        await page.close().catch(() => {});
      }
    },
    async cleanup() {
      if (cleaned) return { cleanup_status: "COMPLETE" };
      cleaned = true;
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      return { cleanup_status: "COMPLETE" };
    },
  };
}

export async function collectHeadlessWordstatPlan({
  plan,
  runId,
  repositoryRoot = process.cwd(),
  artifactRoot = join(homedir(), ".local", "share", "mox-adv", "wordstat"),
  chromeExecutable = CHROME_EXECUTABLE,
  signal,
}) {
  const store = await createWordstatFileArtifactStore({ root: artifactRoot, repositoryRoot: resolve(repositoryRoot) });
  return withWordstatProfileSession({ runId }, async (session) => {
    const launchTarget = session.browserLaunchTarget();
    const profileContext = await chromium.launchPersistentContext(launchTarget.userDataDir, {
      executablePath: chromeExecutable,
      headless: true,
      args: [`--profile-directory=${launchTarget.profileDirectory}`],
      ignoreDefaultArgs: ["--use-mock-keychain", "--password-store=basic"],
    });
    session.registerCloneProcess(processHandle(profileContext.browser()));
    const profilePage = profileContext.pages()[0] ?? await profileContext.newPage();
    await profilePage.goto(WORDSTAT_ORIGIN, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});

    const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      window.__moxWordstatCsvArtifacts = [];
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (value) => {
        try {
          if (value instanceof Blob) {
            const entry = { type: value.type, size: value.size, text: null };
            window.__moxWordstatCsvArtifacts.push(entry);
            value.text().then((text) => { entry.text = text; }).catch(() => {});
          }
        } catch {
          // Blob provenance capture is best-effort; the provider action still runs unchanged.
        }
        return original(value);
      };
    });
    await session.transferYandexCookies(profileContext, context);
    session.registerCloneProcess(processHandle(browser));
    const driver = await createDriver({ context, browser, plan });
    return collectAndSaveWordstatBatch({
      plan,
      source: "YANDEX_WORDSTAT_UI",
      runId,
      collectorVersion: "wordstat-headless-playwright/1.0",
      uiParserVersion: "wordstat-ui-v279/1.0",
      driver,
      artifactStore: store,
      signal,
    });
  });
}
