import { pipelineDigest } from "./pipeline-orchestrator.ts";
import type { JsonValue } from "./p0-agent-runtime.ts";
import type { StageAgentModel } from "./stage-agent-model.ts";

export const METHODOLOGY_AGENT_SCHEMA = "p0-methodology-agent-candidate-v1";

export type MethodologyOutcomeReference = {
  outcome_id: string;
  observed_at: string;
  result_class: "MATURE_RESULT" | "MODERATION_RESULT" | "PRELAUNCH_OBSERVATION";
  evidence_ids: string[];
  summary: string;
};

export type MethodologyRuleProposal = {
  rule_key: string;
  mechanism: string;
  applicability: string;
  evidence_refs: string[];
};

export type MethodologyCandidate = {
  schema_version: typeof METHODOLOGY_AGENT_SCHEMA;
  candidate_id: string;
  model_id: string;
  proposed_at: string;
  summary: string;
  proposed_rules: MethodologyRuleProposal[];
  source_outcomes: string[];
  authority: {
    activate_playbook: false;
    mutate_policy: false;
    mutate_campaign: false;
    publish: false;
    spend: false;
  };
};

function text(value: unknown, maximum = 2_000) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonValue(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

export class ProductionMethodologyAgent {
  private readonly model: StageAgentModel;
  private readonly now: () => string;

  constructor(model: StageAgentModel, now: () => string = () => new Date().toISOString()) {
    this.model = model;
    this.now = now;
  }

  async propose(input: {
    outcomes: MethodologyOutcomeReference[];
    current_playbook: { release_id: string; release_version: string; content_digest: string };
  }): Promise<MethodologyCandidate> {
    if (!input.outcomes.length) throw new Error("Methodology Agent requires at least one governed outcome.");
    const outcomeIds = new Set(input.outcomes.map((item) => text(item.outcome_id, 255)));
    const evidenceIds = new Set(input.outcomes.flatMap((item) => item.evidence_ids.map((id) => text(id, 255))));
    if (outcomeIds.has("") || evidenceIds.has("") || outcomeIds.size !== input.outcomes.length) {
      throw new Error("Methodology Agent requires unique exact outcome and evidence references.");
    }
    const proposedAt = this.now();
    const raw = await this.model.generate({
      agent_id: "methodology-agent",
      objective: "Propose governed Campaign Playbook candidates from mature outcomes outside every owner run.",
      instructions: "Cite only exact supplied evidence. Propose candidates only. Never activate a Playbook, mutate policy or campaigns, publish, or spend.",
      input: jsonValue({
        outcomes: input.outcomes,
        current_playbook: input.current_playbook,
        authority: { activate_playbook: false, mutate_policy: false, mutate_campaign: false, publish: false, spend: false },
      }),
      tool: {
        name: "p0_submit_methodology_candidate",
        description: "Return one non-activating governed Methodology Agent candidate.",
        input_schema: {
          type: "object",
          properties: {
            summary: { type: "string", minLength: 1, maxLength: 4000 },
            source_outcomes: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", enum: [...outcomeIds] } },
            proposed_rules: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  rule_key: { type: "string", minLength: 1, maxLength: 255 },
                  mechanism: { type: "string", minLength: 1, maxLength: 2000 },
                  applicability: { type: "string", minLength: 1, maxLength: 2000 },
                  evidence_refs: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", enum: [...evidenceIds] } },
                },
                required: ["rule_key", "mechanism", "applicability", "evidence_refs"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary", "source_outcomes", "proposed_rules"],
          additionalProperties: false,
        },
      },
    });
    const sourceOutcomes = Array.isArray(raw.source_outcomes) ? raw.source_outcomes.map(String) : [];
    const proposedRules = Array.isArray(raw.proposed_rules) ? raw.proposed_rules.map(record).map((item) => ({
      rule_key: text(item.rule_key, 255),
      mechanism: text(item.mechanism),
      applicability: text(item.applicability),
      evidence_refs: Array.isArray(item.evidence_refs) ? item.evidence_refs.map(String) : [],
    })) : [];
    if (!text(raw.summary, 4_000)
      || !sourceOutcomes.length
      || sourceOutcomes.some((id) => !outcomeIds.has(id))
      || new Set(sourceOutcomes).size !== sourceOutcomes.length
      || !proposedRules.length
      || proposedRules.some((rule) => !rule.rule_key || !rule.mechanism || !rule.applicability
        || !rule.evidence_refs.length
        || rule.evidence_refs.some((id) => !evidenceIds.has(id))
        || new Set(rule.evidence_refs).size !== rule.evidence_refs.length)) {
      throw new Error("Methodology Agent returned an invalid governed candidate.");
    }
    const identity = {
      model_id: this.model.model_id,
      proposed_at: proposedAt,
      current_playbook: input.current_playbook,
      summary: text(raw.summary, 4_000),
      proposed_rules: proposedRules,
      source_outcomes: sourceOutcomes,
    };
    return {
      schema_version: METHODOLOGY_AGENT_SCHEMA,
      candidate_id: `methodology-candidate:${(await pipelineDigest(identity)).slice(7, 31)}`,
      model_id: this.model.model_id,
      proposed_at: proposedAt,
      summary: identity.summary,
      proposed_rules: proposedRules,
      source_outcomes: sourceOutcomes,
      authority: { activate_playbook: false, mutate_policy: false, mutate_campaign: false, publish: false, spend: false },
    };
  }
}
