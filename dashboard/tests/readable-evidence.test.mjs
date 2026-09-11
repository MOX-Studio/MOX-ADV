import assert from "node:assert/strict";
import test from "node:test";
import { buildReadableEvidence, collectReadableEvidenceRefs } from "../lib/readable-evidence.ts";

const claimId = `urn:mox:claim:${"a".repeat(64)}`;
const recordId = `urn:mox:evidence:${"b".repeat(64)}`;
function fixture() {
  return {
    snapshot_id: "snapshot:test", generated_at: "2026-09-09T12:00:00Z",
    sources: [{ source_id: "site", title: "Страница организатора", status: "VERIFIED", observed_at: "2026-09-08T10:00:00Z", limitations: ["Условия опубликованы организатором."] }],
    evidence: [{ evidence_id: recordId, source_id: "site", observed_at: "2026-09-07T09:00:00Z", source_locator: { url: "https://example.com/participation" },
      normalized: { value: "Участие со стендом" }, raw: { quote: "Приглашаем участвовать со стендом.", bounded: { truncated: false } }, freshness: { status: "fresh" }, limitations: ["Наличие мест не проверено."] }],
    claims: [{ claim_id: claimId, subject: "business_model", predicate: "offer", classification: "observed", value: "Участие со стендом", normalized: { value: "Участие со стендом" }, evidence_ids: [recordId], confidence: { freshness: "current", consistency: "single", uncertainty: [] } }],
  };
}
const resolve = (snapshot, references, extra = {}) => buildReadableEvidence(snapshot, { references, ...extra });

test("claim and quote resolve exact saved values, source URL and observation date without changing the snapshot", () => {
  const snapshot = fixture(), before = structuredClone(snapshot);
  const [claim, quote] = resolve(snapshot, [claimId, `${recordId}:quote`]);
  assert.equal(claim.label, "Предложение"); assert.equal(claim.value, "Участие со стендом"); assert.equal(claim.basis, "OBSERVATION");
  assert.equal(claim.sources[0].url, "https://example.com/participation"); assert.equal(claim.sources[0].observedAt, "2026-09-07T09:00:00Z");
  assert.equal(claim.sources[0].excerpt, "Приглашаем участвовать со стендом.");
  assert(claim.limitations.includes("Условия опубликованы организатором.")); assert(claim.limitations.includes("Наличие мест не проверено."));
  assert.equal(quote.value, "Приглашаем участвовать со стендом."); assert.equal(quote.basis, "OBSERVATION");
  assert.deepEqual(snapshot, before);
});

test("owner offer suffix is an exact owner ref and cannot resolve to an unrelated base claim", () => {
  const snapshot = fixture();
  snapshot.claims.push({ claim_id: "owner", predicate: "offer", classification: "observed", value: "Неверное основание", normalized: { value: "Неверное основание" }, evidence_ids: [recordId] });
  const [owner] = resolve(snapshot, ["owner:offer"], { catalog: { sources: [{ source_ref: "owner:offer", source_excerpt: "Вводные владельца", admissible_fact_units: ["Условия владельца"], evidence_refs: ["trusted-business:offer"] }] } });
  assert.equal(owner.value, "Условия владельца"); assert.equal(owner.basis, "OWNER"); assert.equal(owner.label, "Предложение"); assert.deepEqual(owner.sources, []);
});

test("material offer facets use matching saved axes and exact references have priority over suffix parsing", () => {
  const snapshot = fixture(), axes = { offer: "Стандартный стенд", audience: "Производители", qualified_outcome: "Заявка экспонента", economics: "Цена по запросу" };
  snapshot.claims[0] = { ...snapshot.claims[0], predicate: "material_offer", normalized: { value: { offer_id: "offer:1", material_axes: axes } }, value: { secret_field: "MUST_NOT_SERIALIZE" } };
  snapshot.product_catalog = { offers: [{ offer_id: "offer:1", material_axes: axes, value_proposition: "Деловые встречи" }] };
  const [offer, audience, message] = resolve(snapshot, [`${claimId}:offer`, `${claimId}:audience`, `${claimId}:message`]);
  assert.equal(offer.value, "Стандартный стенд"); assert.equal(audience.value, "Производители"); assert.equal(message.value, "Деловые встречи");
  snapshot.claims.push({ ...snapshot.claims[0], claim_id: `${claimId}:offer`, predicate: "product", normalized: { value: "Отдельное точное утверждение" } });
  assert.equal(resolve(snapshot, [`${claimId}:offer`])[0].value, "Отдельное точное утверждение");
  snapshot.product_catalog.offers[0].material_axes = { offer: "Несовпадающий каталог" };
  assert.equal(resolve(snapshot, [`${claimId}:audience`])[0].value, "Подтверждение недоступно.");
});

