from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError, replace
from typing import Any, Dict

from mox_adv.analytics_evidence import (
    AdapterRead,
    EvidenceCollectorV1,
    EvidenceContractError,
    EvidenceFreshness,
    EvidenceRequest,
    EvidenceScope,
    EvidenceSnapshotBuilderV1,
    NormalizedFact,
)

OBSERVED_AT = "2026-08-01T10:00:00+00:00"
GENERATED_AT = "2026-08-01T10:01:00+00:00"


class StaticAdapter:
    def __init__(self, source: str, reads: Dict[str, AdapterRead]) -> None:
        self.source = source
        self.reads = reads

    def read(self, request: EvidenceRequest) -> AdapterRead:
        return self.reads[request.request_id]


class ScalarNormalizer:
    def __init__(self, source: str, confidence: str = "VERIFIED") -> None:
        self.source = source
        self.confidence = confidence
        self.calls = 0

    def normalize(
        self,
        request: EvidenceRequest,
        collected: AdapterRead,
    ) -> NormalizedFact:
        del request
        self.calls += 1
        return NormalizedFact(
            value=collected.payload,
            freshness=EvidenceFreshness(
                status="FRESH",
                checked_at=GENERATED_AT,
            ),
            confidence=self.confidence,  # type: ignore[arg-type]
        )


def request(
    request_id: str,
    source: str,
    *,
    required: bool = True,
) -> EvidenceRequest:
    return EvidenceRequest(
        request_id=request_id,
        source=source,
        subject="advertised-offer",
        predicate="monthly-price-rub",
        scope=EvidenceScope.from_mapping(
            {
                "company": "example.ru",
                "geography": "RU",
                "product": "analytics",
            }
        ),
        required=required,
    )


def available_read(request_id: str, source: str, value: Any) -> AdapterRead:
    return AdapterRead(
        request_id=request_id,
        source=source,
        source_locator="https://" + source + "/pricing",
        adapter_version="pricing-read-v1",
        observed_at=OBSERVED_AT,
        availability="AVAILABLE",
        payload=value,
    )


