import {
  WORDSTAT_EXPANSION_SEED_LIMIT,
  WORDSTAT_VERIFICATION_SEED_LIMIT,
  type DemandCostResearchPlan,
} from "./market-evidence.ts";

type ResearchSeed = DemandCostResearchPlan["seeds"][number];
type RawRecord = Record<string, unknown>;
type RankedCandidate = {
  phrase: string;
  normalized_phrase: string;
  count: number;
  parent: ResearchSeed;
  surface: "TOP_POPULAR" | "TOP_SIMILAR";
};

const DEFAULT_EXCLUSIONS = [
  "бесплатно",
  "вакансия",
  "работа",
  "резюме",
  "тендер",
  "закупка",
  "принял участие",
  "примет участие",
  "участвовал",
];

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizedPhrase(value: unknown) {
  return cleanText(value).toLocaleLowerCase("ru-RU");
}

function tokenRoot(value: string) {
  const token = normalizedPhrase(value);
  return /[а-яё]/u.test(token) && token.length > 4
    ? token.replace(/(?:иями|ами|ями|ого|ему|ому|ыми|ими|ий|ый|ая|яя|ое|ее|ую|юю|ам|ям|ах|ях|ом|ем|ов|ев|ей|ы|и|а|я|у|ю|е|о)$/u, "")
    : token;
}

function phraseTokens(value: unknown) {
  return new Set(normalizedPhrase(value)
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .split(" ")
    .map(tokenRoot)
    .filter((token) => token.length >= 2));
}

function phraseExcluded(phrase: string, exclusions: string[]) {
  const tokens = phraseTokens(phrase);
  return [...DEFAULT_EXCLUSIONS, ...exclusions].some((exclusion) => {
    const excludedTokens = [...phraseTokens(exclusion)];
    return excludedTokens.length > 0 && excludedTokens.every((token) => tokens.has(token));
  });
}

function eligiblePhrase(phrase: string, parent: ResearchSeed, exclusions: string[]) {
  const words = cleanText(phrase).split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > 7 || phraseExcluded(phrase, exclusions)) return false;
  const tokens = phraseTokens(phrase);
  const anchors = (parent.relevance_tokens?.length ? parent.relevance_tokens : [...phraseTokens(parent.phrase)])
    .map(tokenRoot)
    .filter(Boolean);
  return anchors.some((anchor) => tokens.has(anchor));
}

function topCandidates(batches: unknown[], seeds: ResearchSeed[], exclusions: string[]) {
  const seedById = new Map(seeds.map((seed) => [seed.seed_id, seed]));
  const candidates = new Map<string, RankedCandidate>();
  for (const value of batches) {
    const batch = record(value);
    for (const item of list(batch.observations)) {
      const observation = record(item);
      const surface = observation.surface;
      if (surface !== "TOP_POPULAR" && surface !== "TOP_SIMILAR") continue;
      const parent = seedById.get(cleanText(observation.seed_id));
      if (!parent) continue;
      for (const rawRow of list(observation.rows)) {
        const row = record(rawRow);
        const phrase = cleanText(row.phrase);
        const normalized = normalizedPhrase(phrase);
        const count = Number(row.count);
        if (!normalized || !Number.isFinite(count) || count < 0 || !eligiblePhrase(phrase, parent, exclusions)) continue;
        const candidate = { phrase, normalized_phrase: normalized, count, parent, surface } as RankedCandidate;
        const existing = candidates.get(normalized);
        if (!existing || candidate.count > existing.count
          || (candidate.count === existing.count && candidate.surface === "TOP_POPULAR" && existing.surface === "TOP_SIMILAR")) {
          candidates.set(normalized, candidate);
        }
      }
    }
  }
  return [...candidates.values()].sort((left, right) => right.count - left.count
    || left.normalized_phrase.localeCompare(right.normalized_phrase, "ru-RU"));
}

function diversified(candidates: RankedCandidate[], limit: number) {
  const selected: RankedCandidate[] = [];
  const perCluster = new Map<string, number>();
  for (const maximumPerCluster of [1, 2, 3, Number.POSITIVE_INFINITY]) {
    for (const candidate of candidates) {
      if (selected.length >= limit || selected.includes(candidate)) continue;
      const clusterId = candidate.parent.cluster_id;
      const count = perCluster.get(clusterId) ?? 0;
      if (count >= maximumPerCluster) continue;
      selected.push(candidate);
      perCluster.set(clusterId, count + 1);
    }
  }
  return selected;
}

function derivedSeed(candidate: RankedCandidate, seedId: string, purpose: ResearchSeed["collection_purpose"]): ResearchSeed {
  const parent = candidate.parent;
  return {
    ...parent,
    seed_id: seedId,
    phrase: candidate.phrase,
    dynamics_phrase: candidate.phrase.split(/\s+/u).filter(Boolean).map((token) => `+${token}`).join(" "),
    operator_profile: "BROAD_CONTAINING",
    collection_purpose: purpose,
    discovery_depth: 1,
    parent_seed_id: parent.parent_seed_id ?? parent.seed_id,
    formulation_provenance: [...parent.formulation_provenance],
  };
}

export function selectWordstatExpansionSeeds(
  researchPlan: DemandCostResearchPlan,
  discoveryBatch: unknown,
  limit = WORDSTAT_EXPANSION_SEED_LIMIT,
) {
  const existing = new Set(researchPlan.seeds.map((seed) => normalizedPhrase(seed.phrase)));
  const candidates = topCandidates([discoveryBatch], researchPlan.seeds, researchPlan.exclusions)
    .filter((candidate) => !existing.has(candidate.normalized_phrase));
  return diversified(candidates, limit).map((candidate, index) => derivedSeed(
    candidate,
    `expansion-${String(index + 1).padStart(2, "0")}`,
    "DISCOVERY",
  ));
}

export function selectWordstatVerificationSeeds(
  researchPlan: DemandCostResearchPlan,
  batches: unknown[],
  expansionSeeds: ResearchSeed[],
  limit = WORDSTAT_VERIFICATION_SEED_LIMIT,
) {
  const candidates = topCandidates(batches, [...researchPlan.seeds, ...expansionSeeds], researchPlan.exclusions);
  const bestPerCluster = new Map<string, RankedCandidate>();
  for (const candidate of candidates) {
    const existing = bestPerCluster.get(candidate.parent.cluster_id);
    if (!existing || candidate.count > existing.count) bestPerCluster.set(candidate.parent.cluster_id, candidate);
  }
  return diversified([...bestPerCluster.values()].sort((left, right) => right.count - left.count), limit)
    .map((candidate, index) => derivedSeed(
      candidate,
      `verification-${String(index + 1).padStart(2, "0")}`,
      "SEASONALITY_VERIFICATION",
    ));
}

export function wordstatOperatorVerificationSeeds(seeds: ResearchSeed[]) {
  return seeds.map((seed, index) => ({
    ...seed,
    seed_id: `operator-${String(index + 1).padStart(2, "0")}`,
    phrase: `"${seed.phrase}"`,
    operator_profile: "FIXED_WORD_COUNT" as const,
    collection_purpose: "OPERATOR_VERIFICATION" as const,
    parent_seed_id: seed.parent_seed_id ?? seed.seed_id,
  }));
}

export function wordstatDiscoveryStopReason(expansionSeedCount: number) {
  if (expansionSeedCount === 0) return "NO_EXPANSION_CANDIDATES" as const;
  return expansionSeedCount >= WORDSTAT_EXPANSION_SEED_LIMIT
    ? "EXPANSION_LIMIT_REACHED" as const
    : "SATURATED" as const;
}
