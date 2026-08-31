import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const WORDSTAT_COLLECTION_PLAN_SCHEMA = "wordstat-ui-collection-plan-v1";
export const WORDSTAT_OBSERVATION_BATCH_SCHEMA = "wordstat-ui-observation-batch-v1";
export const WORDSTAT_SURFACES = Object.freeze(["TOP_POPULAR", "TOP_SIMILAR", "DYNAMICS", "REGIONS"]);
export const WORDSTAT_BATCH_STATUSES = Object.freeze([
  "COMPLETE",
  "PARTIAL",
  "AUTH_REQUIRED",
  "CAPTCHA_OR_CHALLENGE",
  "DOM_CHANGED",
  "UNAVAILABLE",
]);

const MAXIMUM_SEEDS = 8;
const MINIMUM_READ_INTERVAL_MS = 3_000;
const RETRY_DELAYS_MS = Object.freeze([10_000, 30_000]);
const RETRYABLE_FAILURES = new Set(["TRANSIENT_NETWORK", "LOAD_TIMEOUT", "TABLE_INCOMPLETE"]);
const TERMINAL_STATES = new Set(["AUTH_REQUIRED", "CAPTCHA_OR_CHALLENGE", "DOM_CHANGED"]);
const TERMINAL_FAILURES = new Set(["EXPLICIT_ACCESS_BLOCK", "STOPPED"]);
const COLLECTION_SOURCES = new Set(["YANDEX_WORDSTAT_UI", "TEST_FIXTURE"]);
const SANITIZED_FAILURE_CODES = new Set([
  ...RETRYABLE_FAILURES,
  ...TERMINAL_STATES,
  "EXPLICIT_ACCESS_BLOCK",
  "CSV_SCHEMA_CHANGED",
  "PROFILE_NOT_FOUND",
  "PROFILE_AMBIGUOUS",
  "PROFILE_CLONE_BUSY",
  "PROFILE_SNAPSHOT_INCONSISTENT",
  "BROWSER_LAUNCH_FAILED",
  "AUTH_COOKIE_TRANSFER_FAILED",
  "CLEANUP_FAILED",
  "STOPPED",
  "ARTIFACT_SAVE_FAILED",
  "UNAVAILABLE",
]);
const DEVICES = new Set(["ALL", "DESKTOP", "SMARTPHONE", "TABLET"]);
const OPERATOR_PROFILES = new Set(["BROAD_CONTAINING", "FIXED_WORD_COUNT", "FIXED_ORDER_FORM"]);
const ROW_FIELDS = Object.freeze({
  TOP_POPULAR: Object.freeze(["rank", "phrase", "count"]),
  TOP_SIMILAR: Object.freeze(["rank", "phrase", "count"]),
  DYNAMICS: Object.freeze(["period_start", "count", "share"]),
  REGIONS: Object.freeze(["provider_region_id", "region_label", "count", "share", "affinity_index"]),
});

export class WordstatCollectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WordstatCollectionError";
    this.code = code;
  }
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function exactText(value, label) {
  const containsControlCharacter = typeof value === "string" && [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (typeof value !== "string" || value.length === 0 || value.length > 500 || containsControlCharacter) {
    throw new WordstatCollectionError("PLAN_INVALID", `${label} is invalid.`);
  }
  return value;
}

function isoTimestamp(value, label) {
  const text = String(value ?? "");
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new WordstatCollectionError("PLAN_INVALID", `${label} is invalid.`);
  }
  return new Date(text).toISOString();
}

