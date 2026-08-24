import { cleanText } from "./text.ts";

export const BUSINESS_MODEL_SCHEMA = "p0-business-model-v1";

export const BUSINESS_MODEL_FIELD_ORDER = [
  "qualified_outcome",
  "customer_context",
  "buying_context",
  "revenue_model",
  "sales_cycle",
  "average_sale_value_rub",
  "gross_margin_percent",
  "lead_to_sale_percent",
  "capacity",
  "seasonality",
  "geography",
  "exclusions",
  "key_constraints",
] as const;

export type BusinessModelFieldId = typeof BUSINESS_MODEL_FIELD_ORDER[number];
export type BusinessModelFieldValue = string | number | null;

export type BusinessModelField = {
  value: BusinessModelFieldValue;
  availability: "AVAILABLE" | "UNAVAILABLE";
  provenance: {
    kind: "PUBLIC_FIRST_PARTY_SITE" | "OWNER_CONFIRMATION" | "UNAVAILABLE";
    label: string;
    source_url: string | null;
    observed_at: string | null;
  };
  freshness: "CURRENT" | "UNKNOWN";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "OWNER_CONFIRMED" | "UNAVAILABLE";
  limitation: string | null;
  assumption: { explicit: true; statement: string | null };
  owner_confirmed: boolean;
};

export type BusinessModelContract = {
  schema_version: typeof BUSINESS_MODEL_SCHEMA;
  model_revision_id: string;
  material_fingerprint: string;
  created_at: string;
  lineage: { previous_model_revision_id: string | null };
  fields: Record<BusinessModelFieldId, BusinessModelField>;
  questions: Array<{
    field: BusinessModelFieldId;
    question: string;
    why_material: string;
    boundary: "MATERIAL_UNCERTAINTY";
    recommendation: {
      answer: string;
      evidence: string[];
      confidence: "LOW";
    };
  }>;
  economics: {
    status: "CONFIRMED" | "MATERIAL_UNCERTAINTY";
    target_result_cost_rub: number | null;
    formula: {
      expression: "average_sale_value_rub × gross_margin_percent ÷ 100 × lead_to_sale_percent ÷ 100";
      input_fields: ["average_sale_value_rub", "gross_margin_percent", "lead_to_sale_percent"];
    };
    limitation: string | null;
  };
};

type DiscoveredField = {
  value: unknown;
  source_url?: string;
  quote?: string;
  confidence?: string;
  assumption?: string | null;
};

const NUMERIC_FIELDS = new Set<BusinessModelFieldId>([
  "average_sale_value_rub",
  "gross_margin_percent",
  "lead_to_sale_percent",
]);

const FIELD_QUESTIONS: Record<BusinessModelFieldId, { question: string; why: string }> = {
  qualified_outcome: { question: "Какой результат считается квалифицированным?", why: "Определение результата меняет измерение и допустимую стоимость привлечения." },
  customer_context: { question: "Кто является целевым клиентом?", why: "Контекст клиента меняет аудиторию, сообщение и спрос." },
  buying_context: { question: "Кто и как принимает решение о покупке?", why: "Процесс покупки меняет рекламную гипотезу и квалификацию обращения." },
  revenue_model: { question: "Как бизнес получает выручку от этого предложения?", why: "Модель выручки определяет применимую экономику результата." },
  sales_cycle: { question: "Каков обычный цикл от обращения до продажи?", why: "Цикл продажи ограничивает период проверки результата." },
  average_sale_value_rub: { question: "Какова подтверждённая средняя ценность одной продажи, ₽?", why: "Без ценности продажи нельзя обосновать предельную стоимость результата." },
  gross_margin_percent: { question: "Какая валовая маржа остаётся с продажи, %?", why: "Выручка без маржи не доказывает допустимую стоимость привлечения." },
  lead_to_sale_percent: { question: "Какая доля квалифицированных обращений становится продажей, %?", why: "Без конверсии обращения в продажу target result cost был бы выдуман." },
  capacity: { question: "Сколько новых квалифицированных результатов бизнес способен обработать?", why: "Ограничение мощности меняет допустимый объём рекламы." },
  seasonality: { question: "Есть ли существенная сезонность или закрытые периоды?", why: "Сезонность меняет период и интерпретацию спроса." },
  geography: { question: "В какой географии бизнес реально обслуживает клиентов?", why: "География меняет доступный спрос, стоимость и возможность выполнить заказ." },
  exclusions: { question: "Какие обращения, клиенты или сделки нужно исключить?", why: "Исключения защищают качество результата." },
  key_constraints: { question: "Какие ключевые бизнес-ограничения нельзя нарушать?", why: "Ограничения могут заблокировать неподходящую стратегию." },
};

