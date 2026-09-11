import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directPreparationIssues } from "../lib/direct-preparation-check.ts";
import { inspectDirectImage, verifyLocalFormationAssets } from "../scripts/direct-asset-files.mjs";

function portfolio() { return { campaigns: [{ bidding: { type: "MAX_CLICKS" }, weekly_budget_rub: 300, groups: [{ ads: [{ image_ids: ["image"] }] }] }], images: [{ id: "image", url: "/campaign-assets/image.png", asset: { format: "PNG", width: 1200, height: 675, bytes: 1000, sha256: "sha256:" + "0".repeat(64) } }] }; }

test("Direct preparation rejects under-minimum budgets without inventing a new total", () => {
  const p = portfolio(); assert.deepEqual(directPreparationIssues(p), []);
  p.campaigns[0].weekly_budget_rub = 250;
  assert.equal(directPreparationIssues(p)[0].code, "DIRECT_WEEKLY_BUDGET_BELOW_MINIMUM");
  assert.equal(p.campaigns[0].weekly_budget_rub, 250);
});
test("new responsive groups allow three objects and reject four without imposing a portfolio quota", () => {
  const p = portfolio();const ad = p.campaigns[0].groups[0].ads[0];
  p.campaigns[0].groups[0].ads = Array.from({ length: 3 }, () => structuredClone(ad));
  assert.deepEqual(directPreparationIssues(p), []);
  p.campaigns[0].groups[0].ads.push(structuredClone(ad));
  assert.ok(directPreparationIssues(p).some(i => i.code === "DIRECT_RESPONSIVE_ADS_PER_GROUP_EXCEEDED"));
  p.campaigns[0].groups = Array.from({ length: 50 }, () => ({ ads: [structuredClone(ad)] }));
  assert.deepEqual(directPreparationIssues(p), []);
});
test("Direct images require a raster file and actual compatible aspect ratio", () => {
  for (const [changes, code] of [[{ width: 1200, height: 628 }, "DIRECT_IMAGE_DIMENSIONS_INVALID"], [{ width: 449, height: 449 }, "DIRECT_IMAGE_DIMENSIONS_INVALID"], [{ bytes: 10_000_001 }, "DIRECT_IMAGE_ASSET_INVALID"]]) {
    const p = portfolio(); Object.assign(p.images[0].asset, changes); assert.ok(directPreparationIssues(p).some(i => i.code === code));
  }
  const p = portfolio(); p.images[0].url = "/campaign-assets/source.svg"; delete p.images[0].asset;
  assert.ok(directPreparationIssues(p).some(i => i.code === "DIRECT_IMAGE_FORMAT_UNSUPPORTED"));
  assert.ok(directPreparationIssues(p).some(i => i.code === "DIRECT_IMAGE_ASSET_UNVERIFIED"));
  for (const [width, height] of [[450, 450], [1200, 900], [900, 1200], [1080, 607], [5000, 2812]]) {
    const valid = portfolio(); Object.assign(valid.images[0].asset, { width, height }); assert.deepEqual(directPreparationIssues(valid), []);
  }
});
test("local packaging checks file bytes and rejects renamed or changed assets", async t => {
  const dir = await mkdtemp(join(tmpdir(), "direct-assets-test-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "campaign-assets")); const file = join(dir, "campaign-assets/image.png");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=", "base64");
  await writeFile(file, png); const asset = await inspectDirectImage(file);
  assert.equal(asset.format, "PNG"); assert.equal(asset.width, 1); assert.equal(asset.height, 1);
  const p = portfolio(); p.images[0].asset = asset; await verifyLocalFormationAssets(p, dir);
  await writeFile(file, Buffer.concat([png, Buffer.from("changed")]));
  await assert.rejects(verifyLocalFormationAssets(p, dir), /не совпадает/);
  await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"></svg>');
  await assert.rejects(inspectDirectImage(file), /фактический PNG/);
});
