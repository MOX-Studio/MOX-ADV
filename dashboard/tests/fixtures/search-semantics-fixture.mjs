export function searchEvidence(phrases = [{ phrase: "учёт склада стоимость", count: 123 }]) {
  const rows = phrases.map((item, index) => {
    const id = `wordstat-row:${(index + 1).toString(16).padStart(64, "0")}`;
    return {
      schema_version: "wordstat-canonical-observation-v1", observation_id: id, row_id: id,
      phrase: item.phrase, count: item.count, method: "top_requests", assigned_cluster_id: item.cluster ?? "demand:accounting",
      region_ids: [213], region_names: ["Москва"], device: "all", observed_at: "2026-09-07T10:00:00Z",
      scope_fingerprint: "scope:moscow-broad", provider_provenance: {
        source: "YANDEX_WORDSTAT_UI", batch_id: "wordstat:1", call_ids: ["call:1"], request_fingerprints: ["sha256:request"],
      },
    };
  });
  return {
    snapshot_id: "snapshot:search", as_of: "2026-09-07T11:00:00Z",
    sources: [{ source_id: "wordstat", status: "PARTIAL", provenance_class: "WORDSTAT_OFFICIAL_UI" }],
    evidence: [{ evidence_id: "evidence:wordstat", source_id: "wordstat", freshness: { status: "fresh" }, conflicts: [],
      source_locator: { batch_id: "wordstat:1" }, provider_metadata: { snapshot_batch_id: "wordstat:1", canonical_observation_ids: rows.map((row) => row.observation_id) } }],
    market_evidence: { frequency: {
      status: "PARTIAL", snapshot_batch_id: "wordstat:1", canonical_observation_schema: "wordstat-canonical-observation-v1",
      declared_window: "06.08.2026 — 06.09.2026 | Запросы со словами; Число запросов; Топ запросов, 06.08.2026 — 06.09.2026",
      scopes: [{ scope_fingerprint: "scope:moscow-broad", operator_profile: "BROAD_CONTAINING" }],
      canonical_observations: rows, canonical_phrases: ["неподтверждённый учёт"],
    } },
  };
}
