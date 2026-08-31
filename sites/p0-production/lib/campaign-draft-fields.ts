export const DIRECT_DRAFT_FIELD_REGISTRY_SCHEMA = "direct-v501-draft-field-registry-v2";

export type DraftFieldClassification =
  | "EDITABLE"
  | "FIXED_BY_STRATEGY"
  | "FIXED_BY_CAPABILITY"
  | "CONDITIONALLY_ELIGIBLE";

export type DraftFieldRegistryEntry = {
  pointer: string;
  input_name: string | null;
  object_kind: "CAMPAIGN" | "AD_GROUP" | "CRITERION" | "AD" | "ASSET";
  label: string;
  classification: DraftFieldClassification;
  editable: boolean;
  presence: "PRESENT" | "NOT_PRESENT";
  capability: string | null;
  normalization: "COLLAPSED_TEXT" | "UNORDERED_TEXT_ARRAY" | "EXACT_PROVIDER_VALUE";
  maximum_length: number | null;
  reason: string;
};

const field = (
  pointer: string,
  objectKind: DraftFieldRegistryEntry["object_kind"],
  label: string,
  classification: DraftFieldClassification,
  options: Partial<Omit<DraftFieldRegistryEntry, "pointer" | "object_kind" | "label" | "classification">> = {},
): DraftFieldRegistryEntry => ({
  pointer,
  input_name: null,
  object_kind: objectKind,
  label,
  classification,
  editable: classification === "EDITABLE",
  presence: "PRESENT",
  capability: null,
  normalization: "EXACT_PROVIDER_VALUE",
  maximum_length: null,
  reason: classification === "FIXED_BY_STRATEGY"
    ? "Значение зафиксировано утверждённой Campaign Strategy."
    : classification === "FIXED_BY_CAPABILITY"
      ? "Значение зафиксировано принятым Direct v501 capability profile."
      : classification === "CONDITIONALLY_ELIGIBLE"
        ? "Поле отсутствует: требуется отдельная official API и exact-account capability eligibility."
        : "Изменение публикуется в точную Direct projection.",
  ...options,
});

export const DIRECT_V501_DRAFT_FIELD_REGISTRY = Object.freeze({
  schema_version: DIRECT_DRAFT_FIELD_REGISTRY_SCHEMA,
  profile_id: "p0-campaign-creation-profile-v1",
  profile_version: "1.0.0",
  api_version: "v501",
  fields: Object.freeze([
    field("/direct/campaign/Name", "CAMPAIGN", "Название кампании", "EDITABLE", { input_name: "campaign_name", normalization: "COLLAPSED_TEXT", maximum_length: 255 }),
    field("/direct/campaign/StartDate", "CAMPAIGN", "Дата начала", "FIXED_BY_STRATEGY"),
    field("/direct/campaign/EndDate", "CAMPAIGN", "Дата окончания", "FIXED_BY_STRATEGY"),
    field("/direct/campaign/TimeZone", "CAMPAIGN", "Часовой пояс", "FIXED_BY_CAPABILITY"),
    field("/direct/campaign/TimeTargeting", "CAMPAIGN", "Расписание", "FIXED_BY_CAPABILITY"),
    field("/direct/campaign/UnifiedCampaign/CounterIds", "CAMPAIGN", "Счётчик Метрики", "CONDITIONALLY_ELIGIBLE", {
      presence: "NOT_PRESENT",
      capability: "METRIKA_EXACT_BINDING",
      reason: "WB_MAXIMUM_CLICKS не потребляет Метрику; поле появляется только у профиля с проверенной exact binding и регистрацией цели.",
    }),
    field("/direct/campaign/UnifiedCampaign/TrackingParams", "CAMPAIGN", "Параметры отслеживания", "FIXED_BY_CAPABILITY"),
    field("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/BiddingStrategyType", "CAMPAIGN", "Стратегия поиска", "FIXED_BY_CAPABILITY"),
    field("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes/SearchResults", "CAMPAIGN", "Показы в результатах поиска", "FIXED_BY_CAPABILITY"),
    field("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes/ProductGallery", "CAMPAIGN", "Товарная галерея", "FIXED_BY_CAPABILITY", { capability: "PRODUCT_GALLERY" }),
    field("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/WeeklySpendLimit", "CAMPAIGN", "Недельный лимит расходов, micros", "FIXED_BY_STRATEGY"),
    field("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/BidCeiling", "CAMPAIGN", "Ограничение ставки, micros", "FIXED_BY_STRATEGY", { reason: "Технически нормализовано из утверждённого недельного бюджета." }),
    field("/direct/campaign/UnifiedCampaign/BiddingStrategy/Network/BiddingStrategyType", "CAMPAIGN", "Стратегия сетей", "FIXED_BY_CAPABILITY", { capability: "NETWORK" }),
    field("/direct/ad_group/Name", "AD_GROUP", "Название группы", "EDITABLE", { input_name: "group_name", normalization: "COLLAPSED_TEXT", maximum_length: 255 }),
    field("/direct/ad_group/RegionIds", "AD_GROUP", "Регионы", "FIXED_BY_STRATEGY", { normalization: "UNORDERED_TEXT_ARRAY" }),
    field("/direct/ad_group/NegativeKeywords/Items", "AD_GROUP", "Минус-фразы", "EDITABLE", { input_name: "negative_keywords", normalization: "UNORDERED_TEXT_ARRAY", maximum_length: 1_000 }),
    field("/direct/ad_group/UnifiedAdGroup/OfferRetargeting", "AD_GROUP", "Ретаргетинг офферов", "FIXED_BY_CAPABILITY"),
    field("/direct/keyword/Keyword", "CRITERION", "Ключевая фраза", "EDITABLE", { input_name: "keyword", normalization: "COLLAPSED_TEXT", maximum_length: 4_096 }),
    field("/direct/keyword/AutotargetingSettings", "CRITERION", "Настройки автотаргетинга", "CONDITIONALLY_ELIGIBLE", { presence: "NOT_PRESENT", capability: "AUTOTARGETING" }),
    field("/direct/ad/ResponsiveAd/Titles", "AD", "Заголовки объявления", "EDITABLE", { input_name: "ad_title", normalization: "COLLAPSED_TEXT", maximum_length: 56 }),
    field("/direct/ad/ResponsiveAd/Texts", "AD", "Тексты объявления", "EDITABLE", { input_name: "ad_text", normalization: "COLLAPSED_TEXT", maximum_length: 81 }),
    field("/direct/ad/ResponsiveAd/Href", "AD", "Посадочная страница", "FIXED_BY_STRATEGY"),
    field("/direct/ad/ResponsiveAd/SitelinkSetId", "ASSET", "Привязка набора быстрых ссылок", "CONDITIONALLY_ELIGIBLE", { presence: "NOT_PRESENT", capability: "SITELINKS" }),
    field("/direct/sitelink_sets", "ASSET", "Наборы быстрых ссылок", "CONDITIONALLY_ELIGIBLE", { presence: "NOT_PRESENT", capability: "SITELINKS" }),
  ] satisfies DraftFieldRegistryEntry[]),
});

