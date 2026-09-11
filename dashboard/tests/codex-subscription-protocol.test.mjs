import assert from "node:assert/strict";
import test from "node:test";
import { chooseCodexOutputPlan, resolveCodexOutputPlan, parseCodexFinalOutput, CODEX_LEGACY_OUTPUT, CODEX_NATIVE_OUTPUT } from "../lib/codex-subscription-protocol.mjs";

const closed = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const tool = (schema) => ({ name: "p0_submit_analysis", input_schema: schema });
const choose = (schema) => chooseCodexOutputPlan([tool(schema)]);

test("native arguments preserve nested null, false, zero and arrays with sole-tool binding", () => {
  const plan = choose(closed({
    ready: { type: "boolean" }, missing: { type: ["string", "null"] },
    nested: closed({ count: { type: "integer" }, rows: { type: "array", items: closed({ value: { type: ["number", "null"] } }) } }),
  }));
  const value = { ready: false, missing: null, nested: { count: 0, rows: [{ value: null }, { value: 0 }] } };
  assert.equal(plan.format, CODEX_NATIVE_OUTPUT);
  assert.deepEqual(parseCodexFinalOutput(JSON.stringify(value), plan), { name: "p0_submit_analysis", arguments: value });
  for (const invalid of [{ ...value, tool_name: "p0_other" }, { tool_name: "p0_submit_analysis", arguments_json: JSON.stringify(value) }, { ...value, nested: { ...value.nested, arguments_json: "{}" } }, []]) {
    assert.throws(() => parseCodexFinalOutput(JSON.stringify(invalid), plan), /CODEX_/u);
  }
});

test("multiple tools retain the exact legacy envelope without native or mixed-output parser fallback", () => {
  const tools = [tool(closed({ value: { type: "boolean" } })), { ...tool(closed({})), name: "p0_second" }];
  const plan = chooseCodexOutputPlan(tools);
  assert.equal(plan.format, CODEX_LEGACY_OUTPUT);
  assert.deepEqual(parseCodexFinalOutput(JSON.stringify({ tool_name: "p0_second", arguments_json: JSON.stringify({ value: false, missing: null }) }), plan), { name: "p0_second", arguments: { value: false, missing: null } });
  assert.throws(() => parseCodexFinalOutput('{"value":false}', plan), /ENVELOPE_INVALID/u);
  assert.throws(() => parseCodexFinalOutput('{"tool_name":"p0_second","arguments_json":"{}","extra":false}', plan), /ENVELOPE_INVALID/u);
  assert.throws(() => parseCodexFinalOutput('{"tool_name":"p0_unknown","arguments_json":"{}"}', plan), /TOOL_NOT_ALLOWED/u);
  assert.throws(() => resolveCodexOutputPlan(tools, CODEX_NATIVE_OUTPUT), /INELIGIBLE/u);
  assert.throws(() => resolveCodexOutputPlan(tools, undefined), /FORMAT_INVALID/u);
});

test("native schema factors repeated large enums and preserves original uniqueness contracts", () => {
  const ids = Array.from({ length: 800 }, (_, index) => `evidence:${index}:${"x".repeat(60)}`);
  const refs = { type: "array", uniqueItems: true, items: { type: "string", enum: ids } };
  const original = closed({ first: structuredClone(refs), second: structuredClone(refs) });
  const before = structuredClone(original);
  const plan = choose(original);
  assert.equal(plan.format, CODEX_NATIVE_OUTPUT);
  assert.deepEqual(original, before);
  assert.deepEqual(plan.deferred_constraints, ["uniqueItems"]);
  assert.ok(plan.schema.$defs);
  assert.match(JSON.stringify(plan.schema), /"\$ref"/u);
  assert.doesNotMatch(JSON.stringify(plan.schema), /uniqueItems/u);
  const schemaText = JSON.stringify(plan.schema);
  assert.equal(schemaText.split(ids[799]).length - 1, 1);
  assert.deepEqual(parseCodexFinalOutput(JSON.stringify({ first: [ids[0]], second: [ids[799]] }), plan).arguments, { first: [ids[0]], second: [ids[799]] });
  assert.throws(() => parseCodexFinalOutput('{"first":["invented"],"second":[]}', plan), /ARGUMENTS_INVALID/u);
});

test("unhandled references, optional/open objects and unsupported keywords conservatively retain legacy", () => {
  for (const schema of [
    { ...closed({ value: { type: "string" } }), required: [] },
    { ...closed({}), additionalProperties: true },
    { ...closed({}), $defs: { old: { type: "string" } } },
    closed({ value: { $ref: "https://example.com/schema" } }),
    closed({ value: { type: "string", default: "unsupported" } }),
    closed({ value: { type: "string", allOf: [{ type: "string" }] } }),
    closed({ value: { type: "string", format: "date" } }),
    closed({ value: { type: "integer", multipleOf: 5 } }),
    { type: "array", items: { type: "string" } },
  ]) assert.equal(choose(schema).format, CODEX_LEGACY_OUTPUT);
});

test("duplicate object keys are rejected in native arguments and every legacy JSON layer", () => {
  const plan = choose(closed({ value: { type: "integer" } }));
  assert.throws(() => parseCodexFinalOutput('{"value":1,"value":2}', plan), /JSON_INVALID/u);
  assert.deepEqual(parseCodexFinalOutput('{"value":9007199254740992}', plan).arguments, { value: 9007199254740992 });
  const legacy = resolveCodexOutputPlan([tool(closed({}))], CODEX_LEGACY_OUTPUT);
  assert.throws(() => parseCodexFinalOutput('{"tool_name":"p0_submit_analysis","tool_name":"p0_submit_analysis","arguments_json":"{}"}', legacy), /JSON_INVALID/u);
  assert.throws(() => parseCodexFinalOutput(JSON.stringify({ tool_name: "p0_submit_analysis", arguments_json: '{"value":1,"value":2}' }), legacy), /ARGUMENTS_INVALID/u);
});

test("schema depth, property count, total enum count and string limits are bounded before native dispatch", () => {
  const nesting = (depth) => { let schema = { type: "string" }; for (let index = 0; index < depth; index += 1) schema = closed({ child: schema }); return schema; };
  assert.equal(choose(nesting(10)).format, CODEX_NATIVE_OUTPUT);
  assert.equal(choose(nesting(11)).format, CODEX_LEGACY_OUTPUT);
  assert.equal(choose(closed({ ids: { type: "string", enum: Array.from({ length: 1_001 }, (_, index) => `id-${index}`) } })).format, CODEX_LEGACY_OUTPUT);
  assert.equal(choose(closed({ text: { type: "string", const: "x".repeat(120_001) } })).format, CODEX_LEGACY_OUTPUT);
  assert.equal(choose(closed(Object.fromEntries(Array.from({ length: 5_001 }, (_, index) => [`key${index}`, { type: "boolean" }])))).format, CODEX_LEGACY_OUTPUT);
});
