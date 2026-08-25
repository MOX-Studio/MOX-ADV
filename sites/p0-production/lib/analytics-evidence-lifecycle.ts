import {
  canonicalizeEvidence,
  verifyAnalyticsEvidenceSnapshot,
  type AnalyticsEvidenceBundle,
  type AnalyticsEvidenceDomain,
} from "./analytics-evidence.ts";

export const ANALYTICS_EVIDENCE_LIFECYCLE_SCHEMA = "p0-analytics-evidence-lifecycle-v1";
export const ANALYTICS_EVIDENCE_COMPARISON_METHOD = "CONTENT_ADDRESSED_SNAPSHOT_ID";

export const ANALYTICS_EVIDENCE_DOMAINS: AnalyticsEvidenceDomain[] = [
  "BUSINESS_MODEL",
  "DIRECT",
  "METRIKA",
  "WORDSTAT",
  "COST",
  "COMPETITORS",
];

export type AnalyticsEvidenceCollectionTrigger =
  | "INITIAL_COLLECTION"
  | "CONTEXT_MATERIAL_CHANGE"
  | "MODEL_MATERIAL_CHANGE"
  | "PRODUCT_FOCUS_CHANGE"
  | "COMPETITOR_EVIDENCE_REFRESH"
  | "LEGACY_MIGRATION";

export type AnalyticsEvidenceInputLineage = {
  context_revision_id: string | null;
  context_material_fingerprint: string | null;
  business_model_revision_id: string | null;
  business_model_material_fingerprint: string | null;
};

export type AnalyticsEvidenceVersionRecord = {
  version: number;
  snapshot_id: string;
  previous_snapshot_id: string | null;
  recorded_at: string;
  trigger: AnalyticsEvidenceCollectionTrigger;
  comparison: {
    method: typeof ANALYTICS_EVIDENCE_COMPARISON_METHOD;
    result: "INITIAL" | "MATERIAL_REPLACEMENT" | "MIGRATED_CURRENT";
    changed_domains: AnalyticsEvidenceDomain[];
  };
  input_lineage: AnalyticsEvidenceInputLineage;
  invalidated_outputs: string[];
  record_hash: string;
};

export type AnalyticsEvidencePendingReplacement = {
  previous_version: number;
  previous_snapshot_id: string;
  invalidated_at: string;
  trigger: Exclude<AnalyticsEvidenceCollectionTrigger, "INITIAL_COLLECTION" | "LEGACY_MIGRATION">;
  changed_domains: AnalyticsEvidenceDomain[];
  input_lineage: AnalyticsEvidenceInputLineage;
  invalidated_outputs: string[];
  record_hash: string;
};

export type AnalyticsEvidenceLifecycle = {
  schema_version: typeof ANALYTICS_EVIDENCE_LIFECYCLE_SCHEMA;
  active_version: number | null;
  active_snapshot_id: string | null;
  versions: AnalyticsEvidenceVersionRecord[];
  pending_replacement: AnalyticsEvidencePendingReplacement | null;
};

export class AnalyticsEvidenceLifecycleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AnalyticsEvidenceLifecycleError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new AnalyticsEvidenceLifecycleError(code, message);
}

function isoTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) fail("ANALYTICS_EVIDENCE_TIMESTAMP_INVALID", "Analytics Evidence lifecycle требует ISO timestamp.");
  return new Date(value).toISOString();
}

function normalizedDomains(domains: AnalyticsEvidenceDomain[]) {
  const requested = new Set(domains);
  const normalized = ANALYTICS_EVIDENCE_DOMAINS.filter((domain) => requested.has(domain));
  if (normalized.length !== requested.size || normalized.length === 0) {
    fail("ANALYTICS_EVIDENCE_DOMAINS_INVALID", "Analytics Evidence replacement требует непустой canonical domain set.");
  }
  return normalized;
}

function normalizedOutputs(outputs: string[]) {
  return [...new Set(outputs.map((item) => item.normalize("NFKC").trim()).filter(Boolean))].sort();
}

async function sha256(value: unknown) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalizeEvidence(value)),
  );
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

async function seal<T extends Record<string, unknown>>(value: T) {
  return { ...value, record_hash: await sha256(value) };
}

async function recordHashMatches(value: Record<string, unknown>) {
  const copy = structuredClone(value);
  const recordHash = String(copy.record_hash ?? "");
  delete copy.record_hash;
  return /^sha256:[a-f0-9]{64}$/u.test(recordHash) && recordHash === await sha256(copy);
}

export function emptyAnalyticsEvidenceLifecycle(): AnalyticsEvidenceLifecycle {
  return {
    schema_version: ANALYTICS_EVIDENCE_LIFECYCLE_SCHEMA,
    active_version: null,
    active_snapshot_id: null,
    versions: [],
    pending_replacement: null,
  };
}

