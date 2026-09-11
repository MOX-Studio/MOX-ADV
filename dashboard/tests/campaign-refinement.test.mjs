import assert from "node:assert/strict";
import test from "node:test";
import { verifyCampaignRevision } from "../lib/campaign-refinement.ts";

test("reordering or repeating responsive variants cannot discharge a copy defect", async () => {
  // Isolated workflow fixture: these strings are not advertising evidence.
  const draft = { campaigns: [{ groups: [{ id: "G1", ads: [{ id: "A1", titles: ["First title", "Second title"], texts: ["First body", "Second body"], extensions: { callouts: [], sitelinks: [] } }] }] }], images: [], segments: [] };
  const previous = { draft, revision_request: { issues: [{ id: "WEAK-COPY", ad_ids: ["A1"], scope: "COPY", problem: "No useful buyer action", required_change: "Change the message", research_required: false }] } };
  const candidate = structuredClone(draft), ad = candidate.campaigns[0].groups[0].ads[0];
  ad.titles.reverse(); ad.texts.reverse();
  assert.equal((await verifyCampaignRevision(previous, candidate, {}))[0].code, "REFINEMENT_DEFECT_UNCHANGED");
  ad.titles.push("First title!");
  assert.equal((await verifyCampaignRevision(previous, candidate, {}))[0].code, "REFINEMENT_DEFECT_UNCHANGED");
  ad.texts[0] = "A materially different body";
  assert.deepEqual(await verifyCampaignRevision(previous, candidate, {}), []);
});
