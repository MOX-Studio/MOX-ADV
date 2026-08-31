import assert from "node:assert/strict";
import test from "node:test";

import {
  GOAL_CANDIDATE_SCHEMA,
  GoalRevisionError,
  verifyGoalCandidate,
  verifyGoalFormationResult,
} from "../lib/goal-revision.ts";

const VERIFIED_AT = "2026-09-02T10:00:00.000Z";

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function exactInputs() {
  return [{
    input_id: "business_input",
    schema_version: "p0-owner-business-input-v1",
    revision_id: "owner-business-input:17",
    digest: digest("a"),
  }, {
    input_id: "historical_document",
    schema_version: "p0-application-document-v19",
    revision_id: "historical-document:17",
    digest: digest("b"),
  }];
}

function evidence(inputId, locator, text, supports = "DESIRED_OUTCOME") {
  return { supports, input_id: inputId, locator, evidence: text };
}

function candidate() {
  return {
    schema_version: GOAL_CANDIDATE_SCHEMA,
    desired_outcome: "Получать квалифицированные заявки на участие со стендом",
    qualified_action: "Представитель компании подтвердил потребность и готов обсудить формат участия",
    used_input_ids: ["business_input", "historical_document"],
    provenance: [
      evidence("business_input", "business_model.qualified_outcome", "Квалифицированная заявка на участие"),
      evidence("historical_document", "context_state.facts.site.url", "Официальная страница участия со стендом", "QUALIFIED_ACTION"),
    ],
    known_constraints: [{
      constraint: "Не считать результатом обращения посетителей без коммерческого намерения",
      input_ids: ["business_input"],
    }],
    material_ambiguity: null,
  };
}

test("deterministic validation seals a complete autonomous GoalRevision with version, digest, and exact input lineage", async () => {
  const result = await verifyGoalCandidate({
    candidate: candidate(),
    exact_inputs: exactInputs(),
    verified_at: VERIFIED_AT,
  });

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.revision.version, 1);
  assert.match(result.revision.goal_revision_id, /^goal-revision:[0-9a-f]{24}$/u);
  assert.match(result.revision.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.revision.exact_inputs, exactInputs());
  assert.equal(result.revision.validation.validator, "DETERMINISTIC_CODE");
  assert.equal(result.revision.validation.owner_confirmation_required, false);
  assert.equal(result.revision.known_constraints.length, 1);
  await verifyGoalFormationResult(result);

  const next = await verifyGoalCandidate({
    candidate: candidate(),
    exact_inputs: exactInputs(),
    verified_at: "2026-09-02T11:00:00.000Z",
    previous_version: result.revision.version,
  });
  assert.equal(next.revision.version, 2);
  assert.notEqual(next.revision.digest, result.revision.digest);
});

test("materially different desired outcomes return prepared evidence, consequences, and one recommendation instead of a revision", async () => {
  const ambiguous = candidate();
  ambiguous.material_ambiguity = {
    reason: "Доступные страницы одинаково поддерживают продажи участия и привлечение посетителей, а эти результаты меняют кампании.",
    options: [{
      option_id: "exhibitor-leads",
      desired_outcome: ambiguous.desired_outcome,
      qualified_action: ambiguous.qualified_action,
      evidence: [
        evidence("business_input", "business_model.product", "Основной продукт — участие со стендом"),
        evidence("business_input", "business_model.qualified_outcome", "Обращение квалифицируется подтверждённой потребностью", "QUALIFIED_ACTION"),
      ],
      consequences: ["Стратегия будет ориентирована на компании-экспоненты и коммерческое обращение."],
      recommended: true,
    }, {
      option_id: "visitor-registrations",
      desired_outcome: "Получать регистрации профессиональных посетителей",
      qualified_action: "Специалист зарегистрировался для посещения деловой программы",
      evidence: [
        evidence("historical_document", "site_analysis.pages[1]", "На сайте доступна регистрация посетителей"),
        evidence("historical_document", "site_analysis.actions[0]", "Регистрация является наблюдаемым действием", "QUALIFIED_ACTION"),
      ],
      consequences: ["Изменятся аудитория, измеряемое действие и все будущие Campaign Drafts."],
      recommended: false,
    }],
  };

  const result = await verifyGoalCandidate({ candidate: ambiguous, exact_inputs: exactInputs(), verified_at: VERIFIED_AT });

  assert.equal(result.status, "MATERIAL_DECISION_REQUIRED");
  assert.equal(result.options.length, 2);
  assert.equal(result.recommendation, "exhibitor-leads");
  assert.ok(result.options.every((option) => option.evidence.length > 0 && option.consequences.length > 0));
  await verifyGoalFormationResult(result);
});

test("validator rejects incomplete provenance, non-material options, and tampered sealed revisions", async () => {
  const missingProvenance = candidate();
  missingProvenance.provenance = [];
  await assert.rejects(
    verifyGoalCandidate({ candidate: missingProvenance, exact_inputs: exactInputs(), verified_at: VERIFIED_AT }),
    (error) => error instanceof GoalRevisionError && error.code === "GOAL_PROVENANCE_INVALID",
  );

  const duplicated = candidate();
  duplicated.material_ambiguity = {
    reason: "Проверяем различие",
    options: [
      {
        option_id: "one",
        desired_outcome: duplicated.desired_outcome,
        qualified_action: duplicated.qualified_action,
        evidence: [duplicated.provenance[0], duplicated.provenance[1]],
        consequences: ["Первая настройка"],
        recommended: true,
      },
      {
        option_id: "two",
        desired_outcome: duplicated.desired_outcome,
        qualified_action: "Другое действие",
        evidence: [duplicated.provenance[0], duplicated.provenance[1]],
        consequences: ["Вторая настройка"],
        recommended: false,
      },
    ],
  };
  await assert.rejects(
    verifyGoalCandidate({ candidate: duplicated, exact_inputs: exactInputs(), verified_at: VERIFIED_AT }),
    (error) => error instanceof GoalRevisionError && error.code === "GOAL_AMBIGUITY_NOT_MATERIAL",
  );

  const sealed = await verifyGoalCandidate({ candidate: candidate(), exact_inputs: exactInputs(), verified_at: VERIFIED_AT });
  sealed.revision.qualified_action = "Подменённое действие";
  await assert.rejects(
    verifyGoalFormationResult(sealed),
    (error) => error instanceof GoalRevisionError && error.code === "GOAL_REVISION_DIGEST_MISMATCH",
  );
});
