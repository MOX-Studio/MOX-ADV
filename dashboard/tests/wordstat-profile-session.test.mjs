import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WordstatSessionError,
  acquireWordstatProfileSession,
  resolveChromeProfileByDisplayName,
  withWordstatProfileSession,
} from "../scripts/wordstat-profile-session.mjs";

async function chromeFixture() {
  const root = await mkdtemp(join(tmpdir(), "mox-wordstat-source-"));
  const runtimeRoot = await mkdtemp(join(tmpdir(), "mox-wordstat-runtime-"));
  const profileDirectory = "Renamed Profile Directory";
  await mkdir(join(root, profileDirectory, "Network"), { recursive: true });
  await mkdir(join(root, profileDirectory, "Local Storage"), { recursive: true });
  await writeFile(join(root, "Local State"), JSON.stringify({
    profile: {
      info_cache: {
        "Profile 1": { name: "Other" },
        [profileDirectory]: { name: "ＡＩ" },
      },
    },
  }));
  await writeFile(join(root, profileDirectory, "Preferences"), "preferences");
  await writeFile(join(root, profileDirectory, "Network", "Cookies"), "cookie-database");
  await writeFile(join(root, profileDirectory, "Network", "Cookies-wal"), "cookie-wal");
  await writeFile(join(root, profileDirectory, "History"), "must-not-copy");
  await writeFile(join(root, profileDirectory, "Local Storage", "secret"), "must-not-copy");
  return { root, runtimeRoot, profileDirectory };
}

async function tree(root, relative = "") {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const next = join(relative, entry.name);
    result.push(next);
    if (entry.isDirectory()) result.push(...await tree(root, next));
  }
  return result.sort();
}

async function digestTree(root) {
  const hash = createHash("sha256");
  for (const relative of await tree(root)) {
    const value = await stat(join(root, relative));
    hash.update(relative).update(String(value.mode & 0o777));
    if (value.isFile()) hash.update(await readFile(join(root, relative)));
  }
  return hash.digest("hex");
}

function fakeContext({ cookies = [], closeEvents, label, rejectClose = false } = {}) {
  return {
    async cookies() { return structuredClone(cookies); },
    async addCookies(value) { this.added = structuredClone(value); },
    async close() {
      closeEvents?.push(label);
      if (rejectClose) throw new Error("close failed");
    },
  };
}

function fakeProcess({ events, survivesKill = false } = {}) {
  let running = true;
  return {
    async isRunning() { return running; },
    async terminate(signal) {
      events?.push(signal);
      if (signal === "SIGKILL" && !survivesKill) running = false;
    },
    async waitForExit() {},
  };
}

test("selects Chrome profile by normalized display name and clones only the approved files", async (t) => {
  const fixture = await chromeFixture();
  t.after(() => Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.runtimeRoot, { recursive: true, force: true })]));
  const sourceDigest = await digestTree(fixture.root);

  assert.equal(await resolveChromeProfileByDisplayName(fixture.root, "AI"), fixture.profileDirectory);
  const session = await acquireWordstatProfileSession({
    runId: "run-clone-1",
    profileName: "AI",
    chromeRoot: fixture.root,
    runtimeRoot: fixture.runtimeRoot,
    randomId: () => "session-one",
  });
  const target = session.browserLaunchTarget();

  assert.equal(target.profileDirectory, fixture.profileDirectory);
  assert.deepEqual(await tree(target.userDataDir), [
    "Local State",
    fixture.profileDirectory,
    join(fixture.profileDirectory, "Network"),
    join(fixture.profileDirectory, "Network", "Cookies"),
    join(fixture.profileDirectory, "Network", "Cookies-wal"),
    join(fixture.profileDirectory, "Preferences"),
  ].sort());
  assert.equal((await stat(target.userDataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(target.userDataDir, fixture.profileDirectory, "Network", "Cookies"))).mode & 0o777, 0o600);
  assert.equal(await digestTree(fixture.root), sourceDigest);
  const [leaseDirectory] = await readdir(join(fixture.runtimeRoot, "leases"));
  const lease = JSON.parse(await readFile(join(fixture.runtimeRoot, "leases", leaseDirectory, "lease.json"), "utf8"));
  assert.deepEqual(Object.keys(lease).sort(), ["expires_at", "pid", "run_id"]);
  assert.deepEqual(JSON.parse(JSON.stringify(session)), { profile_name: "AI", cleanup_status: "PENDING" });

  await session.cleanup();
  await assert.rejects(stat(target.userDataDir), { code: "ENOENT" });
  assert.deepEqual(await readdir(join(fixture.runtimeRoot, "leases")), []);
});

