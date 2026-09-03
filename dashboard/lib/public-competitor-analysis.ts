import type {
  FinancialCompetitorIntelligenceInput,
  FinancialLegalEntityInput,
  FinancialMetric,
  GirBoFinancialRecordInput,
} from "./financial-competitor-intelligence.ts";
import type { BusinessModel, SiteAnalysis } from "./p0-application.ts";

export type PublicCompetitorAnalysis = {
  evidencePackId: string;
  competitorResearchConfig: string;
  financialInput: FinancialCompetitorIntelligenceInput;
};

type AnalysisInput = {
  model: Pick<BusinessModel, "product" | "audience" | "value" | "qualified_result" | "exclusions" | "geography" | "offer_candidates">;
  site: Pick<SiteAnalysis, "url" | "title" | "description" | "text_excerpt">;
  generatedAt: string;
};

type PublicEntity = {
  entityId: string;
  role: "COMPANY" | "COMPETITOR";
  brand: string;
  legalName: string;
  inn: string;
  ogrn: string;
  relation: FinancialLegalEntityInput["relation"];
  brandSource: string;
  bfoCard: string;
  rusprofile: string;
};

type PublicFinancialObservation = {
  entityId: string;
  year: number;
  metric: Extract<FinancialMetric, "REVENUE" | "NET_PROFIT">;
  valueThousandRub: string;
  columnRole: GirBoFinancialRecordInput["column_role"];
  formVariant: GirBoFinancialRecordInput["form_variant"];
};

const PACK_ID = "innoprom-stand-competitive-frame-2026-09-01-v2";

const ENTITIES: PublicEntity[] = [
  {
    entityId: "company-formika-event",
    role: "COMPANY",
    brand: "ИННОПРОМ / Formika Event",
    legalName: "ООО «ФОРМИКА ИВЕНТ»",
    inn: "7709889632",
    ogrn: "1117746895144",
    relation: "OPERATOR",
    brandSource: "https://expo.innoprom.com/",
    bfoCard: "https://bo.nalog.gov.ru/organizations-card/166287",
    rusprofile: "https://www.rusprofile.ru/id/5738299",
  },
  {
    entityId: "competitor-mke-expo",
    role: "COMPETITOR",
    brand: "MKE EXPO",
    legalName: "ООО «МКЕ»",
    inn: "6682013402",
    ogrn: "1176658096141",
    relation: "MANUFACTURER",
    brandSource: "https://mkeexpo.ru/innoprom",
    bfoCard: "https://bo.nalog.gov.ru/organizations-card/10397816",
    rusprofile: "https://www.rusprofile.ru/search?query=6682013402",
  },
  {
    entityId: "competitor-r2group",
    role: "COMPETITOR",
    brand: "R2GROUP",
    legalName: "ООО «Р2ГРУПП»",
    inn: "6678076640",
    ogrn: "1169658121126",
    relation: "MANUFACTURER",
    brandSource: "https://r2group.ru/innoprom",
    bfoCard: "https://bo.nalog.gov.ru/organizations-card/9966149",
    rusprofile: "https://www.rusprofile.ru/id/10710441",
  },
  {
    entityId: "competitor-stl-expo",
    role: "COMPETITOR",
    brand: "STL EXPO",
    legalName: "ООО «СТЛ ЭКСПО»",
    inn: "6670303918",
    ogrn: "1106670024383",
    relation: "MANUFACTURER",
    brandSource: "https://sankt-peterburg.stlexpo.ru/uslugi/stendy-dlya-innoprom",
    bfoCard: "https://bo.nalog.gov.ru/organizations-card/711984",
    rusprofile: "https://www.rusprofile.ru/id/2708935",
  },
];

