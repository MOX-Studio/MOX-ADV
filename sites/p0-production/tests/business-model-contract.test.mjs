import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_MODEL_FIELD_ORDER,
  buildBusinessModelContract,
  reviseBusinessModelContract,
} from "../lib/business-model-contract.ts";

const OBSERVED_AT = "2026-08-24T10:00:00.000Z";

function discovered() {
  return {
    qualified_outcome: { value: "Квалифицированная заявка", source_url: "https://owner.example/", quote: "Оставьте заявку", confidence: "HIGH" },
    customer_context: { value: "Руководители производственных компаний", source_url: "https://owner.example/", quote: "Для руководителей компаний", confidence: "MEDIUM" },
    buying_context: { value: null },
    revenue_model: { value: "Разовая продажа пакета участия", source_url: "https://owner.example/prices", quote: "Пакет участия", confidence: "MEDIUM" },
    sales_cycle: { value: null },
    average_sale_value_rub: { value: 500_000, source_url: "https://owner.example/prices", quote: "Пакет 500 000 ₽", confidence: "MEDIUM" },
    gross_margin_percent: { value: null },
    lead_to_sale_percent: { value: null },
    capacity: { value: null },
    seasonality: { value: null },
    geography: { value: null },
    exclusions: { value: "Посетители без коммерческого намерения", source_url: "https://owner.example/", quote: "Для участников и посетителей", confidence: "MEDIUM" },
    key_constraints: { value: null },
  };
}

test("agent-filled Business Model keeps every material field with provenance, freshness, confidence, limitation and explicit assumption", async () => {
  const model = await buildBusinessModelContract({ discovered: discovered(), observedAt: OBSERVED_AT });

  assert.deepEqual(Object.keys(model.fields), BUSINESS_MODEL_FIELD_ORDER);
  assert.equal(model.fields.average_sale_value_rub.value, 500_000);
  assert.equal(model.fields.average_sale_value_rub.provenance.kind, "PUBLIC_FIRST_PARTY_SITE");
  assert.equal(model.fields.average_sale_value_rub.freshness, "CURRENT");
  assert.equal(model.fields.average_sale_value_rub.confidence, "MEDIUM");
  assert.equal(model.fields.average_sale_value_rub.limitation, null);
  assert.deepEqual(model.fields.average_sale_value_rub.assumption, { explicit: true, statement: null });
  assert.equal(model.fields.gross_margin_percent.availability, "UNAVAILABLE");
  assert.equal(model.fields.gross_margin_percent.value, null);
  assert.match(model.fields.gross_margin_percent.limitation, /не подтверждено/u);
  assert.equal(model.questions.some((item) => item.field === "gross_margin_percent"), true);
  assert.equal(model.questions.some((item) => item.field === "average_sale_value_rub"), false);
  assert.equal(model.economics.status, "MATERIAL_UNCERTAINTY");
  assert.equal(model.economics.target_result_cost_rub, null);
});

test("owner-confirmed unavailable business information stays unavailable without repeated adaptive questions", async () => {
  const initial = await buildBusinessModelContract({ discovered: discovered(), observedAt: OBSERVED_AT });
  const revised = await reviseBusinessModelContract({
    previous: initial,
    values: { gross_margin_percent: "" },
    confirmedAt: "2026-08-24T11:00:00.000Z",
  });

  assert.equal(revised.fields.gross_margin_percent.value, null);
  assert.equal(revised.fields.gross_margin_percent.availability, "UNAVAILABLE");
  assert.equal(revised.fields.gross_margin_percent.owner_confirmed, true);
  assert.match(revised.fields.gross_margin_percent.limitation, /не заменено нулём/u);
  assert.equal(revised.questions.some((item) => item.field === "gross_margin_percent"), false);
  assert.equal(revised.economics.status, "MATERIAL_UNCERTAINTY");
  assert.equal(revised.economics.target_result_cost_rub, null);
});

test("confirmed economics deterministically grounds target result cost and normalization-only edit preserves lineage", async () => {
  const initial = await buildBusinessModelContract({ discovered: discovered(), observedAt: OBSERVED_AT });
  const complete = await reviseBusinessModelContract({
    previous: initial,
    values: {
      ...Object.fromEntries(BUSINESS_MODEL_FIELD_ORDER.map((field) => [field, initial.fields[field].value ?? `Подтверждено: ${field}`])),
      average_sale_value_rub: "500000",
      gross_margin_percent: "40",
      lead_to_sale_percent: "20",
    },
    confirmedAt: "2026-08-24T11:00:00.000Z",
  });

  assert.equal(complete.economics.status, "CONFIRMED");
  assert.equal(complete.economics.target_result_cost_rub, 40_000);
  assert.deepEqual(complete.economics.formula, {
    expression: "average_sale_value_rub × gross_margin_percent ÷ 100 × lead_to_sale_percent ÷ 100",
    input_fields: ["average_sale_value_rub", "gross_margin_percent", "lead_to_sale_percent"],
  });
  assert.notEqual(complete.model_revision_id, initial.model_revision_id);

  const normalized = await reviseBusinessModelContract({
    previous: complete,
    values: Object.fromEntries(BUSINESS_MODEL_FIELD_ORDER.map((field) => {
      const value = complete.fields[field].value;
      return [field, typeof value === "string" ? `  ${value.replaceAll(" ", "   ")}  ` : String(value ?? "")];
    })),
    confirmedAt: "2026-08-24T12:00:00.000Z",
  });
  assert.equal(normalized.model_revision_id, complete.model_revision_id);
  assert.deepEqual(normalized, complete);
});
