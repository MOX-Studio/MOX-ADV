import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const ownerSource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");

test("owner UI receives only material business unknowns instead of landing diagnostics", () => {
  assert.match(clientSource, /СУЩЕСТВЕННЫЕ НЕИЗВЕСТНЫЕ/u);
  assert.match(clientSource, /projection\.materialUnknowns/u);
  assert.doesNotMatch(clientSource, /Lighthouse|axe-core|tool_versions|landing_advisory_run/u);
  assert.doesNotMatch(clientSource, /snapshot_id|fingerprint|schema_version/u);
});

test("full landing evidence stays in internal diagnostics rather than owner projection", () => {
  assert.match(ownerSource, /async diagnostics\(ownerKey: string\)/u);
  assert.doesNotMatch(ownerSource, /landingAdvisoryRun:/u);
  assert.doesNotMatch(clientSource, /LandingAdvisoryPanel|landingAdvisoryPriorities/u);
});
