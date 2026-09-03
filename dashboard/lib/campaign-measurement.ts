export type CampaignMeasurementRequirement = "NOT_CONSUMED" | "EXACT_METRIKA_GOAL";

export type CampaignMeasurementPlan = {
  requirement: CampaignMeasurementRequirement;
  status: "NOT_REQUIRED" | "READY" | "BLOCKED";
  source: "YANDEX_METRIKA_OFFICIAL_API" | null;
  counter_id: string | null;
  primary_goal_id: string | null;
  readiness_id: string | null;
  exact_binding: {
    counter_matched: boolean;
    goal_matched: boolean;
  } | null;
  registration_test: {
    status: "PASSED" | "FAILED" | "NOT_RUN";
    tested_goal_id: string | null;
    tested_at: string | null;
  } | null;
  writes_required: false;
};

export type CampaignMeasurementInput = {
  requirement?: CampaignMeasurementRequirement;
  counter_id?: unknown;
  primary_goal_id?: unknown;
  readiness_id?: unknown;
  counter_binding_matched?: unknown;
  goal_binding_matched?: unknown;
  registration_test_status?: unknown;
  registration_test_goal_id?: unknown;
  registration_tested_at?: unknown;
};

const text = (value: unknown) => String(value ?? "").normalize("NFKC").trim();
const providerId = (value: unknown) => /^\d+$/u.test(text(value)) ? text(value) : null;
const timestamp = (value: unknown) => Number.isFinite(Date.parse(text(value))) ? text(value) : null;

export function buildCampaignMeasurementPlan(input: CampaignMeasurementInput = {}): CampaignMeasurementPlan {
  const requirement = input.requirement === "EXACT_METRIKA_GOAL" ? "EXACT_METRIKA_GOAL" : "NOT_CONSUMED";
  if (requirement === "NOT_CONSUMED") {
    return {
      requirement,
      status: "NOT_REQUIRED",
      source: null,
      counter_id: null,
      primary_goal_id: null,
      readiness_id: null,
      exact_binding: null,
      registration_test: null,
      writes_required: false,
    };
  }

  const counterId = providerId(input.counter_id);
  const goalId = providerId(input.primary_goal_id);
  const readinessId = text(input.readiness_id) || null;
  const testedGoalId = providerId(input.registration_test_goal_id);
  const testedAt = timestamp(input.registration_tested_at);
  const registrationStatus = input.registration_test_status === "PASSED"
    ? "PASSED" as const
    : input.registration_test_status === "FAILED" ? "FAILED" as const : "NOT_RUN" as const;
  const binding = {
    counter_matched: input.counter_binding_matched === true,
    goal_matched: input.goal_binding_matched === true,
  };
  const ready = Boolean(
    counterId
    && goalId
    && readinessId
    && binding.counter_matched
    && binding.goal_matched
    && registrationStatus === "PASSED"
    && testedGoalId === goalId
    && testedAt,
  );
  return {
    requirement,
    status: ready ? "READY" : "BLOCKED",
    source: "YANDEX_METRIKA_OFFICIAL_API",
    counter_id: counterId,
    primary_goal_id: goalId,
    readiness_id: readinessId,
    exact_binding: binding,
    registration_test: {
      status: registrationStatus,
      tested_goal_id: testedGoalId,
      tested_at: testedAt,
    },
    writes_required: false,
  };
}

export function campaignMeasurementPlanBlockers(value: unknown) {
  const plan = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<CampaignMeasurementPlan>
    : {};
  if (plan.requirement === "NOT_CONSUMED") {
    return plan.status === "NOT_REQUIRED"
      && plan.source === null
      && plan.counter_id === null
      && plan.primary_goal_id === null
      && plan.readiness_id === null
      && plan.exact_binding === null
      && plan.registration_test === null
      && plan.writes_required === false
      ? []
      : ["METRIKA_NOT_CONSUMED_PLAN_INVALID"];
  }
  if (plan.requirement !== "EXACT_METRIKA_GOAL") return ["METRIKA_REQUIREMENT_UNKNOWN"];
  const binding = plan.exact_binding;
  const registration = plan.registration_test;
  const blockers: string[] = [];
  if (!providerId(plan.counter_id) || !providerId(plan.primary_goal_id) || !text(plan.readiness_id)) {
    blockers.push("METRIKA_EXACT_BINDING_INCOMPLETE");
  }
  if (!binding?.counter_matched || !binding.goal_matched) blockers.push("METRIKA_EXACT_BINDING_UNVERIFIED");
  if (registration?.status !== "PASSED"
    || providerId(registration.tested_goal_id) !== providerId(plan.primary_goal_id)
    || !timestamp(registration.tested_at)) {
    blockers.push("METRIKA_REGISTRATION_TEST_REQUIRED");
  }
  if (plan.status !== "READY") blockers.push("METRIKA_MEASUREMENT_NOT_READY");
  if (plan.source !== "YANDEX_METRIKA_OFFICIAL_API" || plan.writes_required !== false) {
    blockers.push("METRIKA_SOURCE_CONTRACT_INVALID");
  }
  return [...new Set(blockers)];
}
