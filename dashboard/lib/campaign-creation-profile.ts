export type CampaignCapabilityStatus =
  | "SUPPORTED"
  | "CONDITIONALLY_ELIGIBLE"
  | "UNAVAILABLE"
  | "NOT_IMPLEMENTED";

export type CampaignCapability = {
  capability: string;
  status: CampaignCapabilityStatus;
  selected: boolean;
  reason: string;
};

const text = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function conditionalEligible(snapshot: unknown, capability: string) {
  const value = record(snapshot);
  return list(value.conditional_capabilities).map(record).some((item) => {
    const official = record(item.official_api_check);
    const account = record(item.account_eligibility_check);
    return item.capability === capability
      && official.source === "YANDEX_DIRECT_API_V501"
      && official.verified === true
      && account.account === value.account
      && account.eligible === true;
  });
}

export function campaignCreationProfileCapabilities(snapshot: unknown): CampaignCapability[] {
  const autotargetingSupported = conditionalEligible(snapshot, "AUTOTARGETING");
  const sitelinksSupported = conditionalEligible(snapshot, "SITELINKS");
  return [
    { capability: "SEARCH_DELIVERY", status: "SUPPORTED", selected: true, reason: "Frozen Search-only delivery." },
    { capability: "UNIFIED_CAMPAIGN", status: "SUPPORTED", selected: true, reason: "Current Direct v501 campaign type." },
    { capability: "UNIFIED_AD_GROUP", status: "SUPPORTED", selected: true, reason: "Current Direct v501 group type." },
    { capability: "RESPONSIVE_AD", status: "SUPPORTED", selected: true, reason: "Current combinatorial title/text output." },
    { capability: "EXPLICIT_KEYWORDS", status: "SUPPORTED", selected: true, reason: "At least one explicit criterion is published and read back." },
    {
      capability: "AUTOTARGETING",
      status: autotargetingSupported ? "SUPPORTED" : "CONDITIONALLY_ELIGIBLE",
      selected: false,
      reason: autotargetingSupported
        ? "Exact account evidence exists; the frozen default still keeps explicit-keyword-only matching."
        : "Requires official-schema and exact-account eligibility evidence.",
    },
    {
      capability: "SITELINKS",
      status: sitelinksSupported ? "CONDITIONALLY_ELIGIBLE" : "UNAVAILABLE",
      selected: false,
      reason: sitelinksSupported ? "Account evidence exists, but no rights-backed destinations are selected." : "No exact supported asset evidence is available.",
    },
    { capability: "TEXT_AD", status: "NOT_IMPLEMENTED", selected: false, reason: "The obsolete normalization fallback is absent from Profile v1." },
    { capability: "NETWORK_SERVING", status: "NOT_IMPLEMENTED", selected: false, reason: "P0 is Search-only and non-serving." },
    { capability: "CAMPAIGNS_RESUME", status: "UNAVAILABLE", selected: false, reason: "Resume, serving and spend are outside P0 authority." },
  ];
}

export type BrandClaimsBlocker = {
  code: "BRAND_PROVENANCE_MISSING" | "FACTUAL_CLAIM_UNSUPPORTED" | "REQUIRED_DISCLAIMER_MISSING" | "CREATIVE_SOURCE_MISSING" | "CREATIVE_RIGHTS_UNVERIFIED";
  message: string;
};

export function buildBrandClaimsContract(input: {
  strategyRevisionId: unknown;
  titles: string[];
  texts: string[];
}) {
  const evidenceRef = text(input.strategyRevisionId) || "APPROVED_STRATEGY_REQUIRED";
  const creativeValues = [...input.titles, ...input.texts].map(text).filter(Boolean);
  return {
    contract_version: "brand-claims-contract-v1",
    brand: {
      name_source: "APPROVED_CAMPAIGN_STRATEGY",
      provenance_ref: evidenceRef,
    },
    factual_claims: creativeValues.map((claim, index) => ({
      claim_id: `published-copy-${index + 1}`,
      text: claim,
      evidence_refs: [evidenceRef],
      status: "SUPPORTED",
    })),
    required_disclaimers: {
      status: "NOT_REQUIRED_FOR_CURRENT_EVIDENCE",
      items: [] as Array<{ text: string; evidence_ref: string; included_in_text: boolean }>,
      determination_source: evidenceRef,
    },
    creative_family: {
      family: "RESPONSIVE_TITLE_TEXT_COMBINATIONS",
      source: "APPROVED_STRATEGY_PLUS_MOX_GENERATION",
      source_ref: evidenceRef,
      assets: [{
        kind: "ORIGINAL_TEXT_FAMILY",
        source_ref: evidenceRef,
        rights: { status: "OWNER_AUTHORIZED_ORIGINAL", basis_ref: evidenceRef },
      }],
    },
  };
}

