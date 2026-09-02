import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCampaignNames,
  hasDuplicateCampaignName,
  isCampaignNameWithGeography,
  isLegacySearchName,
  resolveCampaignRegionId,
} from "../lib/campaign-draft.ts";

test("keeps campaign name and geography as separate meanings", () => {
  assert.deepEqual(buildCampaignNames("ИННОПРОМ", "Россия", "Заявка на участие"), {
    campaignName: "ИННОПРОМ",
    groupName: "Заявка на участие",
  });
  assert.equal(
    buildCampaignNames("ИННОПРОМ", "Москва", "Заявка на участие").campaignName,
    "ИННОПРОМ",
  );
});

test("recognizes legacy compound campaign names", () => {
  assert.equal(isLegacySearchName("ИННОПРОМ · Поиск"), true);
  assert.equal(isLegacySearchName("ИННОПРОМ · Россия"), false);
  assert.equal(isCampaignNameWithGeography("ИННОПРОМ · Россия", "Россия"), true);
  assert.equal(isCampaignNameWithGeography("ИННОПРОМ", "Россия"), false);
});

test("resolves one unambiguous supported region from a bounded Strategy explanation", () => {
  assert.equal(resolveCampaignRegionId("Россия"), 225);
  assert.equal(resolveCampaignRegionId("Россия; на старте без более узкого регионального ограничения"), 225);
  assert.throws(() => resolveCampaignRegionId("Москва и Россия"), /неоднозначна/u);
  assert.throws(() => resolveCampaignRegionId("Екатеринбург"), /не поддерживается/u);
});

test("blocks a duplicate active campaign name independent of case", () => {
  assert.equal(
    hasDuplicateCampaignName(["ИННОПРОМ · Россия", "Другая кампания"], "иннопром · россия"),
    true,
  );
  assert.equal(hasDuplicateCampaignName(["Другая кампания"], "ИННОПРОМ · Россия"), false);
});
