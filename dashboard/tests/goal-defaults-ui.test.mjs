import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeOwnerGoalInput, normalizeGoalCountingPolicy, QUALIFIED_REQUEST_COUNTING_POLICY, verifyGoalFormationResult } from "../lib/goal-revision.ts";
import { createCurrentGoal } from "../lib/goal-revision-lifecycle.ts";

const input = {
  desired_outcome: "Заявки на участие со стендом", qualified_action: "Квалифицированное обращение компании",
  customer_geography: "Россия", success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30_000 },
};

test("new owner goals use the approved counting policy without a checkbox", async () => {
  const normalized = normalizeOwnerGoalInput(input);
  assert.deepEqual(normalized.counting_policy, QUALIFIED_REQUEST_COUNTING_POLICY);
  assert.notEqual(normalized.counting_policy, QUALIFIED_REQUEST_COUNTING_POLICY);
  const current = await createCurrentGoal({ ...input, owner_key: "test-owner", created_at: "2026-09-07T12:00:00Z" });
  assert.deepEqual(current.revision.counting_policy, QUALIFIED_REQUEST_COUNTING_POLICY);
  assert.equal(current.revision.counting_policy.form_submission_alone, "DOES_NOT_QUALIFY");
  await verifyGoalFormationResult({ status: "VERIFIED", revision: current.revision });
});

test("defaulting a new submission does not allow disabling the rule or changing a sealed revision", async () => {
  for (const value of [null, false, {}, { ...QUALIFIED_REQUEST_COUNTING_POLICY, repeated_contacts: "COUNT" }]) {
    assert.throws(() => normalizeOwnerGoalInput({ ...input, counting_policy: value }));
  }
  assert.throws(() => normalizeGoalCountingPolicy(undefined), "The sealed-revision verifier remains strict.");
  const current = await createCurrentGoal({ ...input, owner_key: "test-owner", created_at: "2026-09-07T12:00:00Z" });
  const corrupted = structuredClone(current.revision);
  delete corrupted.counting_policy;
  await assert.rejects(verifyGoalFormationResult({ status: "VERIFIED", revision: corrupted }));
});

test("Goal UI removes explanatory blocks and counting control, retaining its explicit submitted policy", async () => {
  const source = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
  const goalSection = source.slice(source.indexOf("function GoalStageSummary("), source.indexOf("function Header()"));
  assert.doesNotMatch(goalSection, /readinessErrors\.join|Готовность Цели —|Определяется владельцем;|counting_policy_confirmed|GOAL_COUNTING_RULE/u);
  assert.match(source, /counting_policy: QUALIFIED_REQUEST_COUNTING_POLICY/u);
  assert.match(goalSection, /Получить результат до/u);
  assert.match(goalSection, /className="owner-goal-card owner-goal-geography"/u);
  assert.match(goalSection, /<GeographyAutocomplete/u);
});
