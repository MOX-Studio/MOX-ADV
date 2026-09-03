import { createHash, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const DEFAULT_PROFILE_NAME = "AI";
const DEFAULT_LEASE_WAIT_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 10 * 60_000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_PROCESS_GRACE_MS = 5_000;
const COOKIE_SIDECARS = ["", "-journal", "-wal", "-shm"];
const YANDEX_COOKIE_DOMAINS = new Set(["yandex.ru", ".yandex.ru", "yandex.com", ".yandex.com"]);

export class WordstatSessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WordstatSessionError";
    this.code = code;
  }
}

function normalizedProfileName(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 100) {
    throw new WordstatSessionError("PROFILE_NAME_INVALID", "Chrome profile display name is invalid.");
  }
  return value.normalize("NFKC");
}

function safeRunId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(value)) {
    throw new WordstatSessionError("RUN_ID_INVALID", "Wordstat session run identifier is invalid.");
  }
  return value;
}

function directChild(root, directory) {
  if (typeof directory !== "string" || directory === "." || directory === ".." || basename(directory) !== directory) {
    throw new WordstatSessionError("PROFILE_METADATA_INVALID", "Chrome profile metadata is invalid.");
  }
  const candidate = resolve(root, directory);
  if (dirname(candidate) !== resolve(root)) {
    throw new WordstatSessionError("PROFILE_METADATA_INVALID", "Chrome profile metadata is invalid.");
  }
  return candidate;
}

function defaultChromeRoot(platform = process.platform) {
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  if (platform === "linux") return join(homedir(), ".config", "google-chrome");
  if (platform === "win32" && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data");
  throw new WordstatSessionError("PLATFORM_UNSUPPORTED", "Chrome profile discovery is unavailable on this platform.");
}

function outsideRepository(runtimeRoot) {
  const repository = resolve(process.cwd());
  const candidate = resolve(runtimeRoot);
  const relation = relative(repository, candidate);
  return relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation);
}

function leaseKey(chromeRoot, profileName) {
  return createHash("sha256")
    .update(resolve(chromeRoot))
    .update("\0")
    .update(normalizedProfileName(profileName))
    .digest("hex");
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function privateCopy(source, target) {
  await privateDirectory(dirname(target));
  await copyFile(source, target);
  await chmod(target, 0o600);
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function resolveChromeProfileByDisplayName(chromeRoot, profileName = DEFAULT_PROFILE_NAME) {
  const expected = normalizedProfileName(profileName);
  let payload;
  try {
    payload = JSON.parse(await readFile(join(resolve(chromeRoot), "Local State"), "utf8"));
  } catch {
    throw new WordstatSessionError("PROFILE_METADATA_UNAVAILABLE", "Chrome profile metadata is unavailable.");
  }
  const cache = payload?.profile?.info_cache;
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
    throw new WordstatSessionError("PROFILE_METADATA_INVALID", "Chrome profile metadata is invalid.");
  }
  const matches = Object.entries(cache).filter(([, profile]) => (
    profile && typeof profile === "object" && typeof profile.name === "string"
      && profile.name.normalize("NFKC") === expected
  ));
  if (matches.length === 0) {
    throw new WordstatSessionError("PROFILE_NOT_FOUND", "Configured Chrome profile was not found.");
  }
  if (matches.length > 1) {
    throw new WordstatSessionError("PROFILE_AMBIGUOUS", "Configured Chrome profile display name is not unique.");
  }
  directChild(chromeRoot, matches[0][0]);
  return matches[0][0];
}

async function sourceSignature(paths) {
  return Promise.all(paths.map(async (path) => {
    const value = await stat(path);
    return `${value.size}:${value.mtimeMs}`;
  }));
}

async function cookieFamily(profileRoot) {
  const candidates = [join(profileRoot, "Network", "Cookies"), join(profileRoot, "Cookies")];
  for (const base of candidates) {
    if (await pathExists(base)) return COOKIE_SIDECARS.map((suffix) => `${base}${suffix}`);
  }
  throw new WordstatSessionError("PROFILE_COOKIE_STORE_NOT_FOUND", "Chrome profile has no supported cookie store.");
}

async function existingCookieFamily(profileRoot) {
  const family = await cookieFamily(profileRoot);
  const existing = [];
  for (const path of family) if (await pathExists(path)) existing.push(path);
  return existing;
}

async function cloneProfileSnapshot({ chromeRoot, profileDirectory, clonePath, snapshotRetryDelayMs }) {
  const profileRoot = directChild(chromeRoot, profileDirectory);
  const localState = join(resolve(chromeRoot), "Local State");
  const preferences = join(profileRoot, "Preferences");

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const cookies = await existingCookieFamily(profileRoot);
      const sources = [localState, preferences, ...cookies];
      const before = await sourceSignature(sources);
      await rm(clonePath, { recursive: true, force: true });
      await privateDirectory(clonePath);
      for (const source of sources) {
        const profileRelative = relative(resolve(chromeRoot), source);
        if (profileRelative.startsWith("..") || isAbsolute(profileRelative)) {
          throw new WordstatSessionError("PROFILE_METADATA_INVALID", "Chrome profile metadata is invalid.");
        }
        await privateCopy(source, join(clonePath, profileRelative));
      }
      const afterCookies = await existingCookieFamily(profileRoot);
      const after = await sourceSignature(sources);
      if (cookies.length === afterCookies.length
        && cookies.every((value, index) => value === afterCookies[index])
        && before.every((value, index) => value === after[index])) return;
    } catch (error) {
      if (error instanceof WordstatSessionError) throw error;
      if (attempt === 2) {
        throw new WordstatSessionError("PROFILE_SNAPSHOT_INCONSISTENT", "Chrome profile snapshot could not be copied consistently.");
      }
    }
    await rm(clonePath, { recursive: true, force: true });
    if (attempt === 1) await sleep(snapshotRetryDelayMs);
  }
  throw new WordstatSessionError("PROFILE_SNAPSHOT_INCONSISTENT", "Chrome profile snapshot could not be copied consistently.");
}

