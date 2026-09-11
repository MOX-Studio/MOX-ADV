import JSONbigFactory from "json-bigint";

export const CODEX_LEGACY_OUTPUT = "tool-envelope-v1";
export const CODEX_NATIVE_OUTPUT = "single-tool-arguments-v1";

const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "anyOf", "enum", "const",
  "description", "title", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems",
]);
const strictJSON = JSONbigFactory({ strict: true, protoAction: "preserve", constructorAction: "preserve" });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const scalar = (value) => value === null || ["string", "boolean"].includes(typeof value) || (typeof value === "number" && Number.isFinite(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function children(schema) {
  return [
    ...Object.values(schema.properties ?? {}),
    ...(schema.items ? [schema.items] : []),
    ...(schema.anyOf ?? []),
  ];
}

function mapChildren(schema, map) {
  return {
    ...schema,
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([name, child]) => [name, map(child)])) } : {}),
    ...(schema.items ? { items: map(schema.items) } : {}),
    ...(schema.anyOf ? { anyOf: schema.anyOf.map(map) } : {}),
  };
}

/** Original tool schemas remain untouched; unsupported references/composition use the legacy protocol. */
function nativeSchema(original) {
  const deferred = new Set();
  let nodes = 0;
  const normalize = (schema, depth = 0) => {
    if (!object(schema) || ++nodes > 50_000) throw new Error("SCHEMA_DEPTH_OR_SIZE");
    if (Object.keys(schema).some((key) => !KEYWORDS.has(key))) throw new Error("UNSUPPORTED_SCHEMA_KEYWORD");
    if (["title", "description"].some((key) => key in schema && typeof schema[key] !== "string")) throw new Error("INVALID_SCHEMA_METADATA");
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const nesting = depth + (types.includes("object") || types.includes("array") ? 1 : 0);
    if (nesting > 10) throw new Error("SCHEMA_DEPTH_OR_SIZE");
    if ((!types.length && !Array.isArray(schema.anyOf)) || types.some((type) => !TYPES.has(type)) || new Set(types).size !== types.length) throw new Error("UNSUPPORTED_SCHEMA_TYPE");
    if (Array.isArray(schema.type) && (types.length !== 2 || !types.includes("null"))) throw new Error("UNSUPPORTED_TYPE_UNION");
    if (schema.anyOf && (!Array.isArray(schema.anyOf) || !schema.anyOf.length)) throw new Error("INVALID_ANY_OF");
    if (types.includes("object")) {
      if (!object(schema.properties) || schema.additionalProperties !== false || !Array.isArray(schema.required)
        || !same([...schema.required].sort(), Object.keys(schema.properties).sort())) throw new Error("OBJECT_NOT_CLOSED_AND_REQUIRED");
    } else if (["properties", "required", "additionalProperties"].some((key) => key in schema)) throw new Error("OBJECT_KEYWORD_WITHOUT_OBJECT");
    if (types.includes("array")) {
      if (!object(schema.items)) throw new Error("ARRAY_ITEMS_REQUIRED");
      if ("uniqueItems" in schema && typeof schema.uniqueItems !== "boolean") throw new Error("INVALID_UNIQUE_ITEMS");
    } else if (["items", "minItems", "maxItems", "uniqueItems"].some((key) => key in schema)) throw new Error("ARRAY_KEYWORD_WITHOUT_ARRAY");
    for (const key of ["minItems", "maxItems", "minLength", "maxLength"]) {
      if (key in schema && (!Number.isSafeInteger(schema[key]) || schema[key] < 0)) throw new Error("INVALID_SCHEMA_LIMIT");
    }
    for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]) {
      if (key in schema && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) throw new Error("INVALID_SCHEMA_LIMIT");
    }
    if ("pattern" in schema) {
      if (typeof schema.pattern !== "string") throw new Error("INVALID_PATTERN");
      new RegExp(schema.pattern, "u");
    }
    if ("enum" in schema && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.some((value) => !scalar(value))
      || new Set(schema.enum.map((value) => JSON.stringify(value))).size !== schema.enum.length)) throw new Error("INVALID_ENUM");
    if ("const" in schema && !scalar(schema.const)) throw new Error("UNSUPPORTED_CONST");
    const result = {
      ...schema,
      ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, normalize(child, nesting)])) } : {}),
      ...(schema.items ? { items: normalize(schema.items, nesting) } : {}),
      ...(schema.anyOf ? { anyOf: schema.anyOf.map((child) => normalize(child, depth)) } : {}),
    };
    if ("uniqueItems" in result) {
      if (result.uniqueItems) deferred.add("uniqueItems");
      delete result.uniqueItems;
    }
    // Equivalent bounded alternatives avoid a >250-value string enum exceeding 15,000 characters.
    if (result.enum?.length > 250 && result.enum.filter((value) => typeof value === "string").reduce((sum, value) => sum + value.length, 0) > 15_000) {
      if (result.anyOf) throw new Error("ENUM_WITH_EXISTING_ANY_OF");
      const values = result.enum;
      delete result.enum;
      return { anyOf: Array.from({ length: Math.ceil(values.length / 250) }, (_, index) => ({ ...result, enum: values.slice(index * 250, (index + 1) * 250) })) };
    }
    return result;
  };
  if (!object(original) || original.type !== "object" || original.anyOf) throw new Error("ROOT_MUST_BE_OBJECT");
  const normalized = normalize(original);
  const occurrences = new Map();
  const count = (schema) => {
    const signature = JSON.stringify(schema);
    occurrences.set(signature, (occurrences.get(signature) ?? 0) + 1);
    children(schema).forEach(count);
  };
  count(normalized);
  const definitions = {};
  const refs = new Map();
  const factor = (schema, root = false) => {
    const signature = JSON.stringify(schema);
    if (!root && signature.length >= 256 && occurrences.get(signature) > 1) {
      if (!refs.has(signature)) {
        const name = `shared_${refs.size + 1}`;
        refs.set(signature, name);
        definitions[name] = mapChildren(schema, (child) => factor(child));
      }
      return { $ref: `#/$defs/${refs.get(signature)}` };
    }
    return mapChildren(schema, (child) => factor(child));
  };
  const compiled = factor(normalized, true);
  if (Object.keys(definitions).length) compiled.$defs = definitions;
  let enumValues = 0;
  let properties = 0;
  let stringLength = Object.keys(definitions).reduce((sum, name) => sum + name.length, 0);
  const limits = (schema) => {
    properties += Object.keys(schema.properties ?? {}).length;
    stringLength += Object.keys(schema.properties ?? {}).reduce((sum, name) => sum + name.length, 0);
    enumValues += schema.enum?.length ?? 0;
    stringLength += (schema.enum ?? []).filter((value) => typeof value === "string").reduce((sum, value) => sum + value.length, 0);
    if (typeof schema.const === "string") stringLength += schema.const.length;
    children(schema).forEach(limits);
  };
  limits(compiled);
  Object.values(definitions).forEach(limits);
  if (enumValues > 1_000 || properties > 5_000 || stringLength > 120_000) throw new Error("STRUCTURED_OUTPUT_SCHEMA_LIMIT");
  return { schema: compiled, deferred_constraints: [...deferred] };
}