test("uses an atomic profile lease and does not reveal profile paths in a busy error", async (t) => {
  const fixture = await chromeFixture();
  t.after(() => Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.runtimeRoot, { recursive: true, force: true })]));
  const first = await acquireWordstatProfileSession({
    runId: "run-first",
    profileName: "AI",
    chromeRoot: fixture.root,
    runtimeRoot: fixture.runtimeRoot,
    randomId: () => "first",
  });

  await assert.rejects(
    acquireWordstatProfileSession({
      runId: "run-second",
      profileName: "AI",
      chromeRoot: fixture.root,
      runtimeRoot: fixture.runtimeRoot,
      leaseWaitMs: 5,
      pollMs: 1,
      randomId: () => "second",
    }),
    (error) => {
      assert.equal(error instanceof WordstatSessionError, true);
      assert.equal(error.code, "PROFILE_CLONE_BUSY");
      assert.equal(error.message.includes(fixture.root), false);
      assert.equal(error.message.includes(fixture.profileDirectory), false);
      return true;
    },
  );
  await first.cleanup();
});

test("moves only Yandex cookies to an ephemeral context and closes clone Chrome before collection", async (t) => {
  const fixture = await chromeFixture();
  t.after(() => Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.runtimeRoot, { recursive: true, force: true })]));
  const events = [];
  const persistent = fakeContext({
    cookies: [
      { name: "session", value: "never-log-this", domain: ".yandex.ru", path: "/" },
      { name: "com", value: "also-secret", domain: "yandex.com", path: "/" },
      { name: "foreign", value: "reject-me", domain: ".example.com", path: "/" },
      { name: "lookalike", value: "reject-me-too", domain: "notyandex.ru", path: "/" },
    ],
    closeEvents: events,
    label: "persistent-close",
  });
  const ephemeral = fakeContext({ closeEvents: events, label: "ephemeral-close" });
  const process = fakeProcess({ events });

  await withWordstatProfileSession({
    runId: "run-cookies",
    profileName: "AI",
    chromeRoot: fixture.root,
    runtimeRoot: fixture.runtimeRoot,
    randomId: () => "cookies",
  }, async (session) => {
    session.registerPersistentContext(persistent);
    session.registerEphemeralContext(ephemeral);
    session.registerCloneProcess(process);
    await session.transferYandexCookies(persistent, ephemeral);
    assert.deepEqual(ephemeral.added.map((cookie) => cookie.domain), [".yandex.ru", "yandex.com"]);
    assert.deepEqual(events, ["persistent-close", "SIGTERM", "SIGKILL"]);
    return "COMPLETE";
  });

  assert.deepEqual(events, ["persistent-close", "SIGTERM", "SIGKILL", "ephemeral-close"]);
});