function isoDate(value, label) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00.000Z`))) {
    throw new WordstatCollectionError("PLAN_INVALID", `${label} is invalid.`);
  }
  return text;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function safeIdentifier(value, label) {
  const text = String(value ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(text)) {
    throw new WordstatCollectionError("PLAN_INVALID", `${label} is invalid.`);
  }
  return text;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new WordstatCollectionError("PLAN_INVALID", `${label} is invalid.`);
  }
  return number;
}

/**
 * Freezes the complete bounded plan before a browser is opened. The exact query
 * is retained byte-for-byte; normalized_query is only a comparison aid.
 */
export function buildWordstatCollectionPlan(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.seeds)
    || input.seeds.length === 0 || input.seeds.length > MAXIMUM_SEEDS) {
    throw new WordstatCollectionError("PLAN_LIMIT_EXCEEDED", "Wordstat collection requires between one and eight formulations.");
  }
  const seedIds = new Set();
  const seeds = input.seeds.map((seed, index) => {
    const seedId = safeIdentifier(seed?.seed_id, `seeds[${index}].seed_id`);
    if (seedIds.has(seedId)) throw new WordstatCollectionError("PLAN_INVALID", "Wordstat seed identifiers must be unique.");
    seedIds.add(seedId);
    const exactQuery = exactText(seed?.exact_query, `seeds[${index}].exact_query`);
    const operatorProfile = String(seed?.operator_profile ?? "");
    if (!OPERATOR_PROFILES.has(operatorProfile)) {
      throw new WordstatCollectionError("PLAN_INVALID", `seeds[${index}].operator_profile is invalid.`);
    }
    return Object.freeze({
      seed_id: seedId,
      exact_query: exactQuery,
      normalized_query: normalizedText(exactQuery).toLocaleLowerCase("ru-RU"),
      operator_profile: operatorProfile,
    });
  });
  const rawRegions = input.scope?.regions;
  if (!Array.isArray(rawRegions) || rawRegions.length === 0) {
    throw new WordstatCollectionError("PLAN_INVALID", "Wordstat collection requires at least one exact region.");
  }
  const providerIds = new Set();
  const regions = rawRegions.map((region, index) => {
    const providerId = positiveInteger(region?.provider_id, `scope.regions[${index}].provider_id`);
    const label = normalizedText(region?.label);
    if (!label || providerIds.has(providerId)) {
      throw new WordstatCollectionError("PLAN_INVALID", "Wordstat regions require unique provider IDs and labels.");
    }
    providerIds.add(providerId);
    return Object.freeze({ provider_id: providerId, label });
  });
  const device = String(input.scope?.device ?? "");
  if (!DEVICES.has(device)) throw new WordstatCollectionError("PLAN_INVALID", "Wordstat device scope is invalid.");
  if (input.scope?.dynamics?.granularity !== "MONTH") {
    throw new WordstatCollectionError("PLAN_INVALID", "Wordstat dynamics granularity must be MONTH.");
  }
  const fromDate = isoDate(input.scope?.dynamics?.from_date, "scope.dynamics.from_date");
  const toDate = isoDate(input.scope?.dynamics?.to_date, "scope.dynamics.to_date");
  if (fromDate > toDate) throw new WordstatCollectionError("PLAN_INVALID", "Wordstat dynamics date range is invalid.");
  const body = {
    schema_version: WORDSTAT_COLLECTION_PLAN_SCHEMA,
    seeds,
    scope: Object.freeze({
      regions: Object.freeze(regions),
      device,
      dynamics: Object.freeze({ granularity: "MONTH", from_date: fromDate, to_date: toDate }),
    }),
    surfaces: WORDSTAT_SURFACES,
    limits: Object.freeze({ maximum_seeds: MAXIMUM_SEEDS, parallel_queries: 1 }),
  };
  return Object.freeze({ ...body, plan_digest: digest(body) });
}

function finiteNonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new WordstatCollectionError("CSV_SCHEMA_CHANGED", `Wordstat ${field} is invalid.`);
  }
  return number;
}

function canonicalRow(surface, value) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (surface === "TOP_POPULAR" || surface === "TOP_SIMILAR") {
    const phrase = normalizedText(row.phrase);
    if (!phrase) throw new WordstatCollectionError("CSV_SCHEMA_CHANGED", "Wordstat phrase is invalid.");
    return {
      rank: positiveInteger(row.rank, "rank"),
      phrase,
      count: finiteNonNegative(row.count, "count"),
    };
  }
  if (surface === "DYNAMICS") {
    return {
      period_start: isoDate(row.period_start, "period_start"),
      count: finiteNonNegative(row.count, "count"),
      share: finiteNonNegative(row.share, "share"),
    };
  }
  const regionLabel = normalizedText(row.region_label);
  if (!regionLabel) throw new WordstatCollectionError("CSV_SCHEMA_CHANGED", "Wordstat region label is invalid.");
  return {
    provider_region_id: positiveInteger(row.provider_region_id, "provider_region_id"),
    region_label: regionLabel,
    count: finiteNonNegative(row.count, "count"),
    share: finiteNonNegative(row.share, "share"),
    affinity_index: finiteNonNegative(row.affinity_index, "affinity_index"),
  };
}

function assertHeaders(surface, headers) {
  if (!Array.isArray(headers) || JSON.stringify(headers) !== JSON.stringify(ROW_FIELDS[surface])) {
    throw new WordstatCollectionError("CSV_SCHEMA_CHANGED", "Official Wordstat CSV headers do not match the parser contract.");
  }
}

function canonicalRows(surface, source, label) {
  if (!source || typeof source !== "object" || !Array.isArray(source.rows)) {
    throw new WordstatCollectionError("CSV_SCHEMA_CHANGED", `Wordstat ${label} rows are unavailable.`);
  }
  assertHeaders(surface, source.headers);
  if (source.rows.length > 2_000) throw new WordstatCollectionError("TABLE_INCOMPLETE", "Wordstat row limit was exceeded.");
  return source.rows.map((row) => canonicalRow(surface, row));
}

function compareCsvAndDom(surface, result) {
  const csvRows = canonicalRows(surface, result.official_csv, "CSV");
  const domRows = canonicalRows(surface, result.dom, "DOM");
  const displayedRowCount = Number(result.dom.displayed_row_count);
  const explicitEmptyState = result.dom.explicit_empty_state === true;
  if (result.dom.stable !== true || !Number.isSafeInteger(displayedRowCount) || displayedRowCount < 0) {
    throw new WordstatCollectionError("TABLE_INCOMPLETE", "Wordstat DOM did not reach a stable completed state.");
  }
  if (csvRows.length === 0) {
    if (!explicitEmptyState || displayedRowCount !== 0 || domRows.length !== 0) {
      throw new WordstatCollectionError("TABLE_INCOMPLETE", "Empty Wordstat rows were not confirmed by the explicit empty state.");
    }
    return { rows: csvRows, displayedRowCount, explicitEmptyState };
  }
  if (explicitEmptyState || displayedRowCount !== csvRows.length || domRows.length === 0) {
    throw new WordstatCollectionError("TABLE_INCOMPLETE", "Wordstat CSV and displayed row counts disagree.");
  }
  const csvSet = new Set(csvRows.map((row) => JSON.stringify(row)));
  if (domRows.some((row) => !csvSet.has(JSON.stringify(row)))) {
    throw new WordstatCollectionError("CSV_SCHEMA_CHANGED", "Wordstat CSV and DOM control rows disagree.");
  }
  return { rows: csvRows, displayedRowCount, explicitEmptyState };
}

function assertConfirmedScope(plan, seed, surface, result) {
  if (result.confirmed_query !== seed.exact_query) {
    throw new WordstatCollectionError("TABLE_INCOMPLETE", "Wordstat did not confirm the exact planned query.");
  }
  const scope = result.scope && typeof result.scope === "object" ? result.scope : {};
  const expectedIds = plan.scope.regions.map((region) => region.provider_id);
  const expectedLabels = plan.scope.regions.map((region) => region.label);
  if (JSON.stringify(scope.provider_region_ids) !== JSON.stringify(expectedIds)
    || JSON.stringify(scope.region_labels) !== JSON.stringify(expectedLabels)
    || scope.device !== plan.scope.device
    || !normalizedText(scope.declared_window)) {
    throw new WordstatCollectionError("TABLE_INCOMPLETE", "Wordstat did not confirm the planned scope.");
  }
  if (surface === "DYNAMICS" && (scope.from_date !== plan.scope.dynamics.from_date
    || scope.to_date !== plan.scope.dynamics.to_date || scope.granularity !== "MONTH")) {
    throw new WordstatCollectionError("TABLE_INCOMPLETE", "Wordstat did not confirm the planned dynamics window.");
  }
  return {
    provider_region_ids: [...expectedIds],
    region_labels: [...expectedLabels],
    device: plan.scope.device,
    declared_window: normalizedText(scope.declared_window),
    from_date: surface === "DYNAMICS" ? plan.scope.dynamics.from_date : null,
    to_date: surface === "DYNAMICS" ? plan.scope.dynamics.to_date : null,
    granularity: surface === "DYNAMICS" ? "MONTH" : null,
  };
}

function csvEscape(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sanitizedCsv(surface, rows) {
  const fields = ROW_FIELDS[surface];
  return `${fields.join(",")}\n${rows.map((row) => fields.map((field) => csvEscape(row[field])).join(",")).join("\n")}${rows.length ? "\n" : ""}`;
}

function sanitizedFailureCode(value, fallbackCode = "UNAVAILABLE") {
  const code = normalizedText(value);
  return SANITIZED_FAILURE_CODES.has(code) ? code : fallbackCode;
}

function failureFrom(error, fallbackCode = "UNAVAILABLE") {
  const code = sanitizedFailureCode(error?.code, fallbackCode);
  const state = TERMINAL_STATES.has(code) ? code : "UNAVAILABLE";
  return { code, state };
}

function cleanDriverFailure(result) {
  const state = WORDSTAT_BATCH_STATUSES.includes(result?.state) ? result.state : "UNAVAILABLE";
  const fallbackCode = state === "UNAVAILABLE" ? "TRANSIENT_NETWORK" : state;
  const code = sanitizedFailureCode(result?.failure_code, fallbackCode);
  const retryAfter = result?.retry_after_seconds;
  return {
    state,
    code,
    retry_after_seconds: Number.isFinite(Number(retryAfter)) && Number(retryAfter) >= 0 ? Number(retryAfter) : null,
  };
}

function publicFailure(code, seedId, surface, attempt, retryAfterSeconds = null) {
  return {
    code,
    affected_seed_ids: [seedId],
    affected_surfaces: [surface],
    attempt,
    retry_after_seconds: retryAfterSeconds,
  };
}

async function throttleRead(clock, wait, previousReadAt) {
  if (previousReadAt === null) return;
  const remaining = MINIMUM_READ_INTERVAL_MS - (clock() - previousReadAt);
  if (remaining > 0) await wait(remaining);
}

function statusFor({ terminalState, observations, plannedCount }) {
  if (terminalState) return terminalState;
  if (observations.length === plannedCount) return "COMPLETE";
  return observations.length > 0 ? "PARTIAL" : "UNAVAILABLE";
}

/**
 * Executes one read at a time and persists only canonical rows and regenerated
 * CSV. The driver owns selectors and browser mechanics, but cannot add raw DOM,
 * cookies, HAR, traces, video, or screenshots to the returned batch.
 */
export async function collectAndSaveWordstatBatch(input) {
  const plan = input?.plan;
  if (!plan || plan.schema_version !== WORDSTAT_COLLECTION_PLAN_SCHEMA
    || plan.plan_digest !== digest({
      schema_version: plan.schema_version,
      seeds: plan.seeds,
      scope: plan.scope,
      surfaces: plan.surfaces,
      limits: plan.limits,
    })) {
    throw new WordstatCollectionError("PLAN_INVALID", "Wordstat collection plan is missing or was changed after freezing.");
  }
  if (!input.driver || typeof input.driver.readSurface !== "function" || typeof input.driver.cleanup !== "function") {
    throw new WordstatCollectionError("DRIVER_INVALID", "Wordstat browser driver contract is invalid.");
  }
  if (!input.artifactStore || typeof input.artifactStore.saveCsv !== "function" || typeof input.artifactStore.saveBatch !== "function") {
    throw new WordstatCollectionError("ARTIFACT_STORE_INVALID", "Wordstat artifact store contract is invalid.");
  }
  const now = input.now ?? (() => new Date().toISOString());
  const clock = input.clock ?? Date.now;
  const wait = input.wait ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const collectorVersion = normalizedText(input.collectorVersion);
  const parserVersion = normalizedText(input.uiParserVersion);
  const runId = safeIdentifier(input.runId, "runId");
  const source = normalizedText(input.source);
  if (!collectorVersion || !parserVersion) throw new WordstatCollectionError("COLLECTOR_INVALID", "Collector and parser versions are required.");
  if (!COLLECTION_SOURCES.has(source)) throw new WordstatCollectionError("SOURCE_INVALID", "Wordstat collection source must be explicit.");

  const batchStartedAt = isoTimestamp(now(), "batch_started_at");
  const batchId = digest({ source, run_id: runId, plan_digest: plan.plan_digest, batch_started_at: batchStartedAt });
  const observations = [];
  const failures = [];
  let terminalState = null;
  let previousReadAt = null;
  let cleanupStatus = "FAILED";

  try {
    collection: for (const seed of plan.seeds) {
      for (const surface of WORDSTAT_SURFACES) {
        let completed = false;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          if (attempt > 1) await wait(RETRY_DELAYS_MS[attempt - 2]);
          await throttleRead(clock, wait, previousReadAt);
          previousReadAt = clock();
          let result;
          try {
            result = await input.driver.readSurface({ plan, seed, surface, attempt, signal: input.signal });
          } catch (error) {
            const failure = failureFrom(error);
            result = { state: failure.state, failure_code: failure.code };
          }
          if (result?.state !== "COMPLETE") {
            const failure = cleanDriverFailure(result);
            failures.push(publicFailure(failure.code, seed.seed_id, surface, attempt, failure.retry_after_seconds));
            if (TERMINAL_STATES.has(failure.state) || TERMINAL_FAILURES.has(failure.code)) {
              terminalState = TERMINAL_STATES.has(failure.state) ? failure.state : "UNAVAILABLE";
              break collection;
            }
            if (!RETRYABLE_FAILURES.has(failure.code) || attempt === 3) break;
            continue;
          }
          try {
            const scope = assertConfirmedScope(plan, seed, surface, result);
            const compared = compareCsvAndDom(surface, result);
            const observedAt = isoTimestamp(result.observed_at, "observed_at");
            const observationId = digest({ batch_id: batchId, seed_id: seed.seed_id, surface, observed_at: observedAt });
            const cleanCsv = sanitizedCsv(surface, compared.rows);
            const csvDigest = digest(cleanCsv);
            const artifactRef = `wordstat-csv:${csvDigest}`;
            try {
              await input.artifactStore.saveCsv({
                batch_id: batchId,
                observation_id: observationId,
                surface,
                parser_version: parserVersion,
                digest: csvDigest,
                csv: cleanCsv,
              });
            } catch {
              failures.push(publicFailure("ARTIFACT_SAVE_FAILED", seed.seed_id, surface, attempt));
              terminalState = "UNAVAILABLE";
              break collection;
            }
            observations.push({
              observation_id: observationId,
              seed_id: seed.seed_id,
              exact_query: seed.exact_query,
              normalized_query: seed.normalized_query,
              operator_profile: seed.operator_profile,
              surface,
              observed_at: observedAt,
              scope,
              rows: compared.rows,
              displayed_row_count: compared.displayedRowCount,
              explicit_empty_state: compared.explicitEmptyState,
              result_state: compared.explicitEmptyState ? "NO_ROWS_RETURNED" : "ROWS_RETURNED",
              request_fingerprint: digest({ plan_digest: plan.plan_digest, seed_id: seed.seed_id, surface, scope }),
              response_fingerprint: digest({ rows: compared.rows, displayed_row_count: compared.displayedRowCount }),
              parser_contract: { version: parserVersion, csv_headers: [...ROW_FIELDS[surface]] },
              protected_artifact_ref: String(artifactRef),
              protected_artifact_digest: csvDigest,
              limitations: surface === "TOP_POPULAR"
                ? ["LOWER_BOUND_OBSERVED_TOP_ROWS", "Missing seed rows remain UNKNOWN and are not zero demand."]
                : ["This Wordstat observation is demand evidence, not CPC, budget, clicks, conversions, users, or a performance forecast."],
            });
            completed = true;
            break;
          } catch (error) {
            const failure = failureFrom(error, "DOM_CHANGED");
            const state = failure.code === "TABLE_INCOMPLETE" ? "UNAVAILABLE" : "DOM_CHANGED";
            failures.push(publicFailure(failure.code, seed.seed_id, surface, attempt));
            if (state === "DOM_CHANGED") {
              terminalState = "DOM_CHANGED";
              break collection;
            }
            if (attempt === 3) break;
          }
        }
        if (!completed && terminalState) break collection;
      }
    }
  } finally {
    try {
      const cleanup = await input.driver.cleanup();
      cleanupStatus = cleanup?.cleanup_status === "COMPLETE" ? "COMPLETE" : "FAILED";
    } catch {
      cleanupStatus = "FAILED";
    }
    if (cleanupStatus !== "COMPLETE") {
      terminalState = "UNAVAILABLE";
      failures.push({
        code: "CLEANUP_FAILED",
        affected_seed_ids: plan.seeds.map((seed) => seed.seed_id),
        affected_surfaces: [...WORDSTAT_SURFACES],
        attempt: 1,
        retry_after_seconds: null,
      });
    }
  }

  const batchFinishedAt = isoTimestamp(now(), "batch_finished_at");
  const batch = {
    schema_version: WORDSTAT_OBSERVATION_BATCH_SCHEMA,
    source,
    transport: "HEADLESS_PLAYWRIGHT",
    collector_version: collectorVersion,
    ui_parser_version: parserVersion,
    batch_id: batchId,
    run_id: runId,
    plan_digest: plan.plan_digest,
    batch_started_at: batchStartedAt,
    batch_finished_at: batchFinishedAt,
    status: statusFor({ terminalState, observations, plannedCount: plan.seeds.length * WORDSTAT_SURFACES.length }),
    observations,
    failures,
    cleanup_status: cleanupStatus,
  };
  if (batch.status === "COMPLETE" && cleanupStatus !== "COMPLETE") {
    throw new WordstatCollectionError("CLEANUP_FAILED", "A complete Wordstat batch requires confirmed cleanup.");
  }
  await input.artifactStore.saveBatch(batch);
  return { ...batch, protected_batch_ref: `wordstat-batch:${digest(batch)}` };
}

export function assertWordstatBatchEligibleForProductionSnapshot(batch) {
  if (!batch || batch.schema_version !== WORDSTAT_OBSERVATION_BATCH_SCHEMA
    || batch.source !== "YANDEX_WORDSTAT_UI"
    || batch.transport !== "HEADLESS_PLAYWRIGHT"
    || batch.status !== "COMPLETE"
    || batch.cleanup_status !== "COMPLETE") {
    throw new WordstatCollectionError("PRODUCTION_SNAPSHOT_FORBIDDEN", "Only a complete cleaned production Wordstat UI batch may enter an Analytics Evidence Snapshot.");
  }
  return batch;
}

export function projectWordstatBatchForDashboard(batch) {
  if (!batch || batch.schema_version !== WORDSTAT_OBSERVATION_BATCH_SCHEMA) {
    throw new WordstatCollectionError("BATCH_INVALID", "Wordstat UI batch is invalid.");
  }
  const observations = Array.isArray(batch.observations) ? batch.observations : [];
  const labels = [...new Set(observations.flatMap((item) => item.scope?.region_labels ?? []).map(normalizedText).filter(Boolean))];
  const devices = [...new Set(observations.map((item) => normalizedText(item.scope?.device)).filter(Boolean))];
  const seedCount = new Set(observations.map((item) => item.seed_id)).size;
  const action = batch.status === "AUTH_REQUIRED"
    ? "Войдите в Wordstat в локальном профиле AI и запустите новый сбор."
    : batch.status === "CAPTCHA_OR_CHALLENGE"
      ? "Разрешите проверку вручную вне пайплайна или дождитесь восстановления доступа."
      : null;
  return {
    source: batch.source,
    source_label: batch.source === "TEST_FIXTURE" ? "Яндекс Wordstat · тестовая фикстура" : "Яндекс Wordstat",
    status: batch.status,
    scope_label: [...labels, ...devices].join(" · ") || "Область Wordstat не подтверждена",
    observed_formulations: seedCount,
    observed_at: normalizedText(batch.batch_finished_at) || null,
    freshness_policy: "wordstat-ui-observation-v1",
    limitation: "Частотность Wordstat не является CPC, бюджетом, кликами, конверсиями или прогнозом результата; пробелы не означают нулевой спрос.",
    human_action: action,
  };
}

function outsideRepository(root, repositoryRoot) {
  const relation = relative(resolve(repositoryRoot), resolve(root));
  return relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation);
}

function fileNameFromDigest(value) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new WordstatCollectionError("ARTIFACT_INVALID", "Wordstat artifact digest is invalid.");
  return value.slice("sha256:".length);
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function atomicPrivateWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

/** Creates a local protected store without exposing its paths in evidence. */
export async function createWordstatFileArtifactStore(options) {
  const root = resolve(options?.root ?? "");
  const repositoryRoot = resolve(options?.repositoryRoot ?? process.cwd());
  if (!options?.root || !outsideRepository(root, repositoryRoot)) {
    throw new WordstatCollectionError("ARTIFACT_LOCATION_UNSAFE", "Wordstat artifacts must be stored outside the repository.");
  }
  const csvRoot = join(root, "csv");
  const batchRoot = join(root, "batches");
  await Promise.all([privateDirectory(root), privateDirectory(csvRoot), privateDirectory(batchRoot)]);
  return {
    async saveCsv(artifact) {
      if (digest(artifact.csv) !== artifact.digest) throw new WordstatCollectionError("ARTIFACT_INVALID", "Sanitized Wordstat CSV digest does not match.");
      const name = fileNameFromDigest(artifact.digest);
      await atomicPrivateWrite(join(csvRoot, `${name}.csv`), artifact.csv);
      return `wordstat-csv:${artifact.digest}`;
    },
    async saveBatch(batch) {
      const batchDigest = digest(batch);
      const name = fileNameFromDigest(batchDigest);
      await atomicPrivateWrite(join(batchRoot, `${name}.json`), `${JSON.stringify(batch, null, 2)}\n`);
      return `wordstat-batch:${batchDigest}`;
    },
  };
}
