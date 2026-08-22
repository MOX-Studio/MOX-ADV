export const DIRECT_AUDIT_SCHEMA = "direct-read-audit-v1";
export const DIRECT_AUDIT_SUMMARY_SCHEMA = "direct-read-audit-summary-v1";

export type DirectAuditCollection =
  | "campaigns"
  | "adgroups"
  | "audiencetargets"
  | "keywords"
  | "ads"
  | "sitelinks"
  | "adimages"
  | "vcards"
  | "creatives"
  | "adextensions";

type DirectAuditArtifactKind =
  | "DIRECT_CAMPAIGNS_PAGE"
  | "DIRECT_ADGROUPS_PAGE"
  | "DIRECT_AUDIENCE_TARGETS_PAGE"
  | "DIRECT_KEYWORDS_PAGE"
  | "DIRECT_ADS_PAGE"
  | "DIRECT_SITELINKS_PAGE"
  | "DIRECT_ADIMAGES_PAGE"
  | "DIRECT_VCARDS_PAGE"
  | "DIRECT_CREATIVES_PAGE"
  | "DIRECT_ADEXTENSIONS_PAGE"
  | "DIRECT_REPORT_TSV"
  | "DIRECT_AUDIT_MANIFEST";

export type DirectAuditArtifactReference = {
  artifact_id: string;
  audit_id: string;
  kind: DirectAuditArtifactKind;
  digest: string;
  byte_length: number;
  object_count: number;
  observed_at: string;
};

export type DirectAuditArtifact = {
  reference: DirectAuditArtifactReference;
  owner_key: string;
  account: string;
  value: unknown;
};

export type DirectAuditBinding = {
  expected_account: string;
  api_account: string;
  client_id: string;
  matched: boolean;
  restrictions: Array<{ element: string; value: number }>;
  observed_at: string;
};

export type DirectAuditGetPageInput = {
  collection: DirectAuditCollection;
  service: string;
  result_key: string;
  semantic_method: "get";
  params: Record<string, unknown>;
};

export type DirectAuditGetPageResult = {
  objects: Array<Record<string, unknown>>;
  limited_by: number | null;
  warnings: Array<{ code: string; message: string }>;
  request_id?: string | null;
  units?: string | null;
};

export type DirectAuditReportDefinition = {
  report_key: string;
  report_type: "CAMPAIGN_PERFORMANCE_REPORT" | "SEARCH_QUERY_PERFORMANCE_REPORT";
  processing_mode: "auto" | "offline";
  request: Record<string, unknown>;
};

export type DirectAuditReportResult = {
  http_status: 200 | 201 | 202;
  retry_in_ms: number | null;
  body: string | null;
  warnings: Array<{ code: string; message: string }>;
  request_id?: string | null;
  units?: string | null;
};

export function buildDirectAuditReportDefinitions(input: {
  auditId: string;
  dateFrom: string;
  dateTo: string;
}): DirectAuditReportDefinition[] {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.dateFrom)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(input.dateTo)
    || input.dateFrom > input.dateTo) {
    throw new Error("Direct audit report dates are invalid.");
  }
  const reportIdentity = input.auditId.replace(/[^a-z0-9-]+/giu, "-").replace(/^-+|-+$/gu, "").slice(0, 120);
  if (!reportIdentity) throw new Error("Direct audit report identity is invalid.");
  const base = {
    SelectionCriteria: { DateFrom: input.dateFrom, DateTo: input.dateTo },
    DateRangeType: "CUSTOM_DATE",
    Format: "TSV",
    IncludeVAT: "YES",
    IncludeDiscount: "NO",
  };
  return [
    {
      report_key: "campaign-performance",
      report_type: "CAMPAIGN_PERFORMANCE_REPORT",
      processing_mode: "auto",
      request: {
        params: {
          ...base,
          FieldNames: ["Date", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", "AvgCpc", "Conversions", "ConversionRate", "CostPerConversion"],
          ReportName: `${reportIdentity}-campaign-performance`,
          ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        },
      },
    },
    {
      report_key: "search-query-performance",
      report_type: "SEARCH_QUERY_PERFORMANCE_REPORT",
      processing_mode: "offline",
      request: {
        params: {
          ...base,
          FieldNames: ["Date", "CampaignId", "AdGroupId", "Query", "MatchedKeyword", "CriteriaId", "Impressions", "Clicks", "Cost", "AvgCpc", "Conversions", "CostPerConversion"],
          ReportName: `${reportIdentity}-search-query-performance`,
          ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
        },
      },
    },
  ];
}

export interface DirectAuditReadProvider {
  getPage(input: DirectAuditGetPageInput): Promise<DirectAuditGetPageResult>;
  requestReport(definition: DirectAuditReportDefinition): Promise<DirectAuditReportResult>;
}

export class DirectAuditProviderError extends Error {
  readonly code: string;
  readonly disposition: "RETRYABLE" | "UNAVAILABLE";
  readonly retry_at: string | null;

  constructor(input: {
    code: string;
    message: string;
    disposition: "RETRYABLE" | "UNAVAILABLE";
    retry_at: string | null;
  }) {
    super(input.message);
    this.name = "DirectAuditProviderError";
    this.code = text(input.code, 100) || "DIRECT_PROVIDER_ERROR";
    this.disposition = input.disposition;
    this.retry_at = input.retry_at;
  }
}

