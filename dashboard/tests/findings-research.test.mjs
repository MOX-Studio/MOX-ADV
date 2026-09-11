import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFindingsResearchPlan, buildFindingsReport, claimFindingState } from '../lib/findings-research.ts';
import { validateBusinessObservations, researchBusinessEvidence } from '../lib/business-evidence-research.ts';
import { researchPublicFirstPartySite } from '../lib/site-research.ts';

const goal = { goal_revision_id: 'goal-1', digest: 'sha256:goal-1', desired_outcome: 'Участие компаний со стендом', qualified_action: 'Квалифицированный коммерческий запрос', customer_geography: 'Россия', success_criterion: { target_count: 30, deadline: '2027-06-30', max_result_cost_rub: 30000 } };
const page = { url: 'https://company.example/', title: 'Компания', description: '', headings: [], text_excerpt: 'Мы организуем промышленные выставки. Участие со стендом для производителей оборудования.', forms_detected: 1 };
const site = { ...page, pages: [page], fetched_at: '2026-09-07T10:00:00Z', research: { pages_analyzed: 1, links_discovered: 2, scope: 'FIRST_PARTY_PUBLIC_HTTPS', candidate_urls: ['https://company.example/terms.pdf', 'https://company.example/customers'] } };
const observation = { area: 'company', field: 'company_capabilities', value: 'Организация промышленных выставок', source_url: page.url, quote: 'Мы организуем промышленные выставки.', applicability: 'CURRENT', limitation: 'Заявлено на сайте компании.' };

test('research plan binds exact goal, qualification, region and deadline before collecting', () => {
  const first = buildFindingsResearchPlan(goal), next = buildFindingsResearchPlan({ ...goal, digest: 'sha256:goal-2', customer_geography: 'Москва' });
  assert.equal(first.questions.length, 8);
  assert.equal(new Set(first.questions.map(q => q.area)).size, 8);
  assert.equal(first.goal.qualified_action, goal.qualified_action);
  assert.notDeepEqual(first.goal, next.goal);
  assert.throws(() => buildFindingsResearchPlan({ ...goal, customer_geography: undefined }), /FINDINGS_GOAL_INCOMPLETE/);
});

test('a populated string cannot certify missing, stale or conflicting evidence', () => {
  const claim = { value: 'Участие ИННОПРОМ 2025', predicate: 'product', classification: 'observed', confidence: { tier: 'TIER_1_VERIFIED', freshness: 'current' } };
  assert.equal(claimFindingState(claim, [], '2026-09-07'), 'UNKNOWN');
  assert.equal(claimFindingState(claim, [{}], '2026-09-07'), 'STALE');
  assert.equal(claimFindingState({ ...claim, confidence: { ...claim.confidence, consistency: 'conflicted' } }, [{}]), 'CONFLICT');
  assert.equal(claimFindingState({ ...claim, value: 0 }, [{}]), 'SUPPORTED');
});

test('legacy reports remain partial, distinguish buyer from published audience and preserve canonical economics', () => {
  const fields = { audience: 'Байеры и посетители', lead_to_sale_percent: 0, capacity: '10 обращений в неделю' };
  const report = buildFindingsReport({ snapshot_id: 'old', generated_at: '2026-09-07', goal_context: goal,
    claims: Object.entries(fields).map(([predicate, value]) => ({ claim_id: predicate, subject: 'business_model', predicate, value, evidence_ids: [predicate], confidence: { freshness: 'current', tier: 'TIER_1_VERIFIED' } })),
    evidence: Object.keys(fields).map(evidence_id => ({ evidence_id, source_locator: { url: page.url } })),
  });
  assert.equal(report.sections.length, 8);
  assert.equal(report.decisions.length, 12);
  assert.match(report.sections.find(s => s.id === 'buyer').summary, /требует уточнения/);
  assert.equal(report.sections.find(s => s.id === 'economics').facts.find(f => f.field === 'lead_to_sale_percent').value, '0');
  assert.equal(report.sections.find(s => s.id === 'company').state, 'UNKNOWN');
  assert.equal(report.decisions.find(d => d.decision === 'target_result_cost').status, 'NEEDS_RESEARCH');
  assert.match(report.sections.find(s => s.id === 'measurement').summary, /не подтверждена/);
});

