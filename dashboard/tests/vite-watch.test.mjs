import assert from "node:assert/strict";
import test from "node:test";

import { devServerConfig } from "../lib/dev-server.ts";

test("dev server ignores mutable Wrangler runtime state", () => {
  for (const seatbeltSandbox of [false, true]) {
    const config = devServerConfig(seatbeltSandbox);
    assert.ok(config?.watch?.ignored?.includes("**/.wrangler/**"));
  }
});

test("stable local pipeline checks ignore environment and generated evidence changes while keeping Vite transport", () => {
  for (const sandbox of [false, true]) {
    assert.deepEqual(devServerConfig(sandbox, true).watch.ignored, ["**/.wrangler/**", "**/.env*", "**/*.md", "**/*.log"]);
    assert.ok(devServerConfig(sandbox).watch);
  }
});

test('console forwarding stays disabled to prevent recursive transport errors on dev-server disconnect', () => {
  for (const stable of [false, true]) assert.equal(devServerConfig(false, stable).forwardConsole, false);
});