export type AuctionProtocolEditorField = {
  key: string;
  label: string;
  control: "text" | "textarea" | "number" | "date";
  maximum_length: number | null;
  materiality: "NORMALIZATION_SENSITIVE_MATERIAL";
};

export const AUCTION_PROTOCOL_EDITOR_FIELDS = Object.freeze([
  { key: "control", label: "С чем сравниваем", control: "textarea", maximum_length: 1_000, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "tested_change", label: "Проверяемое изменение", control: "textarea", maximum_length: 1_000, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "bidding_strategy", label: "Подход к ставкам", control: "textarea", maximum_length: 300, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "bid_ceiling_rub", label: "Предел ставки, ₽", control: "number", maximum_length: null, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "query_matching", label: "Сопоставление запросов", control: "textarea", maximum_length: 500, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "autotargeting_policy", label: "Политика автотаргетинга", control: "textarea", maximum_length: 500, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "comparator_percent", label: "Доля сравнения, %", control: "number", maximum_length: null, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "treatment_percent", label: "Доля изменения, %", control: "number", maximum_length: null, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "test_budget_rub", label: "Бюджет теста, ₽", control: "number", maximum_length: null, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "start_date", label: "Начало теста", control: "date", maximum_length: null, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "end_date", label: "Окончание теста", control: "date", maximum_length: null, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "measurement_goal", label: "Измеряемый результат", control: "textarea", maximum_length: 1_000, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "success_threshold", label: "Условие успеха", control: "textarea", maximum_length: 1_000, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
  { key: "stop_condition", label: "Условие остановки", control: "textarea", maximum_length: 1_000, materiality: "NORMALIZATION_SENSITIVE_MATERIAL" },
] satisfies AuctionProtocolEditorField[]);

export type DraftEditorCapabilityBoundary = {
  capability: string;
  label: string;
  classification: "CONDITIONALLY_ELIGIBLE" | "UNSUPPORTED";
  reason: string;
};

export const DRAFT_EDITOR_CAPABILITY_BOUNDARIES = Object.freeze([
  {
    capability: "AUTOTARGETING",
    label: "Автотаргетинг",
    classification: "CONDITIONALLY_ELIGIBLE",
    reason: "Появится только после отдельного подтверждения официального API и возможностей выбранного аккаунта.",
  },
  {
    capability: "SITELINKS",
    label: "Быстрые ссылки",
    classification: "CONDITIONALLY_ELIGIBLE",
    reason: "Появятся только при подтверждённой поддержке аккаунта и правах на точные посадочные страницы.",
  },
  {
    capability: "PRODUCT_GALLERY",
    label: "Товарная галерея",
    classification: "UNSUPPORTED",
    reason: "Текущий профиль P0 публикует только поиск без товарной галереи.",
  },
  {
    capability: "NETWORK_SERVING",
    label: "Показы в сетях",
    classification: "UNSUPPORTED",
    reason: "Текущий профиль P0 фиксирует показы в сетях как отключённые.",
  },
  {
    capability: "MEDIA_ASSETS",
    label: "Изображения и видео",
    classification: "UNSUPPORTED",
    reason: "Текущий профиль P0 создаёт только поддерживаемое текстовое семейство объявлений.",
  },
  {
    capability: "CAMPAIGNS_RESUME",
    label: "Запуск показов и расходов",
    classification: "UNSUPPORTED",
    reason: "P0 создаёт кампании остановленными и не поддерживает возобновление показов.",
  },
] satisfies DraftEditorCapabilityBoundary[]);

export const CAMPAIGN_DRAFT_EDITOR_CONTRACT = Object.freeze({
  schema_version: "p0-campaign-draft-editor-contract-v1",
  profile_id: DIRECT_V501_DRAFT_FIELD_REGISTRY.profile_id,
  profile_version: DIRECT_V501_DRAFT_FIELD_REGISTRY.profile_version,
  publication_fields: DIRECT_V501_DRAFT_FIELD_REGISTRY.fields,
  auction_protocol_fields: AUCTION_PROTOCOL_EDITOR_FIELDS,
  capability_boundaries: DRAFT_EDITOR_CAPABILITY_BOUNDARIES,
  materiality: {
    normalization_only: "PRESERVE_EXACT_DRAFT_REVISION_AND_AUTHORITY",
    supported_publication_change: "CREATE_IMMUTABLE_DRAFT_REVISION_AND_REQUIRE_REVALIDATION",
    auction_protocol_change: "CREATE_IMMUTABLE_DRAFT_REVISION_AND_REQUIRE_REVALIDATION",
  },
});

function canonicalRegistryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalRegistryValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalRegistryValue(item)]),
  );
}