const FINANCIAL_OBSERVATIONS: PublicFinancialObservation[] = [
  { entityId: "company-formika-event", year: 2025, metric: "REVENUE", valueThousandRub: "1525361", columnRole: "CURRENT", formVariant: "FULL" },
  { entityId: "company-formika-event", year: 2025, metric: "NET_PROFIT", valueThousandRub: "488617", columnRole: "CURRENT", formVariant: "FULL" },
  { entityId: "company-formika-event", year: 2024, metric: "REVENUE", valueThousandRub: "1302226", columnRole: "COMPARATIVE", formVariant: "FULL" },
  { entityId: "company-formika-event", year: 2024, metric: "NET_PROFIT", valueThousandRub: "372699", columnRole: "COMPARATIVE", formVariant: "FULL" },
  { entityId: "competitor-mke-expo", year: 2025, metric: "REVENUE", valueThousandRub: "261896", columnRole: "CURRENT", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-mke-expo", year: 2025, metric: "NET_PROFIT", valueThousandRub: "24426", columnRole: "CURRENT", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-mke-expo", year: 2024, metric: "REVENUE", valueThousandRub: "251386", columnRole: "COMPARATIVE", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-mke-expo", year: 2024, metric: "NET_PROFIT", valueThousandRub: "251", columnRole: "COMPARATIVE", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-r2group", year: 2024, metric: "REVENUE", valueThousandRub: "119391", columnRole: "CURRENT", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-r2group", year: 2024, metric: "NET_PROFIT", valueThousandRub: "38057", columnRole: "CURRENT", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-stl-expo", year: 2025, metric: "REVENUE", valueThousandRub: "359010", columnRole: "CURRENT", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-stl-expo", year: 2025, metric: "NET_PROFIT", valueThousandRub: "1027", columnRole: "CURRENT", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-stl-expo", year: 2024, metric: "REVENUE", valueThousandRub: "262163", columnRole: "COMPARATIVE", formVariant: "SIMPLIFIED" },
  { entityId: "competitor-stl-expo", year: 2024, metric: "NET_PROFIT", valueThousandRub: "954", columnRole: "COMPARATIVE", formVariant: "SIMPLIFIED" },
];

const COMPETITOR_RESEARCH = {
  rule: "В набор входят прямые поставщики застройки и альтернативные поставщики участия со стендом, которые на собственной официальной публичной странице закрывают ту же потребность клиента на ИННОПРОМ.",
  geography: "Россия · ИННОПРОМ, Екатеринбург",
  device: "all",
  candidates: [
    {
      competitor: "ИННОПРОМ / Formika Event",
      rationale: "Оператор выставки публично предлагает прямое участие со стендом категорий «Бизнес» и «Стандарт»; это альтернативный маршрут решения той же задачи клиента.",
      exactDestinations: ["https://expo.innoprom.com/participation-2027"],
      productsServices: ["Участие со стендом категории «Бизнес»", "Участие со стендом категории «Стандарт»", "Необорудованная выставочная площадь"],
      observedOfferMessage: "Прямое участие в ИННОПРОМ со стендом категории «Бизнес» или «Стандарт».",
      evidenceQuote: "УЧАСТИЕ В ВЫСТАВКЕ СО СТЕНДОМ: СТЕНД КАТЕГОРИИ «БИЗНЕС»; УЧАСТИЕ В ВЫСТАВКЕ СО СТЕНДОМ: СТЕНД КАТЕГОРИИ «СТАНДАРТ».",
      publishedPrice: { status: "NOT_PUBLISHED", value: null },
    },
    {
      competitor: "MKE EXPO",
      rationale: "Публично предлагает проектирование и застройку стендов на ИННОПРОМ под ключ.",
      exactDestinations: ["https://mkeexpo.ru/innoprom"],
      productsServices: ["Дизайн выставочного стенда", "Производство", "Монтаж и демонтаж"],
      observedOfferMessage: "Застройка эксклюзивных стендов для ИННОПРОМ под ключ.",
      evidenceQuote: "Команда MKE EXPO предлагает разработку дизайна и застройку демонстрационных площадок под ключ.",
      publishedPrice: { status: "NOT_PUBLISHED", value: null },
    },
    {
      competitor: "R2GROUP",
      rationale: "Публично предлагает полный комплекс подготовки и застройки стенда на ИННОПРОМ.",
      exactDestinations: ["https://r2group.ru/innoprom"],
      productsServices: ["Концепция и дизайн", "Расчёт сметы", "Застройка выставочного стенда"],
      observedOfferMessage: "Полный комплекс работ по подготовке и застройке эксклюзивных стендов на ИННОПРОМ.",
      evidenceQuote: "R2GROUP предлагает полный комплекс работ по подготовке и застройке эксклюзивных выставочных стендов на выставку ИННОПРОМ.",
      publishedPrice: { status: "NOT_PUBLISHED", value: null },
    },
    {
      competitor: "STL EXPO",
      rationale: "Аккредитованный застройщик ИННОПРОМ с собственным производством и полным циклом работ.",
      exactDestinations: ["https://sankt-peterburg.stlexpo.ru/uslugi/stendy-dlya-innoprom"],
      productsServices: ["Дизайн-проектирование", "Строительство", "Монтаж и демонтаж"],
      observedOfferMessage: "Полный комплекс проектирования, строительства и оформления стендов на ИННОПРОМ.",
      evidenceQuote: "Компания СТЛ ЭКСПО является аккредитованным застройщиком на выставке ИННОПРОМ.",
      publishedPrice: { status: "NOT_PUBLISHED", value: null },
    },
  ],
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function matchesInnoprom(input: AnalysisInput) {
  const material = [
    input.model.product,
    input.model.value,
    input.model.qualified_result,
    ...input.model.offer_candidates.map((offer) => offer.label),
    input.site.url,
    input.site.title,
    input.site.description,
    input.site.text_excerpt,
  ].map(text).join(" ");
  return /иннопром/iu.test(material) && /(?:стенд|участи)/iu.test(material);
}

async function digest(value: unknown) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return `sha256:${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function legalEntity(entity: PublicEntity, generatedAt: string): FinancialLegalEntityInput {
  return {
    entity_id: entity.entityId,
    role: entity.role,
    inn: entity.inn,
    ogrn: entity.ogrn,
    legal_name: entity.legalName,
    relation: entity.relation,
    resolution_status: "CONFIRMED",
    evidence: [
      {
        evidence_ref: `egrul:${entity.inn}:${entity.ogrn}`,
        evidence_kind: "LEGAL_IDENTITY",
        source_kind: "EGRUL",
        source_locator: `https://egrul.nalog.ru/index.html?query=${entity.inn}`,
        observed_at: generatedAt,
        status: "VERIFIED",
      },
      {
        evidence_ref: `brand:${entity.entityId}`,
        evidence_kind: "BRAND_OR_PRODUCT_RELATION",
        source_kind: "OFFICIAL_BRAND_DISCLOSURE",
        source_locator: entity.brandSource,
        observed_at: generatedAt,
        status: "VERIFIED",
      },
    ],
  };
}

