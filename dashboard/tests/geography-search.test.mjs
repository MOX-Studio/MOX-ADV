import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createGeographySearch, parseGeoRegions, readDirectGeoRegions, searchGeoRegions } from "../lib/geography-search.ts";

const payload = { result: { GeoRegions: [
  { GeoRegionId: 10000, GeoRegionName: "Земля", GeoRegionType: "World", ParentId: 0 },
  { GeoRegionId: 225, GeoRegionName: "Россия", GeoRegionType: "Country", ParentId: 10000 },
  { GeoRegionId: 1, GeoRegionName: "Москва и область", GeoRegionType: "Administrative area", ParentId: 225 },
  { GeoRegionId: 213, GeoRegionName: "Москва", GeoRegionType: "City", ParentId: 1 },
  { GeoRegionId: 2, GeoRegionName: "Санкт-Петербург", GeoRegionType: "City", ParentId: 225 },
  { GeoRegionId: 54, GeoRegionName: "Екатеринбург", GeoRegionType: "City", ParentId: 225 },
  { GeoRegionId: 39, GeoRegionName: "Ростов-на-Дону", GeoRegionType: "City", ParentId: 225 },
  { GeoRegionId: 96, GeoRegionName: "Германия", GeoRegionType: "Country", ParentId: 10000 },
  { GeoRegionId: 177, GeoRegionName: "Берлин", GeoRegionType: "City", ParentId: 96 },
] } };

test("geography search starts at two characters, ranks exact matches and includes parent context", () => {
  const regions = parseGeoRegions(payload);
  assert.deepEqual(searchGeoRegions(regions, "М"), []);
  assert.deepEqual(searchGeoRegions(regions, "  "), []);
  assert.deepEqual(searchGeoRegions(regions, "Ро").map((r) => r.name), ["Ростов-на-Дону"]);
  assert.deepEqual(searchGeoRegions(regions, "Мо").map((r) => r.name), ["Москва"]);
  assert.equal(searchGeoRegions(regions, "Москва")[0].id, 213);
  assert.equal(searchGeoRegions(regions, "Мо")[0].context, "Москва и область · Россия");
  assert.equal(searchGeoRegions(regions, "спб")[0].name, "Санкт-Петербург");
  assert.deepEqual(searchGeoRegions(regions, "РФ"), []);
  assert.deepEqual(searchGeoRegions(regions, "Бер"), []);
  assert.deepEqual(searchGeoRegions(regions, "Москва и область"), []);
  assert.equal(searchGeoRegions(regions, "Ек")[0].name, "Екатеринбург");
  assert.deepEqual(searchGeoRegions(regions, "неттакогоместа"), []);
});

test("the dictionary is read once for concurrent searches, expires and never fetches for one character", async () => {
  let calls = 0;
  let now = 0;
  const search = createGeographySearch(async () => { calls++; return payload; }, () => now, 100);
  assert.deepEqual(await search("М"), []);
  assert.equal(calls, 0);
  const results = await Promise.all([search("Мо"), search("Ро"), search("Сп")]);
  assert.ok(results.every((options) => options.length));
  assert.equal(calls, 1);
  now = 101;
  await search("Ро");
  assert.equal(calls, 2);
});

test("a failed dictionary is not cached as an empty successful search", async () => {
  let calls = 0;
  const search = createGeographySearch(async () => { if (++calls === 1) throw new Error("offline"); return payload; });
  await assert.rejects(search("Ро"));
  assert.equal((await search("Ро"))[0].name, "Ростов-на-Дону");
  assert.equal(calls, 2);
  for (const input of [{ error: { detail: "secret" } }, { result: { GeoRegions: [] } }, { result: { GeoRegions: [{ GeoRegionId: "fabricated", GeoRegionName: "x" }] } }]) assert.throws(() => parseGeoRegions(input));
});

test("provider access is only the official read-only GeoRegions dictionary and does not send the user's query", async () => {
  let request;
  const result = await readDirectGeoRegions({ token: "test-only-token", account: "test-account" }, async (url, init) => {
    request = { url, init }; return Response.json(payload);
  });
  assert.deepEqual(result, payload);
  assert.equal(request.url, "https://api.direct.yandex.com/json/v501/dictionaries");
  assert.deepEqual(JSON.parse(request.init.body), { method: "get", params: { DictionaryNames: ["GeoRegions"] } });
  assert.equal(request.init.headers["Accept-Language"], "ru");
  await assert.rejects(readDirectGeoRegions({ token: "", account: "" }, async () => { throw new Error("Must not fetch"); }), /временно недоступен/);
});

test("autocomplete exposes an accessible named combobox and retains the exact persisted geography", async (t) => {
  const url = new URL(`../app/.geography-test-${process.pid}.mjs`, import.meta.url);
  const source = (await readFile(new URL("../app/GeographyAutocomplete.tsx", import.meta.url), "utf8"))
    .replace('import styles from "./geography-autocomplete.module.css";', 'const styles = new Proxy({}, { get: (_, key) => key });');
  await writeFile(url, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(url, { force: true }));
  const Component = (await import(url.href)).default;
  const html = renderToStaticMarkup(React.createElement(Component, { defaultValue: "Россия, кроме Москвы" }));
  assert.match(html, /role="combobox"/);
  assert.match(html, /name="customer_geography"/);
  assert.match(html, /value="Россия, кроме Москвы"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Определяется владельцем|место проведения/u);
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) assert.ok(source.includes(`"${key}"`));
  assert.match(source, /query\.length < 2/);
  assert.match(source, /controller\.abort\(\)/);
});
