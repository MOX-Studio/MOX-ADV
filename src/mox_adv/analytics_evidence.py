"""Typed collection and immutable Analytics Evidence Snapshot contracts.

This module keeps permitted reads, normalization, and snapshot assembly separate.
Adapters can only return a typed read result; normalizers can only turn an
available result into one atomic fact; the builder either seals the complete
request set or returns no snapshot.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import (
    Any,
    Dict,
    Iterable,
    Literal,
    Mapping,
    Optional,
    Protocol,
    Sequence,
    Tuple,
    Union,
)

ANALYTICS_EVIDENCE_SNAPSHOT_SCHEMA_VERSION = "analytics-evidence-snapshot-v1"

Availability = Literal["AVAILABLE", "UNAVAILABLE"]
FreshnessStatus = Literal["FRESH", "AGING", "STALE", "UNKNOWN"]
ConfidenceLevel = Literal["VERIFIED", "CORROBORATED", "INDICATIVE", "UNKNOWN"]
SnapshotConfidenceStatus = Literal["READY", "WITH_GAPS", "CONFLICTED"]
AtomicValue = Union[str, int, float, bool]


class EvidenceContractError(ValueError):
    """Evidence cannot be represented without losing its audit semantics."""


def _required_text(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EvidenceContractError(label + " must be a non-empty string.")
    return value.strip()


def _utc_timestamp(value: str, label: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise EvidenceContractError(label + " must be an ISO UTC timestamp.") from error
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise EvidenceContractError(label + " must be an ISO UTC timestamp.")
    return parsed.isoformat()


def _atomic_value(value: AtomicValue) -> AtomicValue:
    if value is None or isinstance(value, (dict, list, tuple, set)):
        raise EvidenceContractError(
            "An available atomic fact must have a scalar value."
        )
    if isinstance(value, float) and not math.isfinite(value):
        raise EvidenceContractError("An available atomic fact must be finite.")
    if not isinstance(value, (str, int, float, bool)):
        raise EvidenceContractError(
            "An available atomic fact has an unsupported value."
        )
    if isinstance(value, str) and not value.strip():
        raise EvidenceContractError(
            "An unavailable fact must use UNAVAILABLE, not an empty string."
        )
    return value


def _canonical(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _content_id(prefix: str, value: Any) -> str:
    digest = hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()
    return prefix + ":sha256:" + digest


@dataclass(frozen=True)
class EvidenceScope:
    """Closed, comparable scope for one atomic fact."""

    dimensions: Tuple[Tuple[str, str], ...]

    def __post_init__(self) -> None:
        normalized = []
        keys = set()
        for key, value in self.dimensions:
            checked_key = _required_text(key, "Scope key")
            checked_value = _required_text(value, "Scope value")
            if checked_key in keys:
                raise EvidenceContractError("Evidence scope contains a duplicate key.")
            keys.add(checked_key)
            normalized.append((checked_key, checked_value))
        if not normalized:
            raise EvidenceContractError("Evidence scope must not be empty.")
        object.__setattr__(self, "dimensions", tuple(sorted(normalized)))

    @classmethod
    def from_mapping(cls, value: Mapping[str, str]) -> "EvidenceScope":
        return cls(tuple(value.items()))

    def as_dict(self) -> Dict[str, str]:
        return dict(self.dimensions)


@dataclass(frozen=True)
class EvidenceRequest:
    """One permitted request for one fact within one explicit scope."""

    request_id: str
    source: str
    subject: str
    predicate: str
    scope: EvidenceScope
    required: bool

    def __post_init__(self) -> None:
        for name in ("request_id", "source", "subject", "predicate"):
            object.__setattr__(self, name, _required_text(getattr(self, name), name))
        if not isinstance(self.required, bool):
            raise EvidenceContractError("Evidence request required must be boolean.")


@dataclass(frozen=True)
class EvidenceFreshness:
    status: FreshnessStatus
    checked_at: str
    limitation: Optional[str] = None

    def __post_init__(self) -> None:
        if self.status not in {"FRESH", "AGING", "STALE", "UNKNOWN"}:
            raise EvidenceContractError("Evidence freshness status is invalid.")
        object.__setattr__(
            self,
            "checked_at",
            _utc_timestamp(self.checked_at, "Freshness check"),
        )
        if self.status == "UNKNOWN" and not self.limitation:
            raise EvidenceContractError("Unknown freshness requires a limitation.")
        if self.limitation is not None:
            object.__setattr__(
                self,
                "limitation",
                _required_text(self.limitation, "Freshness limitation"),
            )

    def as_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "checked_at": self.checked_at,
            "limitation": self.limitation,
        }


@dataclass(frozen=True)
class EvidenceProvenance:
    provenance_id: str
    source: str
    source_locator: str
    adapter_version: str

    def __post_init__(self) -> None:
        for name in ("provenance_id", "source", "source_locator", "adapter_version"):
            object.__setattr__(self, name, _required_text(getattr(self, name), name))

    def as_dict(self) -> Dict[str, str]:
        return {
            "provenance_id": self.provenance_id,
            "source": self.source,
            "source_locator": self.source_locator,
            "adapter_version": self.adapter_version,
        }


@dataclass(frozen=True)
class AdapterRead:
    """Typed adapter output before source-specific normalization."""

    request_id: str
    source: str
    source_locator: str
    adapter_version: str
    observed_at: str
    availability: Availability
    payload: Any = None
    limitations: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        for name in ("request_id", "source", "source_locator", "adapter_version"):
            object.__setattr__(self, name, _required_text(getattr(self, name), name))
        object.__setattr__(
            self,
            "observed_at",
            _utc_timestamp(self.observed_at, "Observation"),
        )
        if self.availability not in {"AVAILABLE", "UNAVAILABLE"}:
            raise EvidenceContractError("Adapter availability is invalid.")
        limitations = tuple(
            _required_text(item, "Read limitation") for item in self.limitations
        )
        object.__setattr__(self, "limitations", limitations)
        if self.availability == "UNAVAILABLE":
            if self.payload is not None:
                raise EvidenceContractError(
                    "An unavailable read must not contain a zero, empty, or "
                    "estimated payload."
                )
            if not limitations:
                raise EvidenceContractError(
                    "An unavailable read requires a limitation."
                )
        elif self.payload is None:
            raise EvidenceContractError("An available read requires a payload.")


@dataclass(frozen=True)
class NormalizedFact:
    """Source-specific normalized scalar with explicit quality metadata."""

    value: AtomicValue
    freshness: EvidenceFreshness
    confidence: ConfidenceLevel
    limitations: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "value", _atomic_value(self.value))
        if self.confidence not in {"VERIFIED", "CORROBORATED", "INDICATIVE", "UNKNOWN"}:
            raise EvidenceContractError("Evidence confidence is invalid.")
        limitations = tuple(
            _required_text(item, "Fact limitation") for item in self.limitations
        )
        if self.confidence == "UNKNOWN" and not limitations:
            raise EvidenceContractError("Unknown confidence requires a limitation.")
        object.__setattr__(self, "limitations", limitations)


class EvidenceAdapter(Protocol):
    """Read-only source adapter for one named source."""

    source: str

    def read(self, request: EvidenceRequest) -> AdapterRead: ...


class EvidenceNormalizer(Protocol):
    """Normalizer paired with one named adapter source."""

    source: str

    def normalize(
        self,
        request: EvidenceRequest,
        collected: AdapterRead,
    ) -> NormalizedFact: ...


@dataclass(frozen=True)
class EvidenceObservation:
    observation_id: str
    request_id: str
    subject: str
    predicate: str
    scope: EvidenceScope
    availability: Availability
    value: Optional[AtomicValue]
    provenance: EvidenceProvenance
    observed_at: str
    freshness: EvidenceFreshness
    confidence: ConfidenceLevel
    limitations: Tuple[str, ...]

    def __post_init__(self) -> None:
        for name in ("observation_id", "request_id", "subject", "predicate"):
            object.__setattr__(
                self,
                name,
                _required_text(getattr(self, name), name),
            )
        object.__setattr__(
            self,
            "observed_at",
            _utc_timestamp(self.observed_at, "Observation"),
        )
        if self.availability not in {"AVAILABLE", "UNAVAILABLE"}:
            raise EvidenceContractError("Observation availability is invalid.")
        limitations = tuple(
            _required_text(item, "Observation limitation")
            for item in self.limitations
        )
        object.__setattr__(self, "limitations", limitations)
        if self.availability == "UNAVAILABLE":
            if self.value is not None:
                raise EvidenceContractError(
                    "Unavailable evidence must not contain a value."
                )
            if self.confidence != "UNKNOWN" or not limitations:
                raise EvidenceContractError(
                    "Unavailable evidence requires unknown confidence and a limitation."
                )
        else:
            object.__setattr__(self, "value", _atomic_value(self.value))
            if self.confidence not in {
                "VERIFIED",
                "CORROBORATED",
                "INDICATIVE",
                "UNKNOWN",
            }:
                raise EvidenceContractError("Evidence confidence is invalid.")

    def as_dict(self) -> Dict[str, Any]:
        return {
            "observation_id": self.observation_id,
            "request_id": self.request_id,
            "subject": self.subject,
            "predicate": self.predicate,
            "scope": self.scope.as_dict(),
            "availability": self.availability,
            "value": self.value,
            "provenance": self.provenance.as_dict(),
            "observed_at": self.observed_at,
            "freshness": self.freshness.as_dict(),
            "confidence": self.confidence,
            "limitations": list(self.limitations),
        }


@dataclass(frozen=True)
class EvidenceClaim:
    claim_id: str
    subject: str
    predicate: str
    value: AtomicValue
    scope: EvidenceScope
    observation_ids: Tuple[str, ...]
    provenance_ids: Tuple[str, ...]
    sources: Tuple[str, ...]
    observed_at: str
    freshness: FreshnessStatus
    confidence: ConfidenceLevel
    limitations: Tuple[str, ...]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "claim_id": self.claim_id,
            "subject": self.subject,
            "predicate": self.predicate,
            "value": self.value,
            "scope": self.scope.as_dict(),
            "observation_ids": list(self.observation_ids),
            "provenance_ids": list(self.provenance_ids),
            "sources": list(self.sources),
            "observed_at": self.observed_at,
            "freshness": self.freshness,
            "confidence": self.confidence,
            "limitations": list(self.limitations),
        }


@dataclass(frozen=True)
class EvidenceConflict:
    conflict_id: str
    subject: str
    predicate: str
    scope: EvidenceScope
    claim_ids: Tuple[str, ...]
    values: Tuple[AtomicValue, ...]
    resolution: Literal["UNRESOLVED"] = "UNRESOLVED"

    def as_dict(self) -> Dict[str, Any]:
        return {
            "conflict_id": self.conflict_id,
            "subject": self.subject,
            "predicate": self.predicate,
            "scope": self.scope.as_dict(),
            "claim_ids": list(self.claim_ids),
            "values": list(self.values),
            "resolution": self.resolution,
        }


@dataclass(frozen=True)
class EvidenceGap:
    gap_id: str
    request_id: str
    subject: str
    predicate: str
    source: str
    scope: EvidenceScope
    required: bool
    status: Literal["UNAVAILABLE"]
    observed_at: str
    limitations: Tuple[str, ...]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "gap_id": self.gap_id,
            "request_id": self.request_id,
            "subject": self.subject,
            "predicate": self.predicate,
            "source": self.source,
            "scope": self.scope.as_dict(),
            "required": self.required,
            "status": self.status,
            "observed_at": self.observed_at,
            "limitations": list(self.limitations),
        }


@dataclass(frozen=True)
class SnapshotConfidence:
    status: SnapshotConfidenceStatus
    available_observations: int
    unavailable_observations: int
    conflicts: int

    def as_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "available_observations": self.available_observations,
            "unavailable_observations": self.unavailable_observations,
            "conflicts": self.conflicts,
        }


@dataclass(frozen=True)
class AnalyticsEvidenceSnapshot:
    snapshot_id: str
    schema_version: str
    generated_at: str
    observations: Tuple[EvidenceObservation, ...]
    claims: Tuple[EvidenceClaim, ...]
    provenance: Tuple[EvidenceProvenance, ...]
    confidence: SnapshotConfidence
    conflicts: Tuple[EvidenceConflict, ...]
    gaps: Tuple[EvidenceGap, ...]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "snapshot_id": self.snapshot_id,
            "schema_version": self.schema_version,
            "generated_at": self.generated_at,
            "observations": [item.as_dict() for item in self.observations],
            "claims": [item.as_dict() for item in self.claims],
            "provenance": [item.as_dict() for item in self.provenance],
            "confidence": self.confidence.as_dict(),
            "conflicts": [item.as_dict() for item in self.conflicts],
            "gaps": [item.as_dict() for item in self.gaps],
        }

    def verify_fingerprint(self) -> bool:
        value = self.as_dict()
        value.pop("snapshot_id")
        return self.snapshot_id == _content_id("snapshot", value)


class EvidenceCollectorV1:
    """Route each request through its typed adapter and normalizer."""

    def __init__(
        self,
        adapters: Mapping[str, EvidenceAdapter],
        normalizers: Mapping[str, EvidenceNormalizer],
    ) -> None:
        self._adapters = dict(adapters)
        self._normalizers = dict(normalizers)
        if set(self._adapters) != set(self._normalizers):
            raise EvidenceContractError(
                "Every evidence adapter requires one normalizer."
            )
        for source, adapter in self._adapters.items():
            if (
                adapter.source != source
                or self._normalizers[source].source != source
            ):
                raise EvidenceContractError(
                    "Evidence adapter registry source mismatch."
                )

    def collect(
        self,
        requests: Sequence[EvidenceRequest],
    ) -> Tuple[EvidenceObservation, ...]:
        observations = []
        seen = set()
        for request in requests:
            if request.request_id in seen:
                raise EvidenceContractError(
                    "Evidence request identifiers must be unique."
                )
            seen.add(request.request_id)
            try:
                adapter = self._adapters[request.source]
                normalizer = self._normalizers[request.source]
            except KeyError as error:
                raise EvidenceContractError(
                    "No typed evidence adapter is registered for "
                    + request.source
                    + "."
                ) from error
            collected = adapter.read(request)
            if (
                collected.request_id != request.request_id
                or collected.source != request.source
            ):
                raise EvidenceContractError(
                    "Evidence adapter returned mismatched provenance."
                )
            provenance_body = {
                "request_id": request.request_id,
                "source": collected.source,
                "source_locator": collected.source_locator,
                "adapter_version": collected.adapter_version,
                "observed_at": collected.observed_at,
            }
            provenance = EvidenceProvenance(
                provenance_id=_content_id("provenance", provenance_body),
                source=collected.source,
                source_locator=collected.source_locator,
                adapter_version=collected.adapter_version,
            )
            if collected.availability == "UNAVAILABLE":
                value = None
                freshness = EvidenceFreshness(
                    status="UNKNOWN",
                    checked_at=collected.observed_at,
                    limitation="Source was unavailable at collection time.",
                )
                confidence: ConfidenceLevel = "UNKNOWN"
                limitations = collected.limitations
            else:
                fact = normalizer.normalize(request, collected)
                value = fact.value
                freshness = fact.freshness
                confidence = fact.confidence
                limitations = tuple(
                    sorted(set(collected.limitations + fact.limitations))
                )
            body = {
                "request_id": request.request_id,
                "subject": request.subject,
                "predicate": request.predicate,
                "scope": request.scope.as_dict(),
                "availability": collected.availability,
                "value": value,
                "provenance": provenance.as_dict(),
                "observed_at": collected.observed_at,
                "freshness": freshness.as_dict(),
                "confidence": confidence,
                "limitations": list(limitations),
            }
            observations.append(
                EvidenceObservation(
                    observation_id=_content_id("observation", body),
                    request_id=request.request_id,
                    subject=request.subject,
                    predicate=request.predicate,
                    scope=request.scope,
                    availability=collected.availability,
                    value=value,
                    provenance=provenance,
                    observed_at=collected.observed_at,
                    freshness=freshness,
                    confidence=confidence,
                    limitations=limitations,
                )
            )
        return tuple(observations)


_FRESHNESS_ORDER = {"FRESH": 0, "AGING": 1, "STALE": 2, "UNKNOWN": 3}
_CONFIDENCE_ORDER = {"VERIFIED": 0, "CORROBORATED": 1, "INDICATIVE": 2, "UNKNOWN": 3}


class EvidenceSnapshotBuilderV1:
    """Validate a complete collection and atomically seal one immutable snapshot."""

    def build(
        self,
        generated_at: str,
        requests: Sequence[EvidenceRequest],
        observations: Sequence[EvidenceObservation],
    ) -> AnalyticsEvidenceSnapshot:
        generated_at = _utc_timestamp(generated_at, "Snapshot generation")
        if not requests:
            raise EvidenceContractError(
                "An Analytics Evidence Snapshot requires at least one request."
            )
        request_by_id = {item.request_id: item for item in requests}
        if len(request_by_id) != len(requests):
            raise EvidenceContractError(
                "Evidence request identifiers must be unique."
            )
        observation_by_request: Dict[str, EvidenceObservation] = {}
        for observation in observations:
            if observation.request_id not in request_by_id:
                raise EvidenceContractError(
                    "Snapshot contains an unrequested observation."
                )
            if observation.request_id in observation_by_request:
                raise EvidenceContractError(
                    "An atomic evidence request returned multiple facts."
                )
            request = request_by_id[observation.request_id]
            if (
                observation.subject != request.subject
                or observation.predicate != request.predicate
                or observation.scope != request.scope
                or observation.provenance.source != request.source
            ):
                raise EvidenceContractError(
                    "Observation does not match its evidence request."
                )
            observation_body = observation.as_dict()
            observation_body.pop("observation_id")
            if observation.observation_id != _content_id(
                "observation",
                observation_body,
            ):
                raise EvidenceContractError(
                    "Observation fingerprint does not match its evidence."
                )
            if observation.availability == "UNAVAILABLE":
                if observation.value is not None:
                    raise EvidenceContractError(
                        "Unavailable evidence must not contain a value."
                    )
            else:
                _atomic_value(observation.value)
            if observation.observed_at > generated_at:
                raise EvidenceContractError(
                    "An observation cannot be newer than its snapshot."
                )
            observation_by_request[observation.request_id] = observation
        missing = set(request_by_id).difference(observation_by_request)
        if missing:
            raise EvidenceContractError(
                "Snapshot collection is incomplete: "
                + ", ".join(sorted(missing))
                + "."
            )

        ordered_observations = tuple(
            sorted(observations, key=lambda item: item.observation_id)
        )
        gaps = self._gaps(request_by_id, ordered_observations)
        claims, conflicts = self._claims_and_conflicts(ordered_observations)
        provenance_by_id = {
            item.provenance.provenance_id: item.provenance
            for item in ordered_observations
        }
        provenance = tuple(
            provenance_by_id[key] for key in sorted(provenance_by_id)
        )
        available_count = sum(
            item.availability == "AVAILABLE" for item in ordered_observations
        )
        if conflicts:
            confidence_status: SnapshotConfidenceStatus = "CONFLICTED"
        elif gaps:
            confidence_status = "WITH_GAPS"
        else:
            confidence_status = "READY"
        confidence = SnapshotConfidence(
            status=confidence_status,
            available_observations=available_count,
            unavailable_observations=len(ordered_observations) - available_count,
            conflicts=len(conflicts),
        )
        body = {
            "schema_version": ANALYTICS_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
            "generated_at": generated_at,
            "observations": [item.as_dict() for item in ordered_observations],
            "claims": [item.as_dict() for item in claims],
            "provenance": [item.as_dict() for item in provenance],
            "confidence": confidence.as_dict(),
            "conflicts": [item.as_dict() for item in conflicts],
            "gaps": [item.as_dict() for item in gaps],
        }
        return AnalyticsEvidenceSnapshot(
            snapshot_id=_content_id("snapshot", body),
            schema_version=ANALYTICS_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
            generated_at=generated_at,
            observations=ordered_observations,
            claims=claims,
            provenance=provenance,
            confidence=confidence,
            conflicts=conflicts,
            gaps=gaps,
        )

    @staticmethod
    def _gaps(
        request_by_id: Mapping[str, EvidenceRequest],
        observations: Iterable[EvidenceObservation],
    ) -> Tuple[EvidenceGap, ...]:
        gaps = []
        for observation in observations:
            if observation.availability != "UNAVAILABLE":
                continue
            request = request_by_id[observation.request_id]
            body = {
                "request_id": request.request_id,
                "subject": request.subject,
                "predicate": request.predicate,
                "source": request.source,
                "scope": request.scope.as_dict(),
                "required": request.required,
                "status": "UNAVAILABLE",
                "observed_at": observation.observed_at,
                "limitations": list(observation.limitations),
            }
            gaps.append(
                EvidenceGap(
                    gap_id=_content_id("gap", body),
                    request_id=request.request_id,
                    subject=request.subject,
                    predicate=request.predicate,
                    source=request.source,
                    scope=request.scope,
                    required=request.required,
                    status="UNAVAILABLE",
                    observed_at=observation.observed_at,
                    limitations=observation.limitations,
                )
            )
        return tuple(sorted(gaps, key=lambda item: item.gap_id))

    @staticmethod
    def _claims_and_conflicts(
        observations: Iterable[EvidenceObservation],
    ) -> Tuple[Tuple[EvidenceClaim, ...], Tuple[EvidenceConflict, ...]]:
        grouped: Dict[Tuple[str, str, EvidenceScope], list[EvidenceObservation]] = {}
        for observation in observations:
            if observation.availability == "AVAILABLE":
                grouped.setdefault(
                    (observation.subject, observation.predicate, observation.scope),
                    [],
                ).append(observation)
        claims = []
        conflict_groups = []
        for (subject, predicate, scope), fact_observations in grouped.items():
            by_value: Dict[str, list[EvidenceObservation]] = {}
            for observation in fact_observations:
                by_value.setdefault(
                    _canonical(observation.value),
                    [],
                ).append(observation)
            group_claims = []
            for value_key in sorted(by_value):
                supporting = by_value[value_key]
                value = supporting[0].value
                observation_ids = tuple(
                    sorted(item.observation_id for item in supporting)
                )
                provenance_ids = tuple(
                    sorted(
                        {
                            item.provenance.provenance_id
                            for item in supporting
                        }
                    )
                )
                sources = tuple(
                    sorted({item.provenance.source for item in supporting})
                )
                freshness = max(
                    (item.freshness.status for item in supporting),
                    key=lambda item: _FRESHNESS_ORDER[item],
                )
                confidence = max(
                    (item.confidence for item in supporting),
                    key=lambda item: _CONFIDENCE_ORDER[item],
                )
                if len(provenance_ids) > 1 and confidence == "VERIFIED":
                    confidence = "CORROBORATED"
                limitations = tuple(
                    sorted({limit for item in supporting for limit in item.limitations})
                )
                body = {
                    "subject": subject,
                    "predicate": predicate,
                    "value": value,
                    "scope": scope.as_dict(),
                    "observation_ids": list(observation_ids),
                    "provenance_ids": list(provenance_ids),
                    "sources": list(sources),
                    "observed_at": max(item.observed_at for item in supporting),
                    "freshness": freshness,
                    "confidence": confidence,
                    "limitations": list(limitations),
                }
                claim = EvidenceClaim(
                    claim_id=_content_id("claim", body),
                    subject=subject,
                    predicate=predicate,
                    value=value,
                    scope=scope,
                    observation_ids=observation_ids,
                    provenance_ids=provenance_ids,
                    sources=sources,
                    observed_at=body["observed_at"],
                    freshness=freshness,
                    confidence=confidence,
                    limitations=limitations,
                )
                claims.append(claim)
                group_claims.append(claim)
            if len(group_claims) > 1:
                conflict_groups.append((subject, predicate, scope, group_claims))
        ordered_claims = tuple(sorted(claims, key=lambda item: item.claim_id))
        conflicts = []
        for subject, predicate, scope, group_claims in conflict_groups:
            ordered_group = sorted(group_claims, key=lambda item: item.claim_id)
            body = {
                "subject": subject,
                "predicate": predicate,
                "scope": scope.as_dict(),
                "claim_ids": [item.claim_id for item in ordered_group],
                "values": [item.value for item in ordered_group],
                "resolution": "UNRESOLVED",
            }
            conflicts.append(
                EvidenceConflict(
                    conflict_id=_content_id("conflict", body),
                    subject=subject,
                    predicate=predicate,
                    scope=scope,
                    claim_ids=tuple(body["claim_ids"]),
                    values=tuple(body["values"]),
                )
            )
        return ordered_claims, tuple(
            sorted(conflicts, key=lambda item: item.conflict_id)
        )