async function recoverStaleLease({ leasePath, sessionsRoot, quarantineRoot, key, now, leaseTtlMs, isProcessAlive }) {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(join(leasePath, "lease.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
    const leaseStat = await stat(leasePath);
    if (now() - leaseStat.mtimeMs < leaseTtlMs) return false;
    metadata = null;
  }
  if (metadata && isProcessAlive(metadata.pid)) return false;
  for (const root of [sessionsRoot, quarantineRoot]) {
    const sessions = await readdir(root, { withFileTypes: true });
    for (const entry of sessions) {
      if (entry.isDirectory() && entry.name.startsWith(`${key}-`)) {
        await rm(join(root, entry.name), { recursive: true, force: true });
      }
    }
  }
  await rm(leasePath, { recursive: true, force: true });
  return true;
}

async function acquireLease(options) {
  const key = leaseKey(options.chromeRoot, options.profileName);
  const leasesRoot = join(options.runtimeRoot, "leases");
  const sessionsRoot = join(options.runtimeRoot, "sessions");
  const quarantineRoot = join(options.runtimeRoot, "quarantine");
  await Promise.all([privateDirectory(leasesRoot), privateDirectory(sessionsRoot), privateDirectory(quarantineRoot)]);
  const leasePath = join(leasesRoot, key);
  const deadline = options.now() + options.leaseWaitMs;

  for (;;) {
    let created = false;
    try {
      await mkdir(leasePath, { mode: 0o700 });
      created = true;
      const metadata = {
        run_id: options.runId,
        pid: options.processId,
        expires_at: new Date(options.now() + options.leaseTtlMs).toISOString(),
      };
      await writeFile(join(leasePath, "lease.json"), JSON.stringify(metadata), { mode: 0o600, flag: "wx" });
      return { key, leasePath, sessionsRoot, quarantineRoot };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        if (created) await rm(leasePath, { recursive: true, force: true });
        throw error;
      }
      await recoverStaleLease({
        leasePath,
        sessionsRoot,
        quarantineRoot,
        key,
        now: options.now,
        leaseTtlMs: options.leaseTtlMs,
        isProcessAlive: options.isProcessAlive,
      });
      if (options.now() >= deadline) {
        throw new WordstatSessionError("PROFILE_CLONE_BUSY", "Configured Chrome profile is already leased by another Wordstat run.");
      }
      await options.sleep(options.pollMs);
    }
  }
}

async function resourceIsRunning(resource) {
  return Boolean(await resource.isRunning());
}

async function stopCloneProcess(resource, graceMs) {
  if (!await resourceIsRunning(resource)) return;
  await resource.terminate("SIGTERM");
  await resource.waitForExit(graceMs);
  if (!await resourceIsRunning(resource)) return;
  await resource.terminate("SIGKILL");
  await resource.waitForExit(graceMs);
  if (await resourceIsRunning(resource)) {
    throw new WordstatSessionError("CLEANUP_FAILED", "Wordstat clone process did not exit.");
  }
}

export class WordstatProfileSession {
  #clonePath;
  #profileDirectory;
  #leasePath;
  #quarantineRoot;
  #leaseKey;
  #contexts = [];
  #processes = [];
  #cleanupStarted = false;
  #cleanupFinished = false;
  #processGraceMs;