function legacyPlan(tools, reason = null) {
  return {
    format: CODEX_LEGACY_OUTPUT,
    bound_tool: null,
    fallback_reason: reason,
    deferred_constraints: [],
    schema: {
      type: "object",
      properties: { tool_name: { type: "string", enum: tools.map((tool) => tool.name) }, arguments_json: { type: "string" } },
      required: ["tool_name", "arguments_json"], additionalProperties: false,
    },
  };
}

export function chooseCodexOutputPlan(tools, preferNative = true) {
  if (!preferNative || tools.length !== 1) return legacyPlan(tools, "NOT_ONE_CLOSED_STAGE_TOOL");
  try {
    const compiled = nativeSchema(tools[0].input_schema);
    return { format: CODEX_NATIVE_OUTPUT, bound_tool: tools[0].name, fallback_reason: null, ...compiled };
  } catch (error) {
    const reason = error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "UNSUPPORTED_SCHEMA";
    return legacyPlan(tools, reason);
  }
}

/** Discriminator selection is explicit; invalid native requests never fall back after generation. */
export function resolveCodexOutputPlan(tools, format) {
  if (format === CODEX_LEGACY_OUTPUT) return legacyPlan(tools);
  if (format !== CODEX_NATIVE_OUTPUT) throw new Error("CODEX_OUTPUT_FORMAT_INVALID");
  const plan = chooseCodexOutputPlan(tools);
  if (plan.format !== format) throw new Error("CODEX_NATIVE_SCHEMA_INELIGIBLE");
  return plan;
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "object") return object(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function matchesSchema(value, schema, root, depth = 0) {
  if (depth > 40) return false;
  if (schema.$ref) {
    const match = /^#\/\$defs\/(shared_\d+)$/u.exec(schema.$ref);
    return Boolean(match && root.$defs?.[match[1]] && matchesSchema(value, root.$defs[match[1]], root, depth + 1));
  }
  if (schema.anyOf && !schema.anyOf.some((branch) => matchesSchema(value, branch, root, depth + 1))) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => matchesType(value, type))) return false;
  if (schema.enum && !schema.enum.some((allowed) => same(value, allowed))) return false;
  if ("const" in schema && !same(value, schema.const)) return false;
  if (object(value) && schema.properties) {
    if (!same(Object.keys(value).sort(), [...schema.required].sort())) return false;
    if (!Object.entries(schema.properties).every(([key, child]) => matchesSchema(value[key], child, root, depth + 1))) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((item) => matchesSchema(item, schema.items, root, depth + 1))) return false;
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) return false;
    if (schema.maxLength !== undefined && length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) return false;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return false;
  }
  return true;
}

