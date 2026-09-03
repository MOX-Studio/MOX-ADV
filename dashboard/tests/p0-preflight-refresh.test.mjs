import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { directPreflightRefreshState } from "../lib/p0-preflight-refresh.ts";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");

const NOW = Date.parse("2026-08-22T18:42:00.000Z");

test("schedules bounded automatic refresh while the Direct audit is pending", () => {
  assert.deepEqual(
    directPreflightRefreshState({ status: "PENDING", next_retry_at: "2026-08-22T18:42:10.000Z" }, NOW),
    { pending: true, delay_ms: 10_250 },
  );
  assert.deepEqual(
    directPreflightRefreshState({ status: "PENDING", next_retry_at: "2026-08-22T18:41:59.000Z" }, NOW),
    { pending: true, delay_ms: 1_000 },
  );
  assert.deepEqual(
    directPreflightRefreshState({ status: "PENDING", next_retry_at: "2026-08-22T18:43:00.000Z" }, NOW),
    { pending: true, delay_ms: 15_000 },
  );
});

test("does not poll terminal Direct audit outcomes", () => {
  assert.deepEqual(
    directPreflightRefreshState({ status: "PARTIAL", next_retry_at: null }, NOW),
    { pending: false, delay_ms: null },
  );
  assert.deepEqual(
    directPreflightRefreshState({ status: "COMPLETE", next_retry_at: null }, NOW),
    { pending: false, delay_ms: null },
  );
});

test("owner page refreshes agent-owned continuation without a polling control", () => {
  const effect = clientSource.match(
    /useEffect\(\(\) => \{\n {4}if \(!projection[\s\S]*?\n {2}\}, \[projection\]\);/u,
  )?.[0];
  assert.ok(effect, "owner continuation refresh must stay wired to business projection state");
  assert.match(effect, /request\("\/api\/p0"\)/u);
  assert.doesNotMatch(clientSource, /Проверить запланированный элемент|Повторить polling/u);
});
