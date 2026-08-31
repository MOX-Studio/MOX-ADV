from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError, replace
from typing import Any, Dict

from mox_adv.analytics_evidence import (
    AdapterRead,
    CachedEvidenceArtifact,
    EvidenceAdapterError,
    EvidenceCollectionStageV1,
    EvidenceCollectorV1,
    EvidenceContractError,
    EvidenceFreshness,
    EvidenceRequest,
    EvidenceReusePolicy,
    EvidenceScope,
    EvidenceSnapshotBuilderV1,
    EvidenceTechnicalError,
    NormalizedFact,
    TransientEvidenceAdapterError,
)

OBSERVED_AT = "2026-08-01T10:00:00+00:00"
GENERATED_AT = "2026-08-01T10:01:00+00:00"


class StaticAdapter:
    def __init__(self, source: str, reads: Dict[str, AdapterRead]) -> None:
        self.source = source
        self.reads = reads

    def read(self, request: EvidenceRequest) -> AdapterRead:
        return self.reads[request.request_id]


class SequencedAdapter:
    def __init__(self, source: str, outcomes: list[Any]) -> None:
        self.source = source
        self.outcomes = outcomes
        self.calls = 0

    def read(self, request: EvidenceRequest) -> AdapterRead:
        del request
        outcome = self.outcomes[self.calls]
        self.calls += 1
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


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

    def test_fresh_digest_matched_artifact_is_reused_in_a_new_trace(self) -> None:
        evidence_request = request("site-price", "site.example")
        initial_adapter = StaticAdapter(
            "site.example",
            {"site-price": available_read("site-price", "site.example", 1200)},
        )
        normalizer = ScalarNormalizer("site.example")
        initial_observation = EvidenceCollectorV1(
            {initial_adapter.source: initial_adapter},
            {normalizer.source: normalizer},
        ).collect((evidence_request,))[0]
        cached = CachedEvidenceArtifact(
            request_id=evidence_request.request_id,
            input_digest="sha256:input-v1",
            rule_digest="sha256:rules-v1",
            observation=initial_observation,
            dependent_result_ids=("strategy:current",),
        )
        unused_adapter = SequencedAdapter("site.example", [])
        run = EvidenceCollectorV1(
            {unused_adapter.source: unused_adapter},
            {normalizer.source: normalizer},
        ).collect_with_reuse(
            (evidence_request,),
            checked_at="2026-08-01T10:02:00+00:00",
            policies=(
                EvidenceReusePolicy(
                    request_id=evidence_request.request_id,
                    input_digest="sha256:input-v1",
                    rule_digest="sha256:rules-v1",
                    maximum_age_seconds=300,
                ),
            ),
            cached_artifacts=(cached,),
        )

        self.assertEqual(0, unused_adapter.calls)
        self.assertEqual(initial_observation, run.observations[0])
        self.assertEqual("REUSED", run.trace[0].action)
        self.assertEqual("MATCHED_DIGESTS_AND_FRESH", run.trace[0].reason)
        self.assertEqual("2026-08-01T10:02:00+00:00", run.trace[0].checked_at)
        self.assertEqual(0, run.trace[0].attempts)
        self.assertEqual((), run.invalidated_result_ids)
        self.assertEqual(("strategy:current",), run.artifacts[0].dependent_result_ids)

    def test_changed_or_stale_artifact_recollects_and_invalidates_only_dependents(
        self,
    ) -> None:
        changed_request = request("site-price", "site.example")
        changed_rule_request = request("feed-price", "feed.example")
        stale_request = request("catalog-price", "catalog.example")
        stable_request = request("registry-price", "registry.example")
        requests = (
            changed_request,
            changed_rule_request,
            stale_request,
            stable_request,
        )
        adapters = {
            item.source: SequencedAdapter(
                item.source,
                [available_read(item.request_id, item.source, 1500)],
            )
            for item in requests
        }
        normalizers = {
            item.source: ScalarNormalizer(item.source) for item in requests
        }
        seed = EvidenceCollectorV1(adapters, normalizers).collect(requests)
        cached = tuple(
            CachedEvidenceArtifact(
                request_id=item.request_id,
                input_digest="sha256:input-v1",
                rule_digest="sha256:rules-v1",
                observation=observation,
                dependent_result_ids=("result:" + item.request_id,),
            )
            for item, observation in zip(requests, seed)
        )
        replacement_adapters = {
            item.source: SequencedAdapter(
                item.source,
                [available_read(item.request_id, item.source, 1600)],
            )
            for item in requests
        }
        collector = EvidenceCollectorV1(replacement_adapters, normalizers)
        run = collector.collect_with_reuse(
            requests,
            checked_at="2026-08-01T10:03:00+00:00",
            policies=(
                EvidenceReusePolicy(
                    changed_request.request_id,
                    "sha256:input-v2",
                    "sha256:rules-v1",
                    600,
                ),
                EvidenceReusePolicy(
                    changed_rule_request.request_id,
                    "sha256:input-v1",
                    "sha256:rules-v2",
                    600,
                ),
                EvidenceReusePolicy(
                    stale_request.request_id,
                    "sha256:input-v1",
                    "sha256:rules-v1",
                    60,
                ),
                EvidenceReusePolicy(
                    stable_request.request_id,
                    "sha256:input-v1",
                    "sha256:rules-v1",
                    600,
                ),
            ),
            cached_artifacts=cached,
        )

        self.assertEqual(
            [
                "INPUT_DIGEST_CHANGED",
                "RULE_DIGEST_CHANGED",
                "STALE_ARTIFACT",
                "MATCHED_DIGESTS_AND_FRESH",
            ],
            [item.reason for item in run.trace],
        )
        self.assertEqual(1, replacement_adapters["site.example"].calls)
        self.assertEqual(1, replacement_adapters["feed.example"].calls)
        self.assertEqual(1, replacement_adapters["catalog.example"].calls)
        self.assertEqual(0, replacement_adapters["registry.example"].calls)
        self.assertEqual(
            (
                "result:catalog-price",
                "result:feed-price",
                "result:site-price",
            ),
            run.invalidated_result_ids,
        )
        self.assertEqual((), run.artifacts[0].dependent_result_ids)
        self.assertEqual((), run.artifacts[1].dependent_result_ids)
        self.assertEqual((), run.artifacts[2].dependent_result_ids)
        self.assertEqual(
            ("result:registry-price",),
            run.artifacts[3].dependent_result_ids,
        )

    def test_transient_safe_read_retries_at_most_three_times_with_retry_after(
        self,
    ) -> None:
        evidence_request = request("site-price", "site.example")
        read = available_read("site-price", "site.example", 1200)
        sleeps: list[float] = []
        recovering_adapter = SequencedAdapter(
            "site.example",
            [
                TransientEvidenceAdapterError(
                    "rate limited", retry_after_seconds=4
                ),
                TransientEvidenceAdapterError("timeout"),
                read,
            ],
        )
        normalizer = ScalarNormalizer("site.example")
        collector = EvidenceCollectorV1(
            {recovering_adapter.source: recovering_adapter},
            {normalizer.source: normalizer},
            sleeper=sleeps.append,
        )

        observations = collector.collect((evidence_request,))

        self.assertEqual(1, len(observations))
        self.assertEqual(3, recovering_adapter.calls)
        self.assertEqual([4.0, 2.0], sleeps)

        exhausted_adapter = SequencedAdapter(
            "site.example",
            [TransientEvidenceAdapterError("temporary")] * 3,
        )
        exhausted = EvidenceCollectorV1(
            {exhausted_adapter.source: exhausted_adapter},
            {normalizer.source: normalizer},
            sleeper=lambda _: None,
        )
        with self.assertRaises(EvidenceTechnicalError) as caught:
            exhausted.collect((evidence_request,))
        self.assertEqual("TRANSIENT_READ_EXHAUSTED", caught.exception.code)
        self.assertEqual(3, caught.exception.attempts)
        self.assertTrue(caught.exception.retryable)
        self.assertEqual(3, exhausted_adapter.calls)

    def test_non_transient_error_is_technical_and_is_not_retried(self) -> None:
        evidence_request = request("site-price", "site.example")
        adapter = SequencedAdapter(
            "site.example",
            [EvidenceAdapterError("authorization failed")],
        )
        sleeps: list[float] = []
        collector = EvidenceCollectorV1(
            {adapter.source: adapter},
            {"site.example": ScalarNormalizer("site.example")},
            sleeper=sleeps.append,
        )

        with self.assertRaisesRegex(
            EvidenceTechnicalError,
            "must not be converted into a business-data request",
        ) as caught:
            collector.collect((evidence_request,))

        self.assertEqual("EVIDENCE_READ_FAILED", caught.exception.code)
        self.assertEqual(1, caught.exception.attempts)
        self.assertFalse(caught.exception.retryable)
        self.assertEqual(1, adapter.calls)
        self.assertEqual([], sleeps)

    def test_required_shared_gap_returns_one_atomic_input_package(self) -> None:
        required_site = request("site-price", "site.example")
        optional_catalog = request(
            "catalog-price",
            "catalog.example",
            required=False,
        )
        required_market = replace(
            request("market-size", "market.example"),
            predicate="market-size-rub",
        )
        optional_audience = replace(
            request("audience-age", "audience.example", required=False),
            predicate="audience-age",
        )
        requests = (
            required_site,
            optional_catalog,
            required_market,
            optional_audience,
        )
        adapters = {
            item.source: StaticAdapter(
                item.source,
                {
                    item.request_id: AdapterRead(
                        request_id=item.request_id,
                        source=item.source,
                        source_locator="api://" + item.source + "/facts",
                        adapter_version="fact-read-v1",
                        observed_at=OBSERVED_AT,
                        availability="UNAVAILABLE",
                        limitations=("Permitted source has no accessible value.",),
                    )
                },
            )
            for item in requests
        }
        normalizers = {
            item.source: ScalarNormalizer(item.source) for item in requests
        }

        outcome = EvidenceCollectionStageV1(
            EvidenceCollectorV1(adapters, normalizers)
        ).run(GENERATED_AT, requests)

        self.assertEqual("REQUIRED_INPUT", outcome.status)
        self.assertEqual("PROVIDE_REQUIRED_INPUTS", outcome.next_action)
        self.assertIsNotNone(outcome.snapshot)
        package = outcome.required_input_package
        self.assertIsNotNone(package)
        assert package is not None
        self.assertTrue(package.verify_fingerprint())
        self.assertEqual(2, len(package.inputs))
        price_input = next(
            item for item in package.inputs if item.predicate == "monthly-price-rub"
        )
        self.assertEqual(
            ("catalog-price", "site-price"),
            price_input.attempted_request_ids,
        )
        self.assertEqual(
            ("catalog.example", "site.example"),
            price_input.attempted_sources,
        )
        packaged_request_ids = {
            request_id
            for item in package.inputs
            for request_id in item.attempted_request_ids
        }
        self.assertIn("market-size", packaged_request_ids)
        self.assertNotIn("audience-age", packaged_request_ids)
        projection = outcome.as_dict()
        self.assertIsNone(projection["current_campaign_hypothesis"])
        self.assertIsNone(projection["current_campaign_draft"])
        self.assertEqual([], projection["external_writes"])
        with self.assertRaises(FrozenInstanceError):
            package.snapshot_id = "changed"  # type: ignore[misc]

    def test_available_permitted_source_avoids_business_input_request(self) -> None:
        required_site = request("site-price", "site.example")
        fallback_catalog = request(
            "catalog-price",
            "catalog.example",
            required=False,
        )
        unavailable = AdapterRead(
            request_id=required_site.request_id,
            source=required_site.source,
            source_locator="https://site.example/pricing",
            adapter_version="site-read-v1",
            observed_at=OBSERVED_AT,
            availability="UNAVAILABLE",
            limitations=("Site did not expose the value.",),
        )
        adapters = {
            required_site.source: StaticAdapter(
                required_site.source,
                {required_site.request_id: unavailable},
            ),
            fallback_catalog.source: StaticAdapter(
                fallback_catalog.source,
                {
                    fallback_catalog.request_id: available_read(
                        fallback_catalog.request_id,
                        fallback_catalog.source,
                        1200,
                    )
                },
            ),
        }
        normalizers = {
            source: ScalarNormalizer(source) for source in adapters
        }

        outcome = EvidenceCollectionStageV1(
            EvidenceCollectorV1(adapters, normalizers)
        ).run(GENERATED_AT, (required_site, fallback_catalog))

        self.assertEqual("READY", outcome.status)
        self.assertEqual("CONTINUE_PIPELINE", outcome.next_action)
        self.assertIsNone(outcome.required_input_package)
        self.assertEqual([], outcome.as_dict()["external_writes"])

    def test_technical_failure_is_sanitized_and_requests_no_business_data(
        self,
    ) -> None:
        evidence_request = request("site-price", "site.example")
        adapter = SequencedAdapter(
            "site.example",
            [TransientEvidenceAdapterError("secret upstream detail")] * 3,
        )
        stage = EvidenceCollectionStageV1(
            EvidenceCollectorV1(
                {adapter.source: adapter},
                {adapter.source: ScalarNormalizer(adapter.source)},
                sleeper=lambda _: None,
            )
        )

        outcome = stage.run(GENERATED_AT, (evidence_request,))

        self.assertEqual("TECHNICAL_FAILURE", outcome.status)
        self.assertEqual("TRANSIENT_READ_EXHAUSTED", outcome.technical_reason_code)
        self.assertEqual("RETRY_COLLECTION", outcome.next_action)
        self.assertTrue(outcome.retryable)
        projection = outcome.as_dict()
        self.assertIsNone(projection["analytics_evidence_snapshot"])
        self.assertIsNone(projection["required_input_package"])
        self.assertIsNone(projection["current_campaign_hypothesis"])
        self.assertIsNone(projection["current_campaign_draft"])
        self.assertEqual([], projection["external_writes"])
        self.assertNotIn("secret upstream detail", str(projection))


if __name__ == "__main__":
    unittest.main()