  constructor({ clonePath, profileDirectory, leasePath, quarantineRoot, leaseKey, processGraceMs }) {
    this.#clonePath = clonePath;
    this.#profileDirectory = profileDirectory;
    this.#leasePath = leasePath;
    this.#quarantineRoot = quarantineRoot;
    this.#leaseKey = leaseKey;
    this.#processGraceMs = processGraceMs;
  }

  toJSON() {
    return { profile_name: DEFAULT_PROFILE_NAME, cleanup_status: this.#cleanupFinished ? "COMPLETE" : "PENDING" };
  }

  #assertOpen() {
    if (this.#cleanupStarted || this.#cleanupFinished) {
      throw new WordstatSessionError("SESSION_CLOSED", "Wordstat profile session is already closing.");
    }
  }

  browserLaunchTarget() {
    this.#assertOpen();
    return { userDataDir: this.#clonePath, profileDirectory: this.#profileDirectory };
  }

  registerPersistentContext(context) {
    this.#assertOpen();
    this.#registerContext(context, "PERSISTENT");
  }

  registerEphemeralContext(context) {
    this.#assertOpen();
    this.#registerContext(context, "EPHEMERAL");
  }

  #registerContext(context, kind) {
    if (!context || typeof context.close !== "function") {
      throw new WordstatSessionError("BROWSER_RESOURCE_INVALID", "Browser context cleanup contract is invalid.");
    }
    if (!this.#contexts.some((entry) => entry.resource === context)) {
      this.#contexts.push({ resource: context, kind, closed: false });
    }
  }

  registerCloneProcess(resource) {
    this.#assertOpen();
    if (!resource || typeof resource.isRunning !== "function" || typeof resource.terminate !== "function" || typeof resource.waitForExit !== "function") {
      throw new WordstatSessionError("BROWSER_RESOURCE_INVALID", "Clone process cleanup contract is invalid.");
    }
    if (!this.#processes.some((entry) => entry.resource === resource)) {
      this.#processes.push({ resource, stopped: false });
    }
  }