export function parseCodexFinalOutput(serialized, plan) {
  let final;
  try {
    // Strict parsing detects duplicate names; ordinary JSON.parse keeps the existing number/object representation.
    strictJSON.parse(serialized);
    final = JSON.parse(serialized);
  } catch { throw new Error("CODEX_OUTPUT_JSON_INVALID"); }
  if (!object(final)) throw new Error("CODEX_OUTPUT_OBJECT_REQUIRED");
  if (plan.format === CODEX_NATIVE_OUTPUT) {
    if (serialized.length > 200_000) throw new Error("CODEX_NATIVE_ARGUMENTS_LIMIT");
    if (!plan.bound_tool || !matchesSchema(final, plan.schema, plan.schema)) throw new Error("CODEX_NATIVE_ARGUMENTS_INVALID");
    return { name: plan.bound_tool, arguments: final };
  }
  if (plan.format !== CODEX_LEGACY_OUTPUT || !same(Object.keys(final).sort(), ["arguments_json", "tool_name"])) throw new Error("CODEX_LEGACY_ENVELOPE_INVALID");
  if (!plan.schema.properties.tool_name.enum.includes(final.tool_name)) throw new Error("CODEX_TOOL_NOT_ALLOWED");
  if (typeof final.arguments_json !== "string" || !final.arguments_json.trim() || final.arguments_json.length > 200_000) throw new Error("CODEX_LEGACY_ARGUMENTS_INVALID");
  let argumentsValue;
  try {
    strictJSON.parse(final.arguments_json);
    argumentsValue = JSON.parse(final.arguments_json);
  } catch { throw new Error("CODEX_LEGACY_ARGUMENTS_INVALID"); }
  if (!object(argumentsValue)) throw new Error("CODEX_LEGACY_ARGUMENTS_INVALID");
  return { name: final.tool_name, arguments: argumentsValue };
}