test("unknown, stale, conflict and unavailable sources remain explicit and zero is never converted to unknown", () => {
  const snapshot = fixture();
  snapshot.claims[0].value = 0; snapshot.claims[0].normalized.value = 0;
  assert.equal(resolve(snapshot, [claimId])[0].value, "0");
  snapshot.claims[0].value = null; snapshot.claims[0].normalized.value = null; snapshot.claims[0].classification = "unknown";
  snapshot.claims[0].confidence = { freshness: "stale", consistency: "scope_mismatch", tier: "BLOCKED_UNKNOWN", uncertainty: ["Точный период неизвестен."] };
  snapshot.evidence[0].freshness.status = "unknown"; snapshot.evidence[0].conflicts = ["conflict:1"];
  snapshot.sources[0].status = "UNAVAILABLE";
  const [claim, record] = resolve(snapshot, [claimId, recordId]);
  assert.equal(claim.basis, "UNKNOWN"); assert.notEqual(claim.value, "0"); assert.equal(record.basis, "UNKNOWN");
  assert.match(claim.limitations.join(" "), /более раннему периоду/); assert.match(claim.limitations.join(" "), /Актуальность данных не установлена/);
  assert.match(claim.limitations.join(" "), /противоречие/); assert.match(claim.limitations.join(" "), /Области наблюдений не совпадают/); assert.match(claim.limitations.join(" "), /Данные источника недоступны/);
});

test("credential URLs and text are redacted while arbitrary raw objects never reach the display", () => {
  const snapshot = fixture();
  snapshot.claims[0].value = { opaque: { credential: "HIDDEN_OBJECT_SECRET" } }; snapshot.claims[0].normalized.value = snapshot.claims[0].value;
  snapshot.evidence[0].raw = { value: { opaque: "HIDDEN_RAW_SECRET" }, quote: "Контакт user@example.com Authorization: Bearer SECRET_BEARER" };
  snapshot.sources[0].title = "Источник api_key=SECRET_TITLE"; snapshot.evidence[0].limitations = ["password=SECRET_LIMIT"];
  for (const url of ["https://example.com/?api_key=SECRET_QUERY", "https://example.com/?token=SECRET_QUERY", "https://user:SECRET_PASSWORD@example.com/", "http://example.com/", "https://127.0.0.1/"]) {
    snapshot.evidence[0].source_locator.url = url;
    const view = resolve(snapshot, [claimId, `${recordId}:quote`]);
    assert.equal(view[0].sources[0].url, null);
    assert.doesNotMatch(JSON.stringify(view), /SECRET_|HIDDEN_|user@example/);
    assert.equal(view[0].value, "Подтверждение недоступно.");
  }
});

test("canonical Wordstat zero and Direct query history preserve their different scopes and dates", () => {
  const snapshot = fixture();
  snapshot.market_evidence = { frequency: { declared_window: "август 2026", canonical_observations: [{ observation_id: "wordstat-row:test", phrase: "участие со стендом", count: 0, observed_at: "2026-09-06T10:00:00Z", region_names: ["Москва"], device: "all" }] } };
  snapshot.evidence[0].provider_metadata = { canonical_observation_ids: ["wordstat-row:test"] };
  snapshot.first_party_history = { query_observations: [{ observation_id: "observation:test", query: "участие в выставке", date: "2026-08-20", evidence_ids: [recordId], impressions: 12, reported_conversions: 2 }] };
  const [wordstat, history] = resolve(snapshot, ["wordstat-row:test", "observation:test"]);
  assert.equal(wordstat.value, "участие со стендом · 0 запросов"); assert.equal(wordstat.sources[0].observedAt, "2026-09-06T10:00:00Z");
  assert.match(wordstat.limitations.join(" "), /Москва.*август 2026/); assert.match(wordstat.limitations.join(" "), /не определяет число покупателей/);
  assert.equal(history.value, "участие в выставке"); assert.equal(history.sources[0].observedAt, "2026-08-20"); assert.match(history.limitations.join(" "), /не подтверждает квалифицированные результаты/);
  delete snapshot.first_party_history.query_observations[0].date;
  assert.equal(resolve(snapshot, ["observation:test"])[0].basis, "UNKNOWN");
});