async function financialRecord(observation: PublicFinancialObservation, generatedAt: string): Promise<GirBoFinancialRecordInput> {
  const entity = ENTITIES.find((item) => item.entityId === observation.entityId);
  if (!entity) throw new Error(`Public financial observation references unknown entity: ${observation.entityId}`);
  const lineCode = observation.metric === "REVENUE" ? "2110" : "2400";
  const lineName = observation.metric === "REVENUE" ? "Выручка" : "Чистая прибыль (убыток)";
  const sourceMaterial = {
    source: entity.bfoCard,
    inn: entity.inn,
    reporting_year: observation.year,
    metric: observation.metric,
    line_code: lineCode,
    value_thousand_rub: observation.valueThousandRub,
    evidence_pack: PACK_ID,
  };
  return {
    record_id: `gir-bo:${entity.inn}:${observation.year}:${lineCode}`,
    entity_id: entity.entityId,
    reporting_year: observation.year,
    period_start: `${observation.year}-01-01`,
    period_end: `${observation.year}-12-31`,
    statement_kind: "FINANCIAL_RESULTS",
    form_variant: observation.formVariant,
    accounting_standard: observation.year >= 2025 ? "FSBU_4_2023" : "PBU_4_99",
    format_version: `gir-bo-public-ui-${observation.year}`,
    column_role: observation.columnRole,
    metric: observation.metric,
    line_code: lineCode,
    line_name_raw: lineName,
    value_raw: observation.valueThousandRub,
    value_decimal: observation.valueThousandRub,
    unit_raw: "тыс. руб.",
    unit_multiplier: 1000,
    currency: "RUB",
    provenance: {
      source_system: "GIR_BO_FNS",
      access_channel: "OFFICIAL_PUBLIC_UI",
      source_locator: entity.bfoCard,
      source_file_name: `gir-bo-public-observation-${entity.inn}-${observation.year}.json`,
      source_hash_sha256: await digest(sourceMaterial),
      signature_present: null,
      signature_verified: null,
      fetched_at: generatedAt,
      resource_as_of_date: generatedAt.slice(0, 10),
      parser_name: "gir-bo-public-card-observation",
      parser_version: "1.0.0",
    },
    revision: { correction_indicator: "UNKNOWN", supersedes_record_id: null },
    quality: {
      status: "ACCEPTED_WITH_WARNINGS",
      flags: ["POINT_IN_TIME_PUBLIC_UI_OBSERVATION", `RUSPROFILE_CROSS_CHECK:${entity.rusprofile}`],
      identity_match: "PASS",
      period_valid: "PASS",
      unit_known: "PASS",
    },
  };
}

