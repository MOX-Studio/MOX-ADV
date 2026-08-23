import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const productionSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const prototypeSource = await readFile(new URL("../app/prototype/prd-149/PrototypeClient.tsx", import.meta.url), "utf8");

const sharedVisualClasses = [
  "prototype",
  "topbar",
  "brand",
  "activeNav",
  "connectionState",
  "pageA",
  "hero",
  "heroOutcome",
  "stageNav",
  "stageNavhorizontal",
  "ownerWorkspace",
  "agentRail",
  "agentMessage",
  "railSnapshot",
  "automationMap",
  "safetyCard",
  "artifact",
];

test("production Dashboard uses the accepted PRD-149 visual layer instead of a parallel reskin", () => {
  assert.match(productionSource, /import styles from "\.\/prototype\/prd-149\/prototype\.module\.css"/u);
  for (const className of sharedVisualClasses) {
    assert.match(prototypeSource, new RegExp(`styles\\.${className}\\b`, "u"));
    assert.match(productionSource, new RegExp(`styles\\.${className}\\b`, "u"));
  }
  assert.doesNotMatch(productionSource, /owner-topbar|owner-hero|owner-workspace|owner-agent-rail/u);
});

test("production keeps the accepted Goal-only hero and never renders prototype labeling", () => {
  assert.match(productionSource, /projection\.journey\.currentStage === "goal"[^\n]*<Hero/u);
  assert.doesNotMatch(productionSource, /prototypeFlag|ПРОТОТИП · ЦЕЛЕВОЕ СОСТОЯНИЕ/u);
});