type CollectionCheckpoint = {
  status: "PENDING" | "COMPLETE" | "UNAVAILABLE";
  scope_index: number;
  offset: number;
  object_count: number;
  artifact_references: DirectAuditArtifactReference[];
  warnings: Array<{ code: string; message: string }>;
  limitation: string | null;
  next_retry_at: string | null;
};

type ReportCheckpoint = {
  report_key: string;
  report_type: DirectAuditReportDefinition["report_type"];
  processing_mode: DirectAuditReportDefinition["processing_mode"];
  request: Record<string, unknown>;
  status: "NOT_REQUESTED" | "QUEUED" | "COMPLETE" | "UNAVAILABLE";
  attempts: number;
  next_retry_at: string | null;
  artifact_reference: DirectAuditArtifactReference | null;
  warnings: Array<{ code: string; message: string }>;
  limitation: string | null;
};

export type DirectAuditCheckpoint = {
  schema_version: typeof DIRECT_AUDIT_SCHEMA;
  audit_id: string;
  version: number;
  owner_key: string;
  account: string;
  client_id: string;
  binding: DirectAuditBinding;
  status: "RUNNING" | "PENDING" | "COMPLETE" | "PARTIAL";
  collections: Record<DirectAuditCollection, CollectionCheckpoint>;
  reports: ReportCheckpoint[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export interface DirectAuditStore {
  loadCurrent(ownerKey: string, account: string): Promise<DirectAuditCheckpoint | null>;
  start(state: DirectAuditCheckpoint, expectedAuditId: string | null): Promise<boolean>;
  compareAndSwap(auditId: string, expectedVersion: number, state: DirectAuditCheckpoint): Promise<boolean>;
  putArtifact(artifact: DirectAuditArtifact): Promise<DirectAuditArtifactReference>;
  getArtifact(artifactId: string): Promise<unknown | null>;
}

export type DirectAuditSummary = {
  schema_version: typeof DIRECT_AUDIT_SUMMARY_SCHEMA;
  audit_id: string;
  status: "PENDING" | "COMPLETE" | "PARTIAL";
  graph_complete: boolean;
  observed_at: string;
  completed_at: string | null;
  account_binding: {
    expected_account: string;
    api_account: string;
    client_id: string;
    matched: true;
  };
  provider_restrictions: Array<{ element: string; value: number }>;
  object_counts: Record<DirectAuditCollection | "autotargetings", number>;
  campaign_summaries: Array<{
    campaign_id: string;
    name: string;
    type: string;
    state: string;
    status: string;
  }>;
  report_summaries: Array<{
    report_key: string;
    report_type: string;
    status: string;
    next_retry_at: string | null;
    artifact_reference: DirectAuditArtifactReference | null;
  }>;
  methods_read: string[];
  methods_not_read: string[];
  limitations: string[];
  next_retry_at: string | null;
  artifact_references: DirectAuditArtifactReference[];
  browser_cabinet_used: false;
  provider_write_methods_reachable: false;
};

const COLLECTION_ORDER: DirectAuditCollection[] = [
  "campaigns",
  "adgroups",
  "audiencetargets",
  "keywords",
  "ads",
  "sitelinks",
  "adimages",
  "vcards",
  "creatives",
  "adextensions",
];

const COLLECTION_CONFIG: Record<DirectAuditCollection, {
  service: string;
  resultKey: string;
  artifactKind: DirectAuditArtifactKind;
  method: string;
  fieldNames: string[];
  additionalParams?: Record<string, unknown>;
  documentedRead?: boolean;
  unavailableReason?: string;
}> = {
  campaigns: {
    service: "Campaigns",
    resultKey: "Campaigns",
    artifactKind: "DIRECT_CAMPAIGNS_PAGE",
    method: "Campaigns.get",
    fieldNames: [
      "Id", "Name", "StartDate", "EndDate", "Type", "Status", "State", "StatusPayment",
      "StatusClarification", "Currency", "Funds", "Statistics", "DailyBudget", "NegativeKeywords",
      "BlockedIps", "ExcludedSites", "TimeTargeting", "TimeZone", "ClientInfo",
    ],
    additionalParams: {
      TextCampaignFieldNames: ["CounterIds", "Settings", "BiddingStrategy", "PriorityGoals", "AttributionModel", "PackageBiddingStrategy", "CanBeUsedAsPackageBiddingStrategySource", "NegativeKeywordSharedSetIds"],
      TextCampaignSearchStrategyPlacementTypesFieldNames: ["SearchResults", "ProductGallery", "DynamicPlaces"],
      MobileAppCampaignFieldNames: ["Settings", "BiddingStrategy", "PackageBiddingStrategy", "CanBeUsedAsPackageBiddingStrategySource", "NegativeKeywordSharedSetIds"],
      CpmBannerCampaignFieldNames: ["CounterIds", "FrequencyCap", "VideoTarget", "Settings", "BiddingStrategy", "ExcludedSitesForVideoAds"],
      UnifiedCampaignFieldNames: ["CounterIds", "Settings", "BiddingStrategy", "PriorityGoals", "TrackingParams", "AttributionModel", "PackageBiddingStrategy", "CanBeUsedAsPackageBiddingStrategySource"],
      UnifiedCampaignSearchStrategyPlacementTypesFieldNames: ["SearchResults", "ProductGallery", "DynamicPlaces", "Maps", "SearchOrganizationList"],
      UnifiedCampaignPackageBiddingStrategyPlatformsFieldNames: ["SearchResult", "ProductGallery", "Maps", "SearchOrganizationList", "Network", "DynamicPlaces"],
    },
  },
  adgroups: {
    service: "AdGroups",
    resultKey: "AdGroups",
    artifactKind: "DIRECT_ADGROUPS_PAGE",
    method: "AdGroups.get",
    fieldNames: ["Id", "Name", "CampaignId", "RegionIds", "RestrictedRegionIds", "NegativeKeywords", "NegativeKeywordSharedSetIds", "TrackingParams", "Status", "ServingStatus", "Type", "Subtype"],
    additionalParams: { UnifiedAdGroupFieldNames: ["OfferRetargeting"] },
  },
  audiencetargets: {
    service: "AudienceTargets",
    resultKey: "AudienceTargets",
    artifactKind: "DIRECT_AUDIENCE_TARGETS_PAGE",
    method: "AudienceTargets.get",
    fieldNames: ["Id", "AdGroupId", "CampaignId", "RetargetingListId", "InterestId", "ContextBid", "StrategyPriority", "State"],
  },
  keywords: {
    service: "Keywords",
    resultKey: "Keywords",
    artifactKind: "DIRECT_KEYWORDS_PAGE",
    method: "Keywords.get",
    fieldNames: ["Id", "Keyword", "State", "Status", "ServingStatus", "AdGroupId", "CampaignId", "Bid", "AutotargetingSearchBidIsAuto", "ContextBid", "StrategyPriority", "UserParam1", "UserParam2", "AutotargetingSettings"],
    additionalParams: {
      AutotargetingSettingsCategoriesFieldNames: ["Exact", "Narrow", "Alternative", "Accessory", "Broader"],
      AutotargetingSettingsBrandOptionsFieldNames: ["WithoutBrands", "WithAdvertiserBrand", "WithCompetitorsBrand"],
    },
  },
  ads: {
    service: "Ads",
    resultKey: "Ads",
    artifactKind: "DIRECT_ADS_PAGE",
    method: "Ads.get",
    fieldNames: ["Id", "CampaignId", "AdGroupId", "Status", "State", "StatusClarification", "Type", "Subtype", "AdCategories", "AgeLabel"],
    additionalParams: {
      TextAdFieldNames: ["Title", "Title2", "Text", "Href", "Mobile", "DisplayDomain", "DisplayUrlPath", "VCardId", "AdImageHash", "SitelinkSetId", "DisplayUrlPathModeration", "VCardModeration", "SitelinksModeration", "AdImageModeration", "AdExtensions", "BusinessId", "PreferVCardOverBusiness", "ErirAdDescription", "AutogeneratedErirAdDescription"],
      DynamicTextAdFieldNames: ["VCardId", "AdImageHash", "SitelinkSetId", "VCardModeration", "SitelinksModeration", "AdImageModeration", "AdExtensions", "Text", "ErirAdDescription", "AutogeneratedErirAdDescription"],
      ResponsiveAdFieldNames: ["Titles", "Texts", "ActionButton", "Href", "DisplayDomain", "DisplayUrlPath", "AdImages", "SitelinkSetId", "DisplayUrlPathModeration", "SitelinksModeration", "AdExtensions", "BusinessId", "ErirAdDescription"],
    },
  },
  sitelinks: { service: "Sitelinks", resultKey: "SitelinksSets", artifactKind: "DIRECT_SITELINKS_PAGE", method: "Sitelinks.get", fieldNames: ["Id", "Sitelinks"] },
  adimages: { service: "AdImages", resultKey: "AdImages", artifactKind: "DIRECT_ADIMAGES_PAGE", method: "AdImages.get", fieldNames: ["AdImageHash", "OriginalUrl", "PreviewUrl", "Name", "Type", "Subtype", "Associated"] },
  vcards: {
    service: "VCards",
    resultKey: "VCards",
    artifactKind: "DIRECT_VCARDS_PAGE",
    method: "VCards.get",
    fieldNames: [],
    documentedRead: false,
    unavailableReason: "DIRECT_PROVIDER_LIMITATION: current official Direct API index does not publish a VCards.get contract.",
  },
  creatives: { service: "Creatives", resultKey: "Creatives", artifactKind: "DIRECT_CREATIVES_PAGE", method: "Creatives.get", fieldNames: ["Id", "Name", "Type", "PreviewUrl", "Width", "Height", "ThumbnailUrl", "Associated", "IsAdaptive"] },
  adextensions: {
    service: "AdExtensions",
    resultKey: "AdExtensions",
    artifactKind: "DIRECT_ADEXTENSIONS_PAGE",
    method: "AdExtensions.get",
    fieldNames: ["Id", "Type", "Status", "StatusClarification", "Associated"],
    additionalParams: { CalloutFieldNames: ["CalloutText"] },
  },
};

const PAGE_LIMIT = 1_000;
const MAX_SUMMARY_ARTIFACT_REFERENCES = 48;

function text(value: unknown, maximum = 2_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function exactKeys(value: unknown, expected: string[]) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify([...expected].sort());
}

function validArtifactReference(reference: DirectAuditArtifactReference, auditId: string) {
  return exactKeys(reference, ["artifact_id", "audit_id", "kind", "digest", "byte_length", "object_count", "observed_at"])
    && Boolean(text(reference.artifact_id, 2_000))
    && reference.audit_id === auditId
    && Boolean(text(reference.kind, 100))
    && Boolean(text(reference.digest, 255))
    && Number.isSafeInteger(reference.byte_length)
    && reference.byte_length >= 0
    && Number.isSafeInteger(reference.object_count)
    && reference.object_count >= 0
    && Number.isFinite(Date.parse(reference.observed_at));
}

export function sanitizeDirectAuditSummary(value: unknown): DirectAuditSummary {
  const summary = value && typeof value === "object" && !Array.isArray(value)
    ? value as DirectAuditSummary
    : null;
  const topLevelKeys = [
    "schema_version", "audit_id", "status", "graph_complete", "observed_at", "completed_at",
    "account_binding", "provider_restrictions", "object_counts", "campaign_summaries", "report_summaries",
    "methods_read", "methods_not_read", "limitations", "next_retry_at", "artifact_references",
    "browser_cabinet_used", "provider_write_methods_reachable",
  ];
  const countKeys = [...COLLECTION_ORDER, "autotargetings"];
  const invalid = !summary
    || !exactKeys(summary, topLevelKeys)
    || summary.schema_version !== DIRECT_AUDIT_SUMMARY_SCHEMA
    || !text(summary.audit_id, 255)
    || !["PENDING", "COMPLETE", "PARTIAL"].includes(summary.status)
    || typeof summary.graph_complete !== "boolean"
    || !Number.isFinite(Date.parse(summary.observed_at))
    || (summary.completed_at !== null && !Number.isFinite(Date.parse(summary.completed_at)))
    || (["COMPLETE", "PARTIAL"].includes(summary.status) && summary.completed_at === null)
    || (summary.next_retry_at !== null && !Number.isFinite(Date.parse(summary.next_retry_at)))
    || !exactKeys(summary.account_binding, ["expected_account", "api_account", "client_id", "matched"])
    || summary.account_binding.matched !== true
    || !text(summary.account_binding.expected_account, 255)
    || summary.account_binding.expected_account !== summary.account_binding.api_account
    || !text(summary.account_binding.client_id, 100)
    || !exactKeys(summary.object_counts, countKeys)
    || countKeys.some((key) => !Number.isSafeInteger(summary.object_counts[key as keyof typeof summary.object_counts])
      || summary.object_counts[key as keyof typeof summary.object_counts] < 0)
    || !Array.isArray(summary.provider_restrictions)
    || summary.provider_restrictions.length > 100
    || summary.provider_restrictions.some((item) => !exactKeys(item, ["element", "value"])
      || !text(item.element, 100) || !Number.isFinite(item.value))
    || !Array.isArray(summary.campaign_summaries)
    || summary.campaign_summaries.length > 20
    || summary.campaign_summaries.some((item) => !exactKeys(item, ["campaign_id", "name", "type", "state", "status"])
      || !text(item.campaign_id, 100))
    || !Array.isArray(summary.report_summaries)
    || summary.report_summaries.length > 10
    || summary.report_summaries.some((item) => !exactKeys(item, ["report_key", "report_type", "status", "next_retry_at", "artifact_reference"])
      || !text(item.report_key, 100)
      || !text(item.report_type, 100)
      || !["NOT_REQUESTED", "QUEUED", "COMPLETE", "UNAVAILABLE"].includes(item.status)
      || (item.next_retry_at !== null && !Number.isFinite(Date.parse(item.next_retry_at)))
      || (item.artifact_reference !== null && !validArtifactReference(item.artifact_reference, summary.audit_id)))
    || !Array.isArray(summary.methods_read)
    || !Array.isArray(summary.methods_not_read)
    || !Array.isArray(summary.limitations)
    || summary.methods_read.length > 100
    || summary.methods_not_read.length > 100
    || summary.limitations.length > 100
    || [...summary.methods_read, ...summary.methods_not_read, ...summary.limitations].some((item) => typeof item !== "string" || item.length > 1_000)
    || !Array.isArray(summary.artifact_references)
    || summary.artifact_references.length > MAX_SUMMARY_ARTIFACT_REFERENCES
    || summary.artifact_references.some((reference) => !validArtifactReference(reference, summary.audit_id))
    || summary.browser_cabinet_used !== false
    || summary.provider_write_methods_reachable !== false
    || JSON.stringify(summary).length > 60_000;
  if (invalid) throw new Error("Direct audit summary violates the bounded read-only safety contract.");
  return structuredClone(summary);
}

function redactArtifactText(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, "Bearer [REDACTED]")
    .replace(/\bOAuth\s+[A-Za-z0-9._~+/-]+=*/giu, "OAuth [REDACTED]")
    .replace(/([?&](?:access_token|api_key|token)=)[^&\s]+/giu, "$1[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[REDACTED_EMAIL]")
    .replace(/\+\d[\d ()-]{8,}\d/gu, "[REDACTED_PHONE]");
}

function redactArtifactValue(value: unknown): unknown {
  if (typeof value === "string") return redactArtifactText(value);
  if (Array.isArray(value)) return value.map(redactArtifactValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactArtifactValue(item)]));
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
  return `sha256:${[...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function blankCollection(): CollectionCheckpoint {
  return {
    status: "PENDING",
    scope_index: 0,
    offset: 0,
    object_count: 0,
    artifact_references: [],
    warnings: [],
    limitation: null,
    next_retry_at: null,
  };
}

function freshState(input: {
  auditId: string;
  ownerKey: string;
  binding: DirectAuditBinding;
  reportDefinitions: DirectAuditReportDefinition[];
  now: string;
}): DirectAuditCheckpoint {
  return {
    schema_version: DIRECT_AUDIT_SCHEMA,
    audit_id: input.auditId,
    version: 0,
    owner_key: input.ownerKey,
    account: input.binding.api_account,
    client_id: input.binding.client_id,
    binding: structuredClone(input.binding),
    status: "RUNNING",
    collections: Object.fromEntries(COLLECTION_ORDER.map((collection) => [collection, blankCollection()])) as Record<DirectAuditCollection, CollectionCheckpoint>,
    reports: input.reportDefinitions.map((definition) => ({
      report_key: definition.report_key,
      report_type: definition.report_type,
      processing_mode: definition.processing_mode,
      request: structuredClone(definition.request),
      status: "NOT_REQUESTED",
      attempts: 0,
      next_retry_at: null,
      artifact_reference: null,
      warnings: [],
      limitation: null,
    })),
    created_at: input.now,
    updated_at: input.now,
    completed_at: null,
  };
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function nestedValues(value: unknown, names: Set<string>, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) nestedValues(item, names, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (names.has(key)) {
      if (Array.isArray(item)) {
        for (const child of item) {
          const candidate = text(child, 255);
          if (candidate) output.push(candidate);
        }
      } else {
        const candidate = text(item, 255);
        if (candidate) output.push(candidate);
      }
    }
    nestedValues(item, names, output);
  }
  return output;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function artifactObjects(
  store: DirectAuditStore,
  references: DirectAuditArtifactReference[],
) {
  const objects: Array<Record<string, unknown>> = [];
  for (const reference of references) {
    const value = await store.getArtifact(reference.artifact_id);
    if (value === null) throw new Error(`Durable Direct audit artifact ${reference.artifact_id} is missing.`);
    const page = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (Array.isArray(page.objects)) {
      for (const item of page.objects) {
        if (item && typeof item === "object" && !Array.isArray(item)) objects.push(item as Record<string, unknown>);
      }
    }
  }
  return objects;
}

function allArtifactReferences(state: DirectAuditCheckpoint) {
  return [
    ...COLLECTION_ORDER.flatMap((collection) => state.collections[collection].artifact_references),
    ...state.reports.flatMap((report) => report.artifact_reference ? [report.artifact_reference] : []),
  ];
}

function isoAfter(value: string, milliseconds: number) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || !Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error("Direct report retry timing is invalid.");
  }
  return new Date(timestamp + milliseconds).toISOString();
}

function reportRowCount(value: string) {
  const rows = value.split(/\r?\n/u).filter(Boolean);
  return Math.max(0, rows.length - 1);
}

async function collectionScopes(
  collection: DirectAuditCollection,
  state: DirectAuditCheckpoint,
  store: DirectAuditStore,
): Promise<Array<Record<string, unknown>>> {
  if (collection === "campaigns") return [{}];
  const campaignObjects = await artifactObjects(store, state.collections.campaigns.artifact_references);
  const campaignIds = unique(campaignObjects.map((item) => text(item.Id, 100)));
  if (["adgroups", "keywords", "ads"].includes(collection)) {
    return chunks(campaignIds, 10).map((ids) => ({ CampaignIds: ids }));
  }
  if (collection === "audiencetargets") {
    return chunks(campaignIds, 100).map((ids) => ({ CampaignIds: ids }));
  }
  const adObjects = await artifactObjects(store, state.collections.ads.artifact_references);
  const keys = collection === "sitelinks"
    ? new Set(["SitelinkSetId"])
    : collection === "adimages"
      ? new Set(["AdImageHash", "ImageHash"])
      : collection === "vcards"
        ? new Set(["VCardId"])
        : collection === "creatives"
          ? new Set(["CreativeId"])
          : new Set(["AdExtensionId"]);
  const ids = unique(nestedValues(adObjects, keys));
  return chunks(ids, 10_000).map((items) => collection === "adimages" ? { AdImageHashes: items } : { Ids: items });
}

function boundedWarnings(warnings: DirectAuditGetPageResult["warnings"]) {
  return warnings.slice(0, 100).map((warning) => ({
    code: text(warning.code, 100) || "DIRECT_WARNING",
    message: text(warning.message, 500) || "Direct provider warning",
  }));
}

function warningLimitations(state: DirectAuditCheckpoint) {
  return COLLECTION_ORDER.flatMap((collection) => state.collections[collection].warnings.map((warning) => (
    `${COLLECTION_CONFIG[collection].method}: ${warning.code} — ${warning.message}`
  )));
}

async function criterionCoverageGaps(state: DirectAuditCheckpoint, store: DirectAuditStore) {
  const adGroups = await artifactObjects(store, state.collections.adgroups.artifact_references);
  const types = new Set(adGroups.map((item) => text(item.Type, 100)));
  const methods: string[] = [];
  const limitations: string[] = [];
  if (types.has("DYNAMIC_TEXT_AD_GROUP")) {
    methods.push("DynamicTextAdTargets.get");
    limitations.push("DIRECT_PROVIDER_LIMITATION: the current official Direct API index does not publish a DynamicTextAdTargets.get contract for discovered dynamic groups.");
  }
  if (types.has("SMART_AD_GROUP")) {
    methods.push("SmartAdTargets.get");
    limitations.push("DIRECT_PROVIDER_LIMITATION: the current official Direct API index does not publish a SmartAdTargets.get contract for discovered smart groups.");
  }
  return { methods, limitations };
}

class DirectAuditCheckpointConflict extends Error {
  constructor() {
    super("Direct audit checkpoint changed concurrently.");
    this.name = "DirectAuditCheckpointConflict";
  }
}

export class DirectAccountAuditor {
  private readonly ownerKey: string;
  private readonly binding: DirectAuditBinding;
  private readonly provider: DirectAuditReadProvider;
  private readonly store: DirectAuditStore;
  private readonly now: () => string;
  private readonly auditId: () => string;
  private readonly reportDefinitions: DirectAuditReportDefinition[];
  private readonly maxAgeMs: number;

  constructor(input: {
    ownerKey: string;
    binding: DirectAuditBinding;
    provider: DirectAuditReadProvider;
    store: DirectAuditStore;
    now: () => string;
    auditId?: () => string;
    reportDefinitions: DirectAuditReportDefinition[];
    maxAgeMs?: number;
  }) {
    this.ownerKey = text(input.ownerKey, 500);
    this.binding = structuredClone(input.binding);
    this.provider = input.provider;
    this.store = input.store;
    this.now = input.now;
    this.auditId = input.auditId ?? (() => `direct-audit:${crypto.randomUUID()}`);
    this.reportDefinitions = structuredClone(input.reportDefinitions);
    this.maxAgeMs = input.maxAgeMs ?? 5 * 60_000;
    if (!this.ownerKey) throw new Error("Direct audit owner key is required.");
    if (!Number.isSafeInteger(this.maxAgeMs) || this.maxAgeMs <= 0) throw new Error("Direct audit maximum age is invalid.");
    if (!this.binding.matched
      || !this.binding.expected_account
      || this.binding.expected_account !== this.binding.api_account
      || !this.binding.client_id) {
      throw new Error("Direct audit requires an exact advertiser/account binding.");
    }
  }

  private async save(state: DirectAuditCheckpoint) {
    const expectedVersion = state.version;
    state.version += 1;
    state.updated_at = this.now();
    if (!await this.store.compareAndSwap(state.audit_id, expectedVersion, state)) {
      throw new DirectAuditCheckpointConflict();
    }
  }

  private async loadOrStart() {
    const current = await this.store.loadCurrent(this.ownerKey, this.binding.api_account);
    const timestamp = this.now();
    if (current && current.schema_version === DIRECT_AUDIT_SCHEMA) {
      const completedAt = Date.parse(current.completed_at ?? "");
      const currentTime = Date.parse(timestamp);
      const staleTerminalAudit = ["COMPLETE", "PARTIAL"].includes(current.status)
        && Number.isFinite(completedAt)
        && Number.isFinite(currentTime)
        && currentTime - completedAt > this.maxAgeMs;
      if (!staleTerminalAudit) return current;
    }
    const state = freshState({
      auditId: this.auditId(),
      ownerKey: this.ownerKey,
      binding: this.binding,
      reportDefinitions: this.reportDefinitions,
      now: timestamp,
    });
    if (!await this.store.start(state, current?.audit_id ?? null)) {
      const raced = await this.store.loadCurrent(this.ownerKey, this.binding.api_account);
      if (raced) return raced;
      throw new Error("Direct audit checkpoint could not be initialized.");
    }
    return state;
  }

  private async collectGraph(state: DirectAuditCheckpoint) {
    for (const collection of COLLECTION_ORDER) {
      const checkpoint = state.collections[collection];
      if (checkpoint.status !== "PENDING") continue;
      if (checkpoint.next_retry_at && Date.parse(this.now()) < Date.parse(checkpoint.next_retry_at)) {
        return false;
      }
      const scopes = await collectionScopes(collection, state, this.store);
      if (!scopes.length) {
        checkpoint.status = "COMPLETE";
        await this.save(state);
        continue;
      }
      const config = COLLECTION_CONFIG[collection];
      if (config.documentedRead === false) {
        checkpoint.status = "UNAVAILABLE";
        checkpoint.limitation = config.unavailableReason ?? `${config.method} is not documented for the current provider version.`;
        await this.save(state);
        continue;
      }
      while (checkpoint.scope_index < scopes.length) {
        const selectionCriteria = scopes[checkpoint.scope_index];
        const params = {
          SelectionCriteria: selectionCriteria,
          FieldNames: config.fieldNames,
          ...(config.additionalParams ?? {}),
          Page: { Limit: PAGE_LIMIT, Offset: checkpoint.offset },
        };
        let page: DirectAuditGetPageResult;
        try {
          page = await this.provider.getPage({
            collection,
            service: config.service,
            result_key: config.resultKey,
            semantic_method: "get",
            params,
          });
        } catch (error) {
          if (!(error instanceof DirectAuditProviderError)) throw error;
          if (error.disposition === "RETRYABLE") {
            if (!error.retry_at || !Number.isFinite(Date.parse(error.retry_at))) {
              throw new Error(`${error.code} did not provide valid retry timing.`);
            }
            checkpoint.next_retry_at = error.retry_at;
            state.status = "PENDING";
            await this.save(state);
            return false;
          }
          checkpoint.status = "UNAVAILABLE";
          checkpoint.limitation = `${error.code}: ${text(error.message, 500)}`;
          checkpoint.next_retry_at = null;
          await this.save(state);
          break;
        }
        checkpoint.next_retry_at = null;
        const warnings = boundedWarnings(page.warnings ?? []);
        const pageValue = {
          schema_version: "direct-read-audit-page-v1",
          collection,
          service: config.service,
          semantic_method: "get",
          selection_criteria: selectionCriteria,
          page: { limit: PAGE_LIMIT, offset: checkpoint.offset, limited_by: page.limited_by },
          request_id: text(page.request_id, 255) || null,
          units: text(page.units, 255) || null,
          warnings,
          objects: redactArtifactValue(structuredClone(page.objects)),
        };
        const pageDigest = await digest(pageValue);
        const encoded = JSON.stringify(pageValue);
        const reference: DirectAuditArtifactReference = {
          artifact_id: `${state.audit_id}:${collection}:${checkpoint.scope_index}:${checkpoint.offset}:${pageDigest.slice("sha256:".length, "sha256:".length + 16)}`,
          audit_id: state.audit_id,
          kind: config.artifactKind,
          digest: pageDigest,
          byte_length: new TextEncoder().encode(encoded).byteLength,
          object_count: page.objects.length,
          observed_at: this.now(),
        };
        await this.store.putArtifact({
          reference,
          owner_key: state.owner_key,
          account: state.account,
          value: pageValue,
        });
        checkpoint.artifact_references.push(reference);
        checkpoint.object_count += page.objects.length;
        checkpoint.warnings.push(...warnings);
        if (page.limited_by === null || page.limited_by === undefined) {
          checkpoint.scope_index += 1;
          checkpoint.offset = 0;
        } else {
          if (!Number.isSafeInteger(page.limited_by) || page.limited_by <= checkpoint.offset) {
            throw new Error(`${config.method} returned a non-progressing LimitedBy cursor.`);
          }
          checkpoint.offset = page.limited_by;
        }
        await this.save(state);
      }
      if (checkpoint.status === "PENDING") {
        checkpoint.status = "COMPLETE";
        await this.save(state);
      }
    }
    return true;
  }

  private async collectReports(state: DirectAuditCheckpoint) {
    for (const checkpoint of state.reports) {
      if (["COMPLETE", "UNAVAILABLE"].includes(checkpoint.status)) continue;
      const timestamp = this.now();
      if (checkpoint.status === "QUEUED"
        && checkpoint.next_retry_at
        && Date.parse(timestamp) < Date.parse(checkpoint.next_retry_at)) {
        return false;
      }
      const definition: DirectAuditReportDefinition = {
        report_key: checkpoint.report_key,
        report_type: checkpoint.report_type,
        processing_mode: checkpoint.processing_mode,
        request: structuredClone(checkpoint.request),
      };
      let result: DirectAuditReportResult;
      try {
        result = await this.provider.requestReport(definition);
      } catch (error) {
        if (!(error instanceof DirectAuditProviderError)) throw error;
        checkpoint.attempts += 1;
        if (error.disposition === "RETRYABLE") {
          if (!error.retry_at || !Number.isFinite(Date.parse(error.retry_at))) {
            throw new Error(`${error.code} did not provide valid retry timing.`);
          }
          checkpoint.status = "QUEUED";
          checkpoint.next_retry_at = error.retry_at;
          state.status = "PENDING";
          await this.save(state);
          return false;
        }
        checkpoint.status = "UNAVAILABLE";
        checkpoint.limitation = `${error.code}: ${text(error.message, 500)}`;
        checkpoint.next_retry_at = null;
        await this.save(state);
        continue;
      }
      checkpoint.attempts += 1;
      checkpoint.warnings.push(...boundedWarnings(result.warnings ?? []));
      if ([201, 202].includes(result.http_status)) {
        if (!Number.isFinite(result.retry_in_ms) || Number(result.retry_in_ms) <= 0) {
          throw new Error(`${checkpoint.report_type} did not return a valid retryIn interval.`);
        }
        checkpoint.status = "QUEUED";
        checkpoint.next_retry_at = isoAfter(timestamp, Number(result.retry_in_ms));
        state.status = "PENDING";
        await this.save(state);
        return false;
      }
      if (result.http_status !== 200 || typeof result.body !== "string") {
        throw new Error(`${checkpoint.report_type} returned an invalid terminal response.`);
      }
      const artifactValue = {
        schema_version: "direct-read-audit-report-v1",
        report_key: checkpoint.report_key,
        report_type: checkpoint.report_type,
        processing_mode: checkpoint.processing_mode,
        exact_request: structuredClone(checkpoint.request),
        request_id: text(result.request_id, 255) || null,
        units: text(result.units, 255) || null,
        warnings: boundedWarnings(result.warnings ?? []),
        tsv: redactArtifactText(result.body),
      };
      const artifactDigest = await digest(artifactValue);
      const reference: DirectAuditArtifactReference = {
        artifact_id: `${state.audit_id}:report:${checkpoint.report_key}:${artifactDigest.slice("sha256:".length, "sha256:".length + 16)}`,
        audit_id: state.audit_id,
        kind: "DIRECT_REPORT_TSV",
        digest: artifactDigest,
        byte_length: new TextEncoder().encode(JSON.stringify(artifactValue)).byteLength,
        object_count: reportRowCount(result.body),
        observed_at: timestamp,
      };
      checkpoint.artifact_reference = await this.store.putArtifact({
        reference,
        owner_key: state.owner_key,
        account: state.account,
        value: artifactValue,
      });
      checkpoint.status = "COMPLETE";
      checkpoint.next_retry_at = null;
      await this.save(state);
    }
    return true;
  }

  private async summarize(state: DirectAuditCheckpoint): Promise<DirectAuditSummary> {
    const campaignObjects = await artifactObjects(this.store, state.collections.campaigns.artifact_references);
    const keywordObjects = await artifactObjects(this.store, state.collections.keywords.artifact_references);
    const allReferences = allArtifactReferences(state);
    const unavailableCollections = COLLECTION_ORDER.filter((collection) => state.collections[collection].status === "UNAVAILABLE");
    const pendingCollections = COLLECTION_ORDER.filter((collection) => state.collections[collection].status === "PENDING");
    const criterionGaps = await criterionCoverageGaps(state, this.store);
    const pendingReports = state.reports.filter((report) => ["NOT_REQUESTED", "QUEUED"].includes(report.status));
    const unavailableReports = state.reports.filter((report) => report.status === "UNAVAILABLE");
    const status: DirectAuditSummary["status"] = pendingCollections.length || pendingReports.length
      ? "PENDING"
      : unavailableCollections.length || unavailableReports.length || criterionGaps.methods.length
        ? "PARTIAL"
        : "COMPLETE";
    const limitations = [
      ...warningLimitations(state),
      ...unavailableCollections.map((collection) => state.collections[collection].limitation ?? `${COLLECTION_CONFIG[collection].method} unavailable.`),
      ...unavailableReports.map((report) => report.limitation ?? `${report.report_type} unavailable.`),
      ...criterionGaps.limitations,
      ...(allReferences.length > MAX_SUMMARY_ARTIFACT_REFERENCES
        ? [`${allReferences.length - MAX_SUMMARY_ARTIFACT_REFERENCES} additional artifacts are linked by audit_id.`]
        : []),
    ];
    const objectCounts = Object.fromEntries(COLLECTION_ORDER.map((collection) => [collection, state.collections[collection].object_count])) as Record<DirectAuditCollection | "autotargetings", number>;
    objectCounts.autotargetings = keywordObjects.filter((item) => text(item.Keyword, 255) === "---autotargeting" || item.AutotargetingSettings).length;
    const nextRetryAt = [
      ...COLLECTION_ORDER.map((collection) => state.collections[collection].next_retry_at),
      ...state.reports.map((report) => report.next_retry_at),
    ].filter((value): value is string => Boolean(value)).sort()[0] ?? null;
    return {
      schema_version: DIRECT_AUDIT_SUMMARY_SCHEMA,
      audit_id: state.audit_id,
      status,
      graph_complete: pendingCollections.length === 0 && unavailableCollections.length === 0 && criterionGaps.methods.length === 0,
      observed_at: state.completed_at ?? state.updated_at,
      completed_at: state.completed_at,
      account_binding: {
        expected_account: state.binding.expected_account,
        api_account: state.binding.api_account,
        client_id: state.binding.client_id,
        matched: true,
      },
      provider_restrictions: state.binding.restrictions.slice(0, 100),
      object_counts: objectCounts,
      campaign_summaries: campaignObjects
        .filter((item) => text(item.State, 50) !== "ARCHIVED")
        .slice(0, 20)
        .map((item) => ({
          campaign_id: text(item.Id, 100),
          name: text(item.Name, 255),
          type: text(item.Type, 100),
          state: text(item.State, 100) || "UNKNOWN",
          status: text(item.Status, 100) || "UNKNOWN",
        })),
      report_summaries: state.reports.map((report) => ({
        report_key: report.report_key,
        report_type: report.report_type,
        status: report.status,
        next_retry_at: report.next_retry_at,
        artifact_reference: report.artifact_reference,
      })),
      methods_read: [
        ...COLLECTION_ORDER
          .filter((collection) => state.collections[collection].status === "COMPLETE")
          .map((collection) => COLLECTION_CONFIG[collection].method),
        ...state.reports.filter((report) => report.status === "COMPLETE").map((report) => `Reports.${report.report_type}`),
      ],
      methods_not_read: [
        ...unavailableCollections.map((collection) => COLLECTION_CONFIG[collection].method),
        ...unavailableReports.map((report) => `Reports.${report.report_type}`),
        ...criterionGaps.methods,
      ],
      limitations: unique(limitations).slice(0, 100),
      next_retry_at: nextRetryAt,
      artifact_references: allReferences.slice(0, MAX_SUMMARY_ARTIFACT_REFERENCES),
      browser_cabinet_used: false,
      provider_write_methods_reachable: false,
    };
  }

  private async runAttempt(): Promise<DirectAuditSummary> {
    const state = await this.loadOrStart();
    if (state.owner_key !== this.ownerKey
      || state.account !== this.binding.api_account
      || state.client_id !== this.binding.client_id
      || !state.binding.matched
      || state.binding.expected_account !== state.binding.api_account) {
      throw new Error("Durable Direct audit binding no longer matches the exact advertiser account.");
    }
    if (!["COMPLETE", "PARTIAL"].includes(state.status)) {
      const graphComplete = await this.collectGraph(state);
      if (!graphComplete) return this.summarize(state);
      const reportsComplete = await this.collectReports(state);
      if (reportsComplete) {
        const criterionGaps = await criterionCoverageGaps(state, this.store);
        const partial = COLLECTION_ORDER.some((collection) => state.collections[collection].status === "UNAVAILABLE")
          || state.reports.some((report) => report.status === "UNAVAILABLE")
          || criterionGaps.methods.length > 0;
        state.status = partial ? "PARTIAL" : "COMPLETE";
        state.completed_at = this.now();
        await this.save(state);
      } else if (state.status !== "PENDING") {
        state.status = "PENDING";
        await this.save(state);
      }
    }
    return this.summarize(state);
  }

  async run(): Promise<DirectAuditSummary> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      try {
        return await this.runAttempt();
      } catch (error) {
        if (!(error instanceof DirectAuditCheckpointConflict)) throw error;
      }
    }
    throw new Error("Direct audit could not converge after concurrent safe-read checkpoints.");
  }
}
