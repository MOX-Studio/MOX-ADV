import {
  keywordFrequencyObservations, searchPhraseIdentity, SEARCH_SEMANTICS_SCHEMA,
  type SearchFrequency, type SearchIntent, type SearchSemanticsAudit,
} from "./campaign-search-semantics.ts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export type CampaignKeywordPresentation = {
  keywords: Array<{ group_ref: string; phrase: string; frequencies: SearchFrequency[]; intent: SearchIntent | null; rationale: string | null }>;
  coverage: {
    status: "REVIEWED" | "NEEDS_RESEARCH" | "NOT_REVIEWED";
    trace: SearchSemanticsAudit["trace"] | null;
    groups: Array<{ intent: SearchIntent; disposition: string; rationale: string }>;
    exclusions: Array<{ phrase: string | null; reason: string }>;
  };
};

/** Read-only projection: old drafts gain exact measured frequencies without editing their saved content. */
export function projectCampaignKeywords(input: { snapshot: unknown; projection: unknown; design: unknown; fingerprint: unknown }): CampaignKeywordPresentation {
  const projection = record(input.projection);
  const direct = record(projection.direct);
  const design = record(input.design);
  const stored = record(design.search_semantics);
  const bound = stored.schema_version === SEARCH_SEMANTICS_SCHEMA && Boolean(text(input.fingerprint))
    && design.semantic_draft_fingerprint === input.fingerprint;
  const audit = bound ? stored as unknown as SearchSemanticsAudit : null;
  const groups = list(direct.ad_groups).map(record);
  const nodes = groups.length ? list(direct.keywords).map(record).filter((node) => node.kind === "EXPLICIT_KEYWORD").map((node) => ({
    group_ref: text(node.ad_group_ref), phrase: text(record(node.provider_fields).Keyword),
    regions: list(record(groups.find((group) => group.local_ref === node.ad_group_ref)?.provider_fields).RegionIds).map(Number),
  })) : [{ group_ref: "", phrase: text(record(direct.keyword).Keyword), regions: list(record(direct.ad_group).RegionIds).map(Number) }];
  const keywords = nodes.filter((node) => node.phrase).map((node) => {
    const assessment = audit?.keywords.find((item) => searchPhraseIdentity(item.phrase) === searchPhraseIdentity(node.phrase));
    return { group_ref: node.group_ref, phrase: node.phrase,
      frequencies: keywordFrequencyObservations(input.snapshot, node.phrase, node.regions),
      intent: assessment?.intent ?? null, rationale: assessment?.rationale ?? null };
  });
  return {
    keywords,
    coverage: {
      status: audit?.status ?? "NOT_REVIEWED", trace: audit?.trace ?? null,
      groups: audit?.groups.map((group) => ({ intent: group.intent_hint, disposition: group.decision?.disposition ?? "NEEDS_RESEARCH", rationale: group.decision?.rationale ?? "Причина выбора не сохранена." })) ?? [],
      exclusions: audit?.admission.filter((row) => row.disposition !== "FORWARDED").map((row) => ({ phrase: row.phrase, reason: row.reason })) ?? [],
    },
  };
}