function normalizedText(value: unknown) {
  return cleanText(String(value ?? "").normalize("NFKC"), 2_000);
}

function numericValue(field: BusinessModelFieldId, value: unknown): number | null {
  const normalized = normalizedText(value).replace(/\s/gu, "").replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0) return null;
  if ((field === "gross_margin_percent" || field === "lead_to_sale_percent") && number > 100) return null;
  return Math.round(number * 100) / 100;
}

function normalizeValue(field: BusinessModelFieldId, value: unknown): BusinessModelFieldValue {
  return NUMERIC_FIELDS.has(field) ? numericValue(field, value) : normalizedText(value) || null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function questions(fields: BusinessModelContract["fields"]): BusinessModelContract["questions"] {
  return BUSINESS_MODEL_FIELD_ORDER
    .filter((field) => fields[field].availability === "UNAVAILABLE" && !fields[field].owner_confirmed)
    .map((field) => ({
      field,
      question: FIELD_QUESTIONS[field].question,
      why_material: FIELD_QUESTIONS[field].why,
      boundary: "MATERIAL_UNCERTAINTY" as const,
      recommendation: {
        answer: fields[field].assumption.statement
          ?? "Указать фактическое значение; если оно неизвестно, подтвердить недоступность без нуля или догадки.",
        evidence: [fields[field].limitation ?? "Разрешённые источники не подтвердили значение."],
        confidence: "LOW" as const,
      },
    }));
}

function economics(fields: BusinessModelContract["fields"]): BusinessModelContract["economics"] {
  const inputFields = ["average_sale_value_rub", "gross_margin_percent", "lead_to_sale_percent"] as const;
  const confirmed = inputFields.every((field) => fields[field].owner_confirmed && typeof fields[field].value === "number");
  const averageValue = Number(fields.average_sale_value_rub.value);
  const margin = Number(fields.gross_margin_percent.value);
  const leadToSale = Number(fields.lead_to_sale_percent.value);
  const target = confirmed ? Math.floor(averageValue * margin / 100 * leadToSale / 100) : null;
  return {
    status: confirmed && target !== null && target > 0 ? "CONFIRMED" : "MATERIAL_UNCERTAINTY",
    target_result_cost_rub: confirmed && target !== null && target > 0 ? target : null,
    formula: {
      expression: "average_sale_value_rub × gross_margin_percent ÷ 100 × lead_to_sale_percent ÷ 100",
      input_fields: [...inputFields],
    },
    limitation: confirmed && target !== null && target > 0
      ? null
      : "Целевая стоимость результата не выводится, пока ценность продажи, маржа и конверсия обращения в продажу не подтверждены владельцем.",
  };
}

async function seal(input: {
  fields: BusinessModelContract["fields"];
  createdAt: string;
  previousRevisionId: string | null;
}): Promise<BusinessModelContract> {
  const material = BUSINESS_MODEL_FIELD_ORDER.map((field) => ({
    field,
    value: input.fields[field].value,
    owner_confirmed: input.fields[field].owner_confirmed,
    assumption: input.fields[field].assumption,
  }));
  const materialFingerprint = await digest(material);
  return {
    schema_version: BUSINESS_MODEL_SCHEMA,
    model_revision_id: `business-model:${materialFingerprint.slice(0, 24)}`,
    material_fingerprint: `sha256:${materialFingerprint}`,
    created_at: input.createdAt,
    lineage: { previous_model_revision_id: input.previousRevisionId },
    fields: input.fields,
    questions: questions(input.fields),
    economics: economics(input.fields),
  };
}

export async function buildBusinessModelContract(input: {
  discovered: Partial<Record<BusinessModelFieldId, DiscoveredField>>;
  observedAt: string;
}) {
  const fields = Object.fromEntries(BUSINESS_MODEL_FIELD_ORDER.map((field) => {
    const discovered = input.discovered[field] ?? { value: null };
    const value = normalizeValue(field, discovered.value);
    const available = value !== null;
    const confidence = ["HIGH", "MEDIUM", "LOW"].includes(String(discovered.confidence))
      ? discovered.confidence as "HIGH" | "MEDIUM" | "LOW"
      : available ? "LOW" : "UNAVAILABLE";
    return [field, {
      value,
      availability: available ? "AVAILABLE" : "UNAVAILABLE",
      provenance: available ? {
        kind: "PUBLIC_FIRST_PARTY_SITE",
        label: "Публичный сайт бизнеса",
        source_url: normalizedText(discovered.source_url) || null,
        observed_at: input.observedAt,
      } : {
        kind: "UNAVAILABLE",
        label: "Нет доступного подтверждения",
        source_url: null,
        observed_at: null,
      },
      freshness: available ? "CURRENT" : "UNKNOWN",
      confidence,
      limitation: available ? null : `${FIELD_QUESTIONS[field].question} Значение не подтверждено доступными evidence.`,
      assumption: { explicit: true, statement: normalizedText(discovered.assumption) || null },
      owner_confirmed: false,
    } satisfies BusinessModelField];
  })) as BusinessModelContract["fields"];
  return seal({ fields, createdAt: input.observedAt, previousRevisionId: null });
}

export async function reviseBusinessModelContract(input: {
  previous: BusinessModelContract;
  values: Partial<Record<BusinessModelFieldId, unknown>>;
  confirmedAt: string;
}) {
  const fields = structuredClone(input.previous.fields);
  for (const field of BUSINESS_MODEL_FIELD_ORDER) {
    if (!Object.hasOwn(input.values, field)) continue;
    const value = normalizeValue(field, input.values[field]);
    if (value === null && normalizedText(input.values[field])) {
      throw new Error(`Business Model field ${field} содержит недопустимое значение.`);
    }
    fields[field] = value === null ? {
      value: null,
      availability: "UNAVAILABLE",
      provenance: {
        kind: "OWNER_CONFIRMATION",
        label: "Владелец подтвердил недоступность",
        source_url: null,
        observed_at: input.confirmedAt,
      },
      freshness: "CURRENT",
      confidence: "OWNER_CONFIRMED",
      limitation: "Бизнес-информация недоступна; значение не заменено нулём или предположением.",
      assumption: { explicit: true, statement: null },
      owner_confirmed: true,
    } : {
      value,
      availability: "AVAILABLE",
      provenance: {
        kind: "OWNER_CONFIRMATION",
        label: "Подтверждено владельцем",
        source_url: null,
        observed_at: input.confirmedAt,
      },
      freshness: "CURRENT",
      confidence: "OWNER_CONFIRMED",
      limitation: null,
      assumption: { explicit: true, statement: null },
      owner_confirmed: true,
    };
  }
  const next = await seal({
    fields,
    createdAt: input.confirmedAt,
    previousRevisionId: input.previous.model_revision_id,
  });
  if (next.material_fingerprint === input.previous.material_fingerprint) return structuredClone(input.previous);
  return next;
}