test("legacy record aliases, gaps and missing references work without invented content", () => {
  const snapshot = { evidence: [], evidence_records: [{ record_id: "legacy-record", source_manifest_id: "legacy-source", raw: { quote: "Историческая запись" } }], source_manifests: [{ source_manifest_id: "legacy-source", title: "Старый источник" }], gaps: [{ gap_id: "gap:1", description: "Нет данных о квалификации", limitations: ["Формы не равны результатам."] }] };
  const [legacy, gap, unknown] = resolve(snapshot, ["legacy-record", "gap:1", "absent:offer"]);
  assert.equal(legacy.value, "Историческая запись"); assert.equal(legacy.basis, "UNKNOWN"); assert.equal(legacy.sources[0].observedAt, null);
  assert.equal(gap.basis, "UNKNOWN"); assert.deepEqual(gap.limitations, ["Формы не равны результатам."]);
  assert.equal(unknown.value, "Подтверждение недоступно."); assert.deepEqual(unknown.sources, []);
});

test("reference collection reads only declared reference fields including saved dimension refs", () => {
  assert.deepEqual(collectReadableEvidenceRefs({ evidence_refs: ["a", { evidence_id: "b", revision_id: "not-a-ref" }], nested: { source_refs: ["c", "a"], observation_ref: "d", source_ref: "e", unrelated: "ignore" } }), ["a", "b", "c", "d", "e"]);
});

test("a material stays a container and uses exact page descriptions; a missing primary excerpt is not promoted by a saved quote", () => {
  const snapshot = fixture();
  snapshot.sources[0].limitations = ["No recoverable first-party evidence span is available."];
  snapshot.evidence[0].scope = { region_names: ["Москва"], declared_window: "Август 2026", client_login: "PRIVATE_ACCOUNT", token: "PRIVATE_TOKEN" };
  snapshot.business_research = { supporting_materials: [{ id: "material", label: "Проверка форматов", observed_at: "2026-09-09", source_urls: ["https://example.com/standard", "https://example.com/business"], content: {
    sources: [{ id: "standard", title: "Стандартный стенд", url: "https://example.com/standard", observed_at: "2026-09-08" }, { id: "business", title: "Стенд Бизнес", url: "https://example.com/business" }], private_blob: "PRIVATE_BLOB",
  } }] };
  const [material, claim, snapshotRef] = resolve(snapshot, ["material", claimId, snapshot.snapshot_id]);
  assert.equal(material.kind, "MATERIAL"); assert.equal(material.value, ""); assert.equal(snapshotRef.kind, "SNAPSHOT");
  assert.equal(material.sources[0].title, "Стандартный стенд"); assert.equal(material.sources[0].observedAt, "2026-09-08"); assert.equal(material.sources[1].title, "Стенд Бизнес");
  assert.equal(claim.sources[0].excerpt, "Приглашаем участвовать со стендом."); assert.equal(claim.sources[0].excerptStatus, "MISSING");
  assert.deepEqual(claim.sources[0].scope, ["Регион: Москва", "Период: Август 2026"]);
  assert.doesNotMatch(JSON.stringify([material, claim]), /PRIVATE_/);
  assert(claim.limitations.includes("No recoverable first-party evidence span is available."));
});

test("public citations remain available while service endpoints and region codes are not presented as sources", () => {
  const snapshot = fixture();
  snapshot.sources[0].provenance_class = "DIRECT_OFFICIAL_API"; snapshot.sources[0].title = "Direct API json v5 campaigns";
  snapshot.evidence[0].source_locator.url = "https://api.direct.yandex.com/json/v5/campaigns";
  snapshot.evidence[0].scope = { region_ids: [213], device: "all", report_type: "SEARCH_QUERY_PERFORMANCE_REPORT" };
  const [claim] = resolve(snapshot, [claimId]);
  assert.equal(claim.sources[0].title, "Яндекс Директ"); assert.equal(claim.sources[0].url, null);
  assert.deepEqual(claim.sources[0].scope, ["Все устройства", "Название региона не указано."]);
  assert.equal(claim.value, "Участие со стендом"); assert.equal(claim.sources[0].observedAt, "2026-09-07T09:00:00Z");
});
