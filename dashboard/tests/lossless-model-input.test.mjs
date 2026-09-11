import assert from "node:assert/strict";
import test from "node:test";
import { packLosslessModelInput, unpackLosslessModelInput, losslessModelInputText } from "../lib/lossless-model-input.ts";

test("tabular observations and exact repeated blocks retain all rows, conditions and evidence references", () => {
  const observations = Array.from({ length: 120 }, (_, index) => ({
    evidence_id: `wordstat-observation:${String(index).padStart(64, "0")}`,
    phrase: `участие компании в промышленной выставке ${index}`,
    observed_count: index === 0 ? 0 : index,
    qualified_leads: null,
    observed_at: "2026-09-07T08:37:13.000Z",
    attribution: "UNKNOWN",
    commercial_effectiveness: "UNMEASURED",
    limitations: ["Frequency is not a lead count or predicted campaign result."],
  }));
  const input = {
    observations,
    same_observations: structuredClone(observations),
    strategy_evidence: { observations: structuredClone(observations) },
    promise: "Стоимость от 100 рублей. Только при соблюдении условий. Не гарантируем продажи.",
    scalar_values: [0, null, false, "", "001", "9007199254740993"],
  };
  const original = structuredClone(input);
  const packed = packLosslessModelInput(input);
  assert.deepEqual(unpackLosslessModelInput(JSON.parse(JSON.stringify(packed))), original);
  assert.deepEqual(input, original);
  assert.ok(Object.keys(packed.shared).length > 0);
  const result = losslessModelInputText(input);
  assert.equal(result.packed, true);
  assert.ok(result.text.length < JSON.stringify(input).length * 0.4);
  assert.match(result.text, /Только при соблюдении условий/u);
  assert.doesNotMatch(result.text, /omitted_items|compacted/u);
});

test("source objects cannot impersonate encoding markers, and missing fields stay distinct from null", () => {
  const input = {
    collision: { $mox: "ref", id: "missing-reference", nested: { $mox: "table", columns: ["a"], rows: [[4]] } },
    heterogeneous: [{ a: 1 }, { a: 2, b: null }, { a: 3 }, { a: 4, b: false }],
    ordered: ["second", "first", "second"],
    special_keys: JSON.parse('{"__proto__":{"not_a_prototype":true},"constructor":"source value"}'),
  };
  assert.deepEqual(unpackLosslessModelInput(JSON.parse(JSON.stringify(packLosslessModelInput(input)))), input);
  assert.equal({}.not_a_prototype, undefined);
});

test("small or nonrepetitive inputs retain their original ordinary JSON representation", () => {
  const input = { evidence_refs: ["source:1"], value: "An exact supported fact", outcome: null };
  assert.deepEqual(losslessModelInputText(input), { text: JSON.stringify(input), packed: false });
});
