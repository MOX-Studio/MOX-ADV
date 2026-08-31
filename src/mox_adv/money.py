"""Typed monetary observations with explicit semantic comparability rules."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal, Optional, Sequence, Tuple

MoneyKind = Literal[
    "ACTUAL_BID",
    "BID_CEILING",
    "AUCTION_PROXY",
    "HISTORICAL_CPC",
    "HISTORICAL_CPA",
    "TARGET_RESULT_COST",
    "BUDGET",
]
MoneyStatus = Literal["AVAILABLE", "UNAVAILABLE"]
VatTreatment = Literal["INCLUDED", "EXCLUDED", "UNKNOWN"]
_VALID_KINDS = frozenset(
    {
        "ACTUAL_BID",
        "BID_CEILING",
        "AUCTION_PROXY",
        "HISTORICAL_CPC",
        "HISTORICAL_CPA",
        "TARGET_RESULT_COST",
        "BUDGET",
    }
)


def projection_source_code(source: str) -> str:
    """Sanitize a provenance label for the identifier-safe Strategy boundary."""

    value = re.sub(r"[^A-Z0-9_]", "_", source.upper()).strip("_")[:64]
    return value if value and value[0].isalpha() else "TYPED_SNAPSHOT"


class IncomparableMoneyError(ValueError):
    """Raised when code attempts to combine different monetary semantics."""


@dataclass(frozen=True)
class MonetaryScope:
    """Business scope to which one monetary value applies."""

    level: Literal["CAMPAIGN", "CAMPAIGN_GOAL"]
    organization: str
    account: str
    campaign: str
    goal: Optional[str] = None

    def __post_init__(self) -> None:
        if self.level not in {"CAMPAIGN", "CAMPAIGN_GOAL"}:
            raise ValueError("Monetary observation scope level is invalid.")
        if not all((self.organization, self.account, self.campaign)):
            raise ValueError("Monetary observation scope is incomplete.")
        if self.level == "CAMPAIGN_GOAL" and not self.goal:
            raise ValueError("Campaign-goal money requires a goal scope.")
        if self.level == "CAMPAIGN" and self.goal is not None:
            raise ValueError("Campaign money cannot carry a goal scope.")


@dataclass(frozen=True)
class MonetaryPeriod:
    """Closed applicability or observation period for one monetary value."""

    start: str
    end: str
    basis: Literal["REPORTING_PERIOD", "BUDGET_PERIOD", "OBSERVATION_INSTANT"]

    def __post_init__(self) -> None:
        if self.basis not in {
            "REPORTING_PERIOD",
            "BUDGET_PERIOD",
            "OBSERVATION_INSTANT",
        }:
            raise ValueError("Monetary observation period basis is invalid.")
        if not self.start or not self.end:
            raise ValueError("Monetary observation period is incomplete.")


@dataclass(frozen=True)
class MonetaryObservation:
    """One amount whose meaning must never be inferred from its magnitude."""

    kind: MoneyKind
    status: MoneyStatus
    amount_micros: Optional[str]
    currency: str
    vat: VatTreatment
    scope: MonetaryScope
    period: MonetaryPeriod
    source: str
    constraints: Tuple[str, ...]

    def __post_init__(self) -> None:
        if self.kind not in _VALID_KINDS:
            raise ValueError("Monetary observation kind is invalid.")
        if self.status not in {"AVAILABLE", "UNAVAILABLE"}:
            raise ValueError("Monetary observation status is invalid.")
        if self.currency != "RUB":
            raise ValueError("Only RUB monetary observations are supported.")
        if self.vat not in {"INCLUDED", "EXCLUDED", "UNKNOWN"}:
            raise ValueError("Monetary VAT treatment is invalid.")
        if (
            not self.source
            or not self.constraints
            or not all(self.constraints)
        ):
            raise ValueError("Monetary source and constraints are required.")
        if self.status == "UNAVAILABLE":
            if self.amount_micros is not None:
                raise ValueError("Unavailable money cannot carry an amount.")
            return
        if self.amount_micros is None:
            raise ValueError("Available money requires an amount.")
        try:
            amount = Decimal(self.amount_micros)
        except (InvalidOperation, ValueError) as error:
            raise ValueError("Monetary amount must be an exact decimal.") from error
        if not amount.is_finite() or amount < 0:
            raise ValueError("Monetary amount must be finite and non-negative.")


def observation_for_kind(
    observations: Sequence[MonetaryObservation],
    kind: MoneyKind,
) -> MonetaryObservation:
    """Return the unique observation for an exact semantic kind."""

    matches = [observation for observation in observations if observation.kind == kind]
    if len(matches) != 1:
        raise IncomparableMoneyError(
            "Exactly one monetary observation is required for " + kind + "."
        )
    return matches[0]


def require_comparable_money(
    observations: Sequence[MonetaryObservation],
) -> Tuple[MonetaryObservation, ...]:
    """Fail closed unless all values have identical aggregation semantics."""

    values = tuple(observations)
    if not values:
        raise IncomparableMoneyError("At least one monetary observation is required.")
    first = values[0]
    if first.status != "AVAILABLE":
        raise IncomparableMoneyError("Unavailable money cannot be aggregated.")
    compatibility_key = (
        first.kind,
        first.currency,
        first.vat,
        first.scope,
        first.period,
    )
    for observation in values[1:]:
        if observation.status != "AVAILABLE" or (
            observation.kind,
            observation.currency,
            observation.vat,
            observation.scope,
            observation.period,
        ) != compatibility_key:
            raise IncomparableMoneyError(
                "Monetary observations with different semantics are incomparable."
            )
    return values