  async transferYandexCookies(persistentContext, ephemeralContext) {
    this.registerPersistentContext(persistentContext);
    this.registerEphemeralContext(ephemeralContext);
    if (typeof persistentContext.cookies !== "function" || typeof ephemeralContext.addCookies !== "function") {
      throw new WordstatSessionError("BROWSER_RESOURCE_INVALID", "Cookie transfer contract is invalid.");
    }
    if (this.#processes.length === 0) {
      throw new WordstatSessionError("BROWSER_RESOURCE_INVALID", "Clone process verification is required before cookie transfer.");
    }
    const cookies = await persistentContext.cookies();
    if (!Array.isArray(cookies)) {
      throw new WordstatSessionError("AUTH_COOKIE_TRANSFER_FAILED", "Chrome clone returned an invalid cookie set.");
    }
    const allowed = cookies.filter((cookie) => (
      cookie && typeof cookie === "object" && typeof cookie.domain === "string"
        && YANDEX_COOKIE_DOMAINS.has(cookie.domain.toLowerCase())
    ));
    try {
      await ephemeralContext.addCookies(allowed);
    } finally {
      allowed.splice(0, allowed.length);
      cookies.splice(0, cookies.length);
    }
    const persistent = this.#contexts.find((entry) => entry.resource === persistentContext);
    await persistentContext.close();
    if (persistent) persistent.closed = true;
    for (const process of this.#processes) {
      await stopCloneProcess(process.resource, this.#processGraceMs);
      process.stopped = true;
    }
  }

  async cleanup() {
    if (this.#cleanupFinished) return { cleanup_status: "COMPLETE" };
    if (this.#cleanupStarted) throw new WordstatSessionError("CLEANUP_FAILED", "Wordstat session cleanup is already running.");
    this.#cleanupStarted = true;
    const failures = [];
    let processesStopped = true;
    let cloneRemoved = false;

    for (const kind of ["EPHEMERAL", "PERSISTENT"]) {
      for (const context of [...this.#contexts].reverse()) {
        if (context.kind !== kind || context.closed) continue;
        try {
          await context.resource.close();
          context.closed = true;
        } catch (error) {
          failures.push(error);
        }
      }
    }
    for (const process of this.#processes) {
      try {
        if (!process.stopped) {
          await stopCloneProcess(process.resource, this.#processGraceMs);
          process.stopped = true;
        }
        if (await resourceIsRunning(process.resource)) {
          throw new WordstatSessionError("CLEANUP_FAILED", "Wordstat clone process remained active after cleanup.");
        }
      } catch (error) {
        processesStopped = false;
        failures.push(error);
      }
    }
    if (processesStopped) {
      try {
        await rm(this.#clonePath, { recursive: true, force: true });
        cloneRemoved = !await pathExists(this.#clonePath);
        if (!cloneRemoved) failures.push(new Error("clone remained"));
      } catch (error) {
        failures.push(error);
      }
    }
    if (cloneRemoved) {
      try {
        await rm(this.#leasePath, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    } else {
      try {
        if (await pathExists(this.#clonePath)) {
          await privateDirectory(this.#quarantineRoot);
          await rename(this.#clonePath, join(this.#quarantineRoot, `${this.#leaseKey}-failed-${randomUUID()}`));
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 0) {
      this.#cleanupFinished = true;
      return { cleanup_status: "COMPLETE" };
    }
    this.#cleanupStarted = false;
    throw new WordstatSessionError("CLEANUP_FAILED", "Wordstat session cleanup could not be confirmed.");
  }
}

export async function acquireWordstatProfileSession(input = {}) {
  const options = {
    runId: safeRunId(input.runId),
    profileName: normalizedProfileName(input.profileName ?? DEFAULT_PROFILE_NAME),
    chromeRoot: resolve(input.chromeRoot ?? defaultChromeRoot(input.platform)),
    runtimeRoot: resolve(input.runtimeRoot ?? join(tmpdir(), "mox-adv-wordstat")),
    leaseWaitMs: input.leaseWaitMs ?? DEFAULT_LEASE_WAIT_MS,
    leaseTtlMs: input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
    pollMs: input.pollMs ?? DEFAULT_POLL_MS,
    processGraceMs: input.processGraceMs ?? DEFAULT_PROCESS_GRACE_MS,
    processId: input.processId ?? process.pid,
    now: input.now ?? Date.now,
    sleep: input.sleep ?? sleep,
    isProcessAlive: input.isProcessAlive ?? processIsAlive,
    randomId: input.randomId ?? randomUUID,
    snapshotRetryDelayMs: input.snapshotRetryDelayMs ?? 50,
  };
  if (options.profileName !== DEFAULT_PROFILE_NAME) {
    throw new WordstatSessionError("PROFILE_NAME_INVALID", "Wordstat collection is restricted to the configured AI profile.");
  }
  if (!outsideRepository(options.runtimeRoot)) {
    throw new WordstatSessionError("RUNTIME_LOCATION_UNSAFE", "Wordstat runtime directory must be outside the repository.");
  }
  const sessionId = String(options.randomId());
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(sessionId)) {
    throw new WordstatSessionError("SESSION_ID_INVALID", "Wordstat session identifier is invalid.");
  }
  await privateDirectory(options.runtimeRoot);
  const lease = await acquireLease(options);
  const clonePath = join(lease.sessionsRoot, `${lease.key}-${sessionId}`);
  try {
    const profileDirectory = await resolveChromeProfileByDisplayName(options.chromeRoot, options.profileName);
    await cloneProfileSnapshot({
      chromeRoot: options.chromeRoot,
      profileDirectory,
      clonePath,
      snapshotRetryDelayMs: options.snapshotRetryDelayMs,
    });
    return new WordstatProfileSession({
      clonePath,
      profileDirectory,
      leasePath: lease.leasePath,
      quarantineRoot: lease.quarantineRoot,
      leaseKey: lease.key,
      processGraceMs: options.processGraceMs,
    });
  } catch (error) {
    try {
      await rm(clonePath, { recursive: true, force: true });
      await rm(lease.leasePath, { recursive: true, force: true });
    } catch {
      throw new WordstatSessionError("CLEANUP_FAILED", "Failed Wordstat session setup could not be cleaned.");
    }
    throw error;
  }
}

export async function withWordstatProfileSession(options, work) {
  if (typeof work !== "function") {
    throw new WordstatSessionError("SESSION_WORK_INVALID", "Wordstat session work callback is required.");
  }
  const session = await acquireWordstatProfileSession(options);
  let result;
  let workError;
  let removeAbortListener = () => {};
  try {
    if (options?.signal?.aborted) {
      throw new WordstatSessionError("STOPPED", "Wordstat session was stopped before collection.");
    }
    const workPromise = Promise.resolve().then(() => work(session, options?.signal));
    if (options?.signal) {
      const abortPromise = new Promise((_, reject) => {
        const stop = () => reject(new WordstatSessionError("STOPPED", "Wordstat session was stopped during collection."));
        options.signal.addEventListener("abort", stop, { once: true });
        removeAbortListener = () => options.signal.removeEventListener("abort", stop);
      });
      result = await Promise.race([workPromise, abortPromise]);
    } else {
      result = await workPromise;
    }
  } catch (error) {
    workError = error;
  } finally {
    removeAbortListener();
  }
  await session.cleanup();
  if (workError) throw workError;
  return result;
}