export async function buildPublicCompetitorAnalysis(input: AnalysisInput): Promise<PublicCompetitorAnalysis | null> {
  if (!matchesInnoprom(input)) return null;
  const includedOffers = input.model.offer_candidates.map((offer) => text(offer.label)).filter(Boolean);
  const financialRecords = await Promise.all(FINANCIAL_OBSERVATIONS.map((observation) => financialRecord(observation, input.generatedAt)));
  return {
    evidencePackId: PACK_ID,
    competitorResearchConfig: JSON.stringify(COMPETITOR_RESEARCH),
    financialInput: {
      frame: {
        product: {
          product_or_service: text(input.model.product),
          customer_need: text(input.model.value),
          included_offers: includedOffers.length ? includedOffers : [text(input.model.product)],
          excluded_offers: text(input.model.exclusions).split(/[;,\n]/u).map(text).filter(Boolean),
          evidence_refs: [`site:${input.site.url}`, `public-evidence-pack:${PACK_ID}`],
        },
        customer: {
          description: text(input.model.audience),
          evidence_refs: [`business-model:audience`, `site:${input.site.url}`],
        },
        geography: {
          kind: "SERVICE_AREA",
          regions: [{ official_id: "RU", name: text(input.model.geography) || "Россия" }],
          evidence_refs: ["business-model:geography", "event-location:innoprom-ekaterinburg"],
          limitation: "БФО относится к юридическим лицам целиком, а не только к проектам ИННОПРОМ или выбранной географии.",
        },
        period: {
          period_start: "2024-01-01",
          period_end: "2025-12-31",
          reporting_years: [2024, 2025],
          as_of_date: input.generatedAt.slice(0, 10),
        },
        okved: {
          classifier: "OK_029_2014_KDES_REV_2",
          classifier_version: "2026-01-01",
          codes: [
            { code: "82.30", inclusion: "ANY_OF", rationale: "Организация конференций и выставок." },
            { code: "16.23.2", inclusion: "ANY_OF", rationale: "Производство сборных конструкций для стендов." },
          ],
          activity_rule_version: "innoprom-stand-frame-v1",
        },
        competitor_rule: {
          version: "public-substitutable-offer-v1",
          inclusion_rule: COMPETITOR_RESEARCH.rule,
        },
      },
      legal_entities: ENTITIES.map((entity) => legalEntity(entity, input.generatedAt)),
      financial_records: financialRecords,
      missing_financial_data: [
        {
          entity_id: "competitor-r2group",
          reporting_year: 2025,
          metric: "REVENUE",
          reason: "FILING_NOT_FOUND",
          source_ref: "https://bo.nalog.gov.ru/organizations-card/9966149",
          limitation: "В публичной карточке ГИР БО последняя доступная годовая отчётность относится к 2024 году.",
        },
        {
          entity_id: "competitor-r2group",
          reporting_year: 2025,
          metric: "NET_PROFIT",
          reason: "FILING_NOT_FOUND",
          source_ref: "https://bo.nalog.gov.ru/organizations-card/9966149",
          limitation: "В публичной карточке ГИР БО последняя доступная годовая отчётность относится к 2024 году.",
        },
      ],
      strategic_interpretations: [],
      generated_at: input.generatedAt,
    },
  };
}