export async function migrateAnalyticsEvidenceLifecycle(input: {
  snapshot: AnalyticsEvidenceBundle | null;
  recordedAt: string;
  inputLineage: AnalyticsEvidenceInputLineage;
}): Promise<AnalyticsEvidenceLifecycle> {
  if (!input.snapshot) return emptyAnalyticsEvidenceLifecycle();
  if (!await verifyAnalyticsEvidenceSnapshot(input.snapshot)) {
    fail("ANALYTICS_EVIDENCE_SNAPSHOT_INVALID", "Legacy Analytics Evidence Snapshot не прошёл hash verification.");
  }
  const body = {
    version: 1,
    snapshot_id: input.snapshot.snapshot_id,
    previous_snapshot_id: null,
    recorded_at: isoTimestamp(input.recordedAt),
    trigger: "LEGACY_MIGRATION" as const,
    comparison: {
      method: ANALYTICS_EVIDENCE_COMPARISON_METHOD,
      result: "MIGRATED_CURRENT" as const,
      changed_domains: [...ANALYTICS_EVIDENCE_DOMAINS],
    },
    input_lineage: structuredClone(input.inputLineage),
    invalidated_outputs: [] as string[],
  };
  const version = await seal(body) as AnalyticsEvidenceVersionRecord;
  return {
    schema_version: ANALYTICS_EVIDENCE_LIFECYCLE_SCHEMA,
    active_version: 1,
    active_snapshot_id: input.snapshot.snapshot_id,
    versions: [version],
    pending_replacement: null,
  };
}

export async function recordAnalyticsEvidenceSnapshot(input: {
  lifecycle: AnalyticsEvidenceLifecycle;
  currentSnapshot: AnalyticsEvidenceBundle | null;
  nextSnapshot: AnalyticsEvidenceBundle;
  recordedAt: string;
  trigger: Exclude<AnalyticsEvidenceCollectionTrigger, "LEGACY_MIGRATION">;
  changedDomains: AnalyticsEvidenceDomain[];
  inputLineage: AnalyticsEvidenceInputLineage;
  invalidatedOutputs: string[];
}): Promise<AnalyticsEvidenceLifecycle> {
  if (!await verifyAnalyticsEvidenceSnapshot(input.nextSnapshot)) {
    fail("ANALYTICS_EVIDENCE_SNAPSHOT_INVALID", "Новый Analytics Evidence Snapshot не прошёл hash verification.");
  }
  if (!await verifyAnalyticsEvidenceLifecycle(input.lifecycle, input.currentSnapshot)) {
    fail("ANALYTICS_EVIDENCE_LIFECYCLE_INVALID", "Persisted Analytics Evidence lifecycle не прошёл проверку перед заменой.");
  }
  if (input.lifecycle.active_snapshot_id === input.nextSnapshot.snapshot_id) return structuredClone(input.lifecycle);

  const previous = input.lifecycle.pending_replacement?.previous_snapshot_id
    ?? input.lifecycle.active_snapshot_id;
  const versionNumber = (input.lifecycle.versions.at(-1)?.version ?? 0) + 1;
  const initial = previous === null && input.lifecycle.versions.length === 0;
  if (initial && input.trigger !== "INITIAL_COLLECTION") {
    fail("ANALYTICS_EVIDENCE_TRIGGER_INVALID", "Первый Analytics Evidence Snapshot требует INITIAL_COLLECTION trigger.");
  }
  if (!initial && input.trigger === "INITIAL_COLLECTION") {
    fail("ANALYTICS_EVIDENCE_TRIGGER_INVALID", "Замена Analytics Evidence Snapshot не может повторно использовать INITIAL_COLLECTION.");
  }
  const changedDomains = normalizedDomains(input.changedDomains);
  const invalidatedOutputs = normalizedOutputs(input.invalidatedOutputs);
  const pending = input.lifecycle.pending_replacement;
  if (pending && (pending.trigger !== input.trigger
    || canonicalizeEvidence(pending.changed_domains) !== canonicalizeEvidence(changedDomains))) {
    fail("ANALYTICS_EVIDENCE_REPLACEMENT_CONFLICT", "Новый snapshot не совпадает с persisted replacement intent.");
  }
  const body = {
    version: versionNumber,
    snapshot_id: input.nextSnapshot.snapshot_id,
    previous_snapshot_id: previous,
    recorded_at: isoTimestamp(input.recordedAt),
    trigger: input.trigger,
    comparison: {
      method: ANALYTICS_EVIDENCE_COMPARISON_METHOD,
      result: initial ? "INITIAL" as const : "MATERIAL_REPLACEMENT" as const,
      changed_domains: changedDomains,
    },
    input_lineage: structuredClone(input.inputLineage),
    invalidated_outputs: pending ? pending.invalidated_outputs : invalidatedOutputs,
  };
  const version = await seal(body) as AnalyticsEvidenceVersionRecord;
  return {
    schema_version: ANALYTICS_EVIDENCE_LIFECYCLE_SCHEMA,
    active_version: versionNumber,
    active_snapshot_id: input.nextSnapshot.snapshot_id,
    versions: [...structuredClone(input.lifecycle.versions), version],
    pending_replacement: null,
  };
}