export function evaluateBrandClaimsContract(value: unknown, publishedCopy: unknown[] = []): BrandClaimsBlocker[] {
  const contract = record(value);
  const brand = record(contract.brand);
  const disclaimers = record(contract.required_disclaimers);
  const family = record(contract.creative_family);
  const blockers: BrandClaimsBlocker[] = [];
  if (contract.contract_version !== "brand-claims-contract-v1" || !text(brand.name_source) || !text(brand.provenance_ref)) blockers.push({
    code: "BRAND_PROVENANCE_MISSING",
    message: "Brand provenance is required for every Campaign Draft.",
  });
  const claims = list(contract.factual_claims).map(record);
  const supportedClaimTexts = new Set(claims
    .filter((claim) => claim.status === "SUPPORTED" && list(claim.evidence_refs).map(text).filter(Boolean).length > 0)
    .map((claim) => text(claim.text))
    .filter(Boolean));
  if (!claims.length || claims.some((claim) => !supportedClaimTexts.has(text(claim.text)))
    || publishedCopy.map(text).filter(Boolean).some((copy) => !supportedClaimTexts.has(copy))) blockers.push({
    code: "FACTUAL_CLAIM_UNSUPPORTED",
    message: "Every published factual claim requires evidence provenance.",
  });
  const disclaimerItems = list(disclaimers.items).map(record);
  if (!text(disclaimers.determination_source)
    || !["REQUIRED", "NOT_REQUIRED_FOR_CURRENT_EVIDENCE"].includes(String(disclaimers.status))
    || (disclaimers.status === "REQUIRED" && (!disclaimerItems.length
      || disclaimerItems.some((item) => !text(item.text) || !text(item.evidence_ref) || item.included_in_text !== true)))) blockers.push({
    code: "REQUIRED_DISCLAIMER_MISSING",
    message: "Every required disclaimer must be present in the published copy and provenance-linked.",
  });
  if (!text(family.family) || !text(family.source) || !text(family.source_ref)) blockers.push({
    code: "CREATIVE_SOURCE_MISSING",
    message: "Creative-family source provenance is required.",
  });
  const assets = list(family.assets).map(record);
  if (!assets.length || assets.some((asset) => {
    const rights = record(asset.rights);
    return !text(asset.source_ref) || rights.status !== "OWNER_AUTHORIZED_ORIGINAL" || !text(rights.basis_ref);
  })) blockers.push({
    code: "CREATIVE_RIGHTS_UNVERIFIED",
    message: "Every selected creative asset requires exact source and rights provenance.",
  });
  return blockers;
}

export function buildOwnerPublishPreview(projection: Record<string, unknown>) {
  const direct = record(projection.direct);
  const campaign = record(direct.campaign);
  const unified = record(campaign.UnifiedCampaign);
  const ad = record(record(direct.ad).ResponsiveAd);
  const titles = list(ad.Titles).map(text).filter(Boolean);
  const texts = list(ad.Texts).map(text).filter(Boolean);
  const landing = text(ad.Href);
  const tracking = text(unified.TrackingParams);
  const contract = record(projection.brand_claims_contract);
  const disclaimers = record(contract.required_disclaimers);
  const family = record(contract.creative_family);
  return {
    titles,
    texts,
    urls: [{ landing, tracking }],
    creativeCombinations: titles.flatMap((title) => texts.map((body) => ({ title, text: body, landing, tracking }))),
    requiredDisclaimers: list(disclaimers.items).map(record).map((item) => text(item.text)).filter(Boolean),
    creativeProvenance: {
      family: text(family.family),
      source: text(family.source),
      rights: list(family.assets).map(record).every((asset) => record(asset.rights).status === "OWNER_AUTHORIZED_ORIGINAL")
        ? "Права подтверждены" : "Права не подтверждены",
    },
  };
}