const canonicalRegistryJson = JSON.stringify(canonicalRegistryValue(DIRECT_V501_DRAFT_FIELD_REGISTRY));

export function isCanonicalDirectV501DraftFieldRegistry(value: unknown) {
  return JSON.stringify(canonicalRegistryValue(value)) === canonicalRegistryJson;
}

const editableFields = DIRECT_V501_DRAFT_FIELD_REGISTRY.fields.filter((item) => item.editable && item.input_name);

export function editableDraftFieldNames() {
  return editableFields.map((item) => String(item.input_name));
}

export function editableDraftPointer(inputName: string) {
  return editableFields.find((item) => item.input_name === inputName)?.pointer ?? null;
}

export function projectionFieldValue(projection: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  return pointer.slice(1).split("/").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }, projection);
}

function inputError(code: string, message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  throw error;
}

function normalizedText(value: unknown, label: string, maximum: number) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized) inputError("P0_INPUT_REQUIRED", `${label} не заполнено.`);
  if (normalized.length > maximum) inputError("P0_INPUT_TOO_LONG", `${label}: максимум ${maximum} символов.`);
  return normalized;
}

export function normalizeDraftFieldInput(value: Record<string, unknown>) {
  const accepted = new Set(["draft_id", ...editableDraftFieldNames()]);
  const unsupported = Object.keys(value).find((name) => !accepted.has(name));
  if (unsupported) inputError(
    "P0_DRAFT_FIELD_UNSUPPORTED",
    `Campaign Draft field ${unsupported} is not editable in the current exact projection contract and was not applied.`,
  );
  const result: Record<string, string> = {
    draft_id: normalizedText(value.draft_id, "Campaign Draft", 255),
  };
  for (const registryField of editableFields) {
    const inputName = String(registryField.input_name);
    result[inputName] = normalizedText(value[inputName], registryField.label, Number(registryField.maximum_length));
  }
  return result as {
    draft_id: string;
    campaign_name: string;
    group_name: string;
    negative_keywords: string;
    keyword: string;
    ad_title: string;
    ad_text: string;
  };
}

export function nextDraftRevisionId(draftId: string, previousRevisionId: string) {
  const escaped = draftId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^${escaped}-r(\\d+)$`, "u").exec(previousRevisionId);
  if (!match) throw new Error("Campaign Draft revision lineage is invalid.");
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Campaign Draft revision lineage is invalid.");
  return `${draftId}-r${revision + 1}`;
}