test('public extraction rejects fabricated quotes and URLs and keeps behaviour indicative', () => {
  assert.equal(validateBusinessObservations([observation], site).length, 1);
  assert.throws(() => validateBusinessObservations([{ ...observation, quote: 'Продажи растут на 200 процентов' }], site), /UNGROUNDED/);
  assert.throws(() => validateBusinessObservations([{ ...observation, source_url: 'https://other.example/' }], site), /UNGROUNDED/);
  const report = buildFindingsReport({ snapshot_id: 'new', business_research: { observations: [observation], gaps: [] } });
  assert.equal(report.sections[0].facts[0].state, 'INDICATIVE');
});

const decision = (observations = [], next_reads = [], research_reason = 'Доступные материалы проверены; оставшиеся вопросы требуют внутренних данных.') => ({ observations, next_reads, research_reason });
const readTask = url => ({ url, question_id: 'product', strategy_decision: 'advertised_offer', expected_answer: 'Состав участия и условия покупки для компании' });

test('the specialist selects sources for a question and strategy decision instead of URL keyword ranking', async () => {
  const urls = [], requests = [];
  const { result } = await researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal) }, {
    now: () => site.fetched_at,
    model: { model_id: 'test', async generate(request) {
      requests.push(request);
      return decision([observation], requests.length === 1 ? [readTask(site.research.candidate_urls[1])] : []);
    } },
    async readAdditional(url) { urls.push(url); return { ...site, pages: [{ ...page, url }], url }; },
  });
  assert.deepEqual(urls, ['https://company.example/customers']);
  assert.equal(requests[0].input.plan.goal.geography, 'Россия');
  assert.ok(result.attempts.some(attempt => /advertised_offer.*условия покупки/.test(attempt.outcome)));
  assert.ok(result.completion_reason);
  assert.ok(result.gaps.some(gap => gap.area === 'economics'));
});

test('purposeful research continues beyond two passes and ten pages until the agent has an answer', async () => {
  let calls = 0, reads = 0;
  const { result } = await researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal) }, {
    now: () => site.fetched_at,
    model: { model_id: 'persistent', async generate(request) {
      calls++;
      return decision([observation], calls <= 12 ? [readTask(request.input.available_source_urls[0])] : []);
    } },
    async readAdditional(url) { reads++; return { ...site, pages: [{ ...page, url }], url,
      research: { ...site.research, candidate_urls: [`https://company.example/evidence-${reads}`] } }; },
  });
  assert.equal(calls, 13);
  assert.equal(reads, 12);
  assert.equal(result.sources.length, 13);
  assert.equal(result.plan.limits.max_elapsed_ms, null);
});

test('cancellation during extraction stops subsequent collection', async () => {
  const controller = new AbortController(); let reads = 0;
  await assert.rejects(researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal), signal: controller.signal }, {
    now: () => site.fetched_at,
    model: { model_id: 'test', async generate(request) { assert.equal(request.signal, controller.signal); controller.abort(new Error('Cancelled')); return decision([observation]); } },
    async readAdditional() { reads++; return site; },
  }), /Cancelled/);
  assert.equal(reads, 0);
});

test('provider failure cannot become a successful empty research snapshot or trigger unrelated source reads', async () => {
  let calls = 0, reads = 0;
  await assert.rejects(researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal) }, {
    now: () => site.fetched_at,
    model: { model_id: 'failed', async generate() { calls++; throw new Error('MODEL_PROVIDER_FAILED'); } },
    async readAdditional() { reads++; return site; },
  }), /BUSINESS_RESEARCH_FAILED.*MODEL_PROVIDER_FAILED/);
  assert.equal(calls, 2);
  assert.equal(reads, 0);
});

test('a malformed agent result is repaired on the same corpus without reading invented sources', async () => {
  let calls = 0;
  const { result } = await researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal) }, {
    now: () => site.fetched_at,
    model: { model_id: 'repair', async generate(request) {
      calls++;
      if (calls === 1) return decision([observation], [readTask('https://invented.example/')]);
      assert.match(request.input.repair.reason, /source must answer/);
      assert.deepEqual(request.input.pages, site.pages);
      return decision([observation]);
    } },
    async readAdditional() { assert.fail('An invented URL cannot become a research source'); },
  });
  assert.equal(calls, 2);
  assert.equal(result.observations.length, 1);
});