export async function invalidateAnalyticsEvidenceSnapshot(input: {
  lifecycle: AnalyticsEvidenceLifecycle;
  currentSnapshot: AnalyticsEvidenceBundle | null;
  invalidatedAt: string;
  trigger: Exclude<AnalyticsEvidenceCollectionTrigger, "INITIAL_COLLECTION" | "LEGACY_MIGRATION">;
  changedDomains: AnalyticsEvidenceDomain[];
  inputLineage: AnalyticsEvidenceInputLineage;
  invalidatedOutputs: string[];
}): Promise<AnalyticsEvidenceLifecycle> {
  if (!await verifyAnalyticsEvidenceLifecycle(input.lifecycle, input.currentSnapshot)) {
    fail("ANALYTICS_EVIDENCE_LIFECYCLE_INVALID", "Persisted Analytics Evidence lifecycle не прошёл проверку перед аннулированием.");
  }
  if (!input.currentSnapshot) return structuredClone(input.lifecycle);
  if (input.lifecycle.pending_replacement) {
    fail("ANALYTICS_EVIDENCE_REPLACEMENT_CONFLICT", "Analytics Evidence replacement intent уже сохранён.");
  }
  const body = {
    previous_version: input.lifecycle.active_version!,
    previous_snapshot_id: input.currentSnapshot.snapshot_id,
    invalidated_at: isoTimestamp(input.invalidatedAt),
    trigger: input.trigger,
    changed_domains: normalizedDomains(input.changedDomains),
    input_lineage: structuredClone(input.inputLineage),
    invalidated_outputs: normalizedOutputs(input.invalidatedOutputs),
  };
  const pending = await seal(body) as AnalyticsEvidencePendingReplacement;
  return {
    schema_version: ANALYTICS_EVIDENCE_LIFECYCLE_SCHEMA,
    active_version: null,
    active_snapshot_id: null,
    versions: structuredClone(input.lifecycle.versions),
    pending_replacement: pending,
  };
}

export async function verifyAnalyticsEvidenceLifecycle(
  lifecycle: AnalyticsEvidenceLifecycle | unknown,
  activeSnapshot: AnalyticsEvidenceBundle | null,
) {
  try {
    if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return false;
    const current = lifecycle as AnalyticsEvidenceLifecycle;
    if (current.schema_version !== ANALYTICS_EVIDENCE_LIFECYCLE_SCHEMA || !Array.isArray(current.versions)) return false;
    let previousSnapshotId: string | null = null;
    for (let index = 0; index < current.versions.length; index += 1) {
      const version = current.versions[index];
      if (version.version !== index + 1 || version.previous_snapshot_id !== previousSnapshotId) return false;
      if (!/^sha256:[a-f0-9]{64}$/u.test(version.snapshot_id)) return false;
      if (!Number.isFinite(Date.parse(version.recorded_at))) return false;
      if (version.comparison.method !== ANALYTICS_EVIDENCE_COMPARISON_METHOD) return false;
      if (canonicalizeEvidence(version.comparison.changed_domains) !== canonicalizeEvidence(normalizedDomains(version.comparison.changed_domains))) return false;
      if (canonicalizeEvidence(version.invalidated_outputs) !== canonicalizeEvidence(normalizedOutputs(version.invalidated_outputs))) return false;
      if (!await recordHashMatches(version as unknown as Record<string, unknown>)) return false;
      if (index === 0) {
        if (!["INITIAL", "MIGRATED_CURRENT"].includes(version.comparison.result)) return false;
      } else if (version.comparison.result !== "MATERIAL_REPLACEMENT") return false;
      previousSnapshotId = version.snapshot_id;
    }
    const latest = current.versions.at(-1) ?? null;
    if (current.pending_replacement) {
      const pending = current.pending_replacement;
      if (!latest || activeSnapshot || current.active_version !== null || current.active_snapshot_id !== null) return false;
      if (pending.previous_version !== latest.version || pending.previous_snapshot_id !== latest.snapshot_id) return false;
      if (!Number.isFinite(Date.parse(pending.invalidated_at))) return false;
      if (canonicalizeEvidence(pending.changed_domains) !== canonicalizeEvidence(normalizedDomains(pending.changed_domains))) return false;
      if (canonicalizeEvidence(pending.invalidated_outputs) !== canonicalizeEvidence(normalizedOutputs(pending.invalidated_outputs))) return false;
      if (!await recordHashMatches(pending as unknown as Record<string, unknown>)) return false;
      return true;
    }
    if (!latest) {
      return current.active_version === null && current.active_snapshot_id === null && activeSnapshot === null;
    }
    if (!activeSnapshot || !await verifyAnalyticsEvidenceSnapshot(activeSnapshot)) return false;
    return current.active_version === latest.version
      && current.active_snapshot_id === latest.snapshot_id
      && activeSnapshot.snapshot_id === latest.snapshot_id;
  } catch {
    return false;
  }
}