for (const failure of [
  new Error("collector failed"),
  Object.assign(new Error("surface timed out"), { code: "LOAD_TIMEOUT" }),
  Object.assign(new Error("run stopped"), { code: "STOPPED" }),
]) {
  test(`cleans contexts, process, clone and lease when work exits with ${failure.code ?? "ERROR"}`, async (t) => {
    const fixture = await chromeFixture();
    t.after(() => Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.runtimeRoot, { recursive: true, force: true })]));
    const events = [];
    let clonePath;

    await assert.rejects(withWordstatProfileSession({
      runId: `run-${failure.code ?? "error"}`,
      profileName: "AI",
      chromeRoot: fixture.root,
      runtimeRoot: fixture.runtimeRoot,
      randomId: () => `failure-${failure.code ?? "error"}`,
    }, async (session) => {
      clonePath = session.browserLaunchTarget().userDataDir;
      session.registerEphemeralContext(fakeContext({ closeEvents: events, label: "ephemeral-close" }));
      session.registerPersistentContext(fakeContext({ closeEvents: events, label: "persistent-close" }));
      session.registerCloneProcess(fakeProcess({ events }));
      throw failure;
    }), (error) => error === failure);

    assert.deepEqual(events, ["ephemeral-close", "persistent-close", "SIGTERM", "SIGKILL"]);
    await assert.rejects(stat(clonePath), { code: "ENOENT" });
    assert.deepEqual(await readdir(join(fixture.runtimeRoot, "leases")), []);
  });
}

test("an active stop signal closes registered resources and removes the clone", async (t) => {
  const fixture = await chromeFixture();
  t.after(() => Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.runtimeRoot, { recursive: true, force: true })]));
  const controller = new AbortController();
  const events = [];
  let clonePath;

  const run = withWordstatProfileSession({
    runId: "run-active-stop",
    profileName: "AI",
    chromeRoot: fixture.root,
    runtimeRoot: fixture.runtimeRoot,
    randomId: () => "active-stop",
    signal: controller.signal,
  }, async (session, signal) => {
    clonePath = session.browserLaunchTarget().userDataDir;
    session.registerEphemeralContext(fakeContext({ closeEvents: events, label: "ephemeral-close" }));
    session.registerCloneProcess(fakeProcess({ events }));
    setTimeout(() => controller.abort(), 1);
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  });

  await assert.rejects(run, (error) => error instanceof WordstatSessionError && error.code === "STOPPED");
  assert.deepEqual(events, ["ephemeral-close", "SIGTERM", "SIGKILL"]);
  await assert.rejects(stat(clonePath), { code: "ENOENT" });
  assert.deepEqual(await readdir(join(fixture.runtimeRoot, "leases")), []);
});

test("continues process and clone cleanup after a context close error but blocks COMPLETE", async (t) => {
  const fixture = await chromeFixture();
  t.after(() => Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.runtimeRoot, { recursive: true, force: true })]));
  const events = [];
  let clonePath;

  await assert.rejects(withWordstatProfileSession({
    runId: "run-context-close-failure",
    profileName: "AI",
    chromeRoot: fixture.root,
    runtimeRoot: fixture.runtimeRoot,
    randomId: () => "context-close-failure",
  }, async (session) => {
    clonePath = session.browserLaunchTarget().userDataDir;
    session.registerEphemeralContext(fakeContext({ closeEvents: events, label: "ephemeral-close", rejectClose: true }));
    session.registerCloneProcess(fakeProcess({ events }));
    return { status: "COMPLETE" };
  }), (error) => error instanceof WordstatSessionError && error.code === "CLEANUP_FAILED");

  assert.deepEqual(events, ["ephemeral-close", "SIGTERM", "SIGKILL"]);
  await assert.rejects(stat(clonePath), { code: "ENOENT" });
  assert.deepEqual(await readdir(join(fixture.runtimeRoot, "leases")), []);
});

test("cleanup failure blocks a successful result and preserves the lease", async (t) => {
  const fixture = await chromeFixture();
  t.after(() => Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.runtimeRoot, { recursive: true, force: true })]));
  const process = fakeProcess({ survivesKill: true });

  await assert.rejects(withWordstatProfileSession({
    runId: "run-cleanup-failure",
    profileName: "AI",
    chromeRoot: fixture.root,
    runtimeRoot: fixture.runtimeRoot,
    randomId: () => "cleanup-failure",
  }, async (session) => {
    session.registerCloneProcess(process);
    return { status: "COMPLETE" };
  }), (error) => {
    assert.equal(error instanceof WordstatSessionError, true);
    assert.equal(error.code, "CLEANUP_FAILED");
    return true;
  });

  assert.equal((await readdir(join(fixture.runtimeRoot, "leases"))).length, 1);
});