test('a chosen source must affect a decision related to its research question', async () => {
  await assert.rejects(researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal) }, {
    now: () => site.fetched_at,
    model: { model_id: 'irrelevant', async generate() { return decision([], [{ ...readTask(site.research.candidate_urls[0]), strategy_decision: 'qualified_result' }]); } },
    async readAdditional() { assert.fail('Unrelated research must be rejected'); },
  }), /BUSINESS_RESEARCH_FAILED/);
});

test('valid empty output is an explained research gap, distinct from a failed agent', async () => {
  const { result } = await researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal) }, {
    now: () => site.fetched_at, model: { model_id: 'empty', async generate() { return decision(); } },
    async readAdditional() { assert.fail('The agent found no useful public follow-up'); },
  });
  assert.deepEqual(result.observations, []);
  assert.equal(result.gaps.length, 8);
  assert.match(result.completion_reason, /внутренних данных/);
});

test('later passes retain verified observations and one product fact cannot close missing terms and value', async () => {
  let calls = 0;
  const product = { ...observation, area: 'product', field: 'product', value: 'Участие со стендом', quote: 'Участие со стендом для производителей оборудования.' };
  const { result } = await researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal) }, {
    now: () => site.fetched_at,
    model: { model_id: 'incremental', async generate() { return ++calls === 1 ? decision([observation], [readTask(site.research.candidate_urls[0])]) : decision([product]); } },
    async readAdditional(url) { return { ...site, pages: [{ ...page, url }], url }; },
  });
  assert.deepEqual(result.observations.map(item => item.field), ['company_capabilities', 'product']);
  assert.match(result.gaps.find(gap => gap.area === 'product').reason, /состав и условия покупки/);
  assert.match(result.gaps.find(gap => gap.area === 'product').reason, /ценность для покупателя/);
});

test('a failed supplemental analysis keeps valid facts and records incomplete analysis', async () => {
  let calls = 0;
  const { result } = await researchBusinessEvidence({ site, plan: buildFindingsResearchPlan(goal) }, {
    now: () => site.fetched_at,
    model: { model_id: 'partial', async generate() { if (++calls > 1) throw new Error('MODEL_PROVIDER_FAILED'); return decision([observation], [readTask(site.research.candidate_urls[0])]); } },
    async readAdditional(url) { return { ...site, pages: [{ ...page, url }], url }; },
  });
  assert.equal(result.observations.length, 1);
  assert.match(result.gaps.find(gap => gap.area === 'product').reason, /Дополнительный анализ не завершён/);
});

test('unknown applicability and mismatched fields cannot close a current research question', () => {
  assert.throws(() => validateBusinessObservations([{ ...observation, area: 'buyer' }], site), /area\/field/);
  const report = buildFindingsReport({ snapshot_id: 'uncertain', as_of: site.fetched_at,
    business_research: { observations: [{ ...observation, applicability: 'UNKNOWN' }], gaps: [] } });
  assert.equal(report.sections[0].state, 'UNKNOWN');
  assert.ok(report.sections[0].gaps.length);
});

function pdfBytes() {
  const stream = 'BT /F1 12 Tf 30 100 Td (Participation terms for industrial companies) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let data = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((value,index) => { offsets.push(data.length); data += `${index+1} 0 obj\n${value}\nendobj\n`; });
  const xref = data.length; data += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(data);
}
test('goal-directed collection reads public PDF text within page and byte limits', async () => {
  const collected = await researchPublicFirstPartySite('https://company.example/terms.pdf', {
    plan: { ...buildFindingsResearchPlan(goal), limits: { max_pages: 1 } }, now: () => site.fetched_at,
    resolveHostname: async () => ['93.184.216.34'], fetch: async () => new Response(pdfBytes(), { headers: { 'content-type': 'application/pdf' } }),
  });
  assert.equal(collected.pages.length, 1);
  assert.match(collected.pages[0].text_excerpt, /Participation terms/);
});