class AnalyticsEvidenceSnapshotTests(unittest.TestCase):
    def test_typed_collection_seals_traceable_immutable_atomic_facts(self) -> None:
        evidence_request = request("site-price", "site.example")
        adapter = StaticAdapter(
            "site.example",
            {"site-price": available_read("site-price", "site.example", 1200)},
        )
        normalizer = ScalarNormalizer("site.example")
        collector = EvidenceCollectorV1(
            {adapter.source: adapter},
            {normalizer.source: normalizer},
        )

        observations = collector.collect((evidence_request,))
        builder = EvidenceSnapshotBuilderV1()
        snapshot = builder.build(
            GENERATED_AT,
            (evidence_request,),
            observations,
        )
        repeated = builder.build(
            GENERATED_AT,
            (evidence_request,),
            observations,
        )

        self.assertEqual(snapshot.snapshot_id, repeated.snapshot_id)
        self.assertTrue(snapshot.verify_fingerprint())
        self.assertEqual("READY", snapshot.confidence.status)
        self.assertEqual(1, normalizer.calls)
        observation = snapshot.observations[0]
        self.assertEqual("site.example", observation.provenance.source)
        self.assertEqual("AVAILABLE", observation.availability)
        self.assertEqual(1200, observation.value)
        self.assertEqual("FRESH", observation.freshness.status)
        self.assertEqual("VERIFIED", observation.confidence)
        self.assertEqual((), observation.limitations)
        self.assertEqual(evidence_request.scope, observation.scope)
        claim = snapshot.claims[0]
        self.assertEqual(("site.example",), claim.sources)
        self.assertEqual(OBSERVED_AT, claim.observed_at)
        self.assertEqual("FRESH", claim.freshness)
        self.assertEqual("VERIFIED", claim.confidence)
        self.assertEqual((), claim.limitations)
        self.assertEqual(evidence_request.scope, claim.scope)
        with self.assertRaises(FrozenInstanceError):
            snapshot.generated_at = OBSERVED_AT  # type: ignore[misc]
        with self.assertRaisesRegex(EvidenceContractError, "fingerprint"):
            builder.build(
                GENERATED_AT,
                (evidence_request,),
                (replace(observations[0], value=1),),
            )

    def test_conflicting_sources_remain_distinct_unresolved_claims(self) -> None:
        site_request = request("site-price", "site.example")
        catalog_request = request("catalog-price", "catalog.example")
        adapters = {
            "site.example": StaticAdapter(
                "site.example",
                {"site-price": available_read("site-price", "site.example", 1200)},
            ),
            "catalog.example": StaticAdapter(
                "catalog.example",
                {
                    "catalog-price": available_read(
                        "catalog-price",
                        "catalog.example",
                        1500,
                    )
                },
            ),
        }
        normalizers = {
            source: ScalarNormalizer(source) for source in adapters
        }
        requests = (site_request, catalog_request)

        observations = EvidenceCollectorV1(adapters, normalizers).collect(requests)
        snapshot = EvidenceSnapshotBuilderV1().build(
            GENERATED_AT,
            requests,
            observations,
        )

        self.assertEqual(2, len(snapshot.observations))
        self.assertEqual({1200, 1500}, {claim.value for claim in snapshot.claims})
        self.assertEqual(1, len(snapshot.conflicts))
        conflict = snapshot.conflicts[0]
        self.assertEqual("UNRESOLVED", conflict.resolution)
        self.assertEqual(
            set(conflict.claim_ids),
            {item.claim_id for item in snapshot.claims},
        )
        self.assertEqual({1200, 1500}, set(conflict.values))
        self.assertEqual("CONFLICTED", snapshot.confidence.status)

    def test_unavailable_read_is_a_gap_not_a_synthetic_value(self) -> None:
        evidence_request = request(
            "optional-catalog-price",
            "catalog.example",
            required=False,
        )
        read = AdapterRead(
            request_id=evidence_request.request_id,
            source=evidence_request.source,
            source_locator="api://catalog/pricing",
            adapter_version="catalog-read-v1",
            observed_at=OBSERVED_AT,
            availability="UNAVAILABLE",
            limitations=("Provider denied this optional read.",),
        )
        adapter = StaticAdapter(
            evidence_request.source,
            {evidence_request.request_id: read},
        )
        normalizer = ScalarNormalizer(evidence_request.source)

        observations = EvidenceCollectorV1(
            {adapter.source: adapter},
            {normalizer.source: normalizer},
        ).collect((evidence_request,))
        snapshot = EvidenceSnapshotBuilderV1().build(
            GENERATED_AT,
            (evidence_request,),
            observations,
        )

        self.assertEqual(0, normalizer.calls)
        self.assertIsNone(snapshot.observations[0].value)
        self.assertEqual("UNAVAILABLE", snapshot.observations[0].availability)
        self.assertEqual((), snapshot.claims)
        self.assertEqual(1, len(snapshot.gaps))
        self.assertEqual("UNAVAILABLE", snapshot.gaps[0].status)
        self.assertFalse(snapshot.gaps[0].required)
        self.assertEqual("WITH_GAPS", snapshot.confidence.status)
        for invalid_substitute in (0, "", "model estimate"):
            with self.subTest(invalid_substitute=invalid_substitute):
                with self.assertRaisesRegex(
                    EvidenceContractError,
                    "unavailable read must not contain",
                ):
                    AdapterRead(
                        request_id=evidence_request.request_id,
                        source=evidence_request.source,
                        source_locator="api://catalog/pricing",
                        adapter_version="catalog-read-v1",
                        observed_at=OBSERVED_AT,
                        availability="UNAVAILABLE",
                        payload=invalid_substitute,
                        limitations=("Provider denied this optional read.",),
                    )

    def test_builder_rejects_incomplete_collection_atomically(self) -> None:
        requests = (
            request("site-price", "site.example"),
            request("catalog-price", "catalog.example"),
        )
        site_adapter = StaticAdapter(
            "site.example",
            {"site-price": available_read("site-price", "site.example", 1200)},
        )
        site_normalizer = ScalarNormalizer("site.example")
        observations = EvidenceCollectorV1(
            {site_adapter.source: site_adapter},
            {site_normalizer.source: site_normalizer},
        ).collect(requests[:1])

        with self.assertRaisesRegex(EvidenceContractError, "incomplete"):
            EvidenceSnapshotBuilderV1().build(
                GENERATED_AT,
                requests,
                observations,
            )


if __name__ == "__main__":
    unittest.main()
