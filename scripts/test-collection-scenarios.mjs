import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.E2E_BASE_URL ?? 'http://localhost';
const headers = { authorization: `Bearer ${process.env.PLATFORM_API_TOKEN}`, 'content-type': 'application/json' };
const cases = [
  { name: 'bengaluru-founders', count: 3, prompt: 'Find 3 Bengaluru startups working on both AI and blockchain. Return company name, founder name, official website and founder LinkedIn URL where publicly linked. Include company business email and phone only when published for business enquiries; leave missing contacts blank. Include evidence for location and business activity.' },
  { name: 'book-catalog', count: 3, prompt: 'From https://books.toscrape.com/ collect 3 books. Return title and price. Use complete book titles and include source evidence.' },
  { name: 'pune-retailers', count: 2, prompt: 'Find 2 TV retailers physically located in Pune, India. Return name, full street address and publicly listed business phone as fields named name, address, phone. Include source evidence. A city name alone is not a street address.' },
];
const selected = process.env.E2E_CASE ? cases.filter(item => item.name === process.env.E2E_CASE) : cases;
assert.ok(selected.length, 'Unknown E2E_CASE');
if (process.env.E2E_RETRY_ID) assert.equal(selected.length, 1, 'Select one E2E_CASE when resuming a run');
await mkdir('reports', { recursive: true });
async function api(path, options = {}) {
  const response = await fetch(`${base}/api${path}`, { headers, ...options });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
let shortfalls = 0;
for (const scenario of selected) {
  const submitted = await api(process.env.E2E_RETRY_ID ? `/executions/${encodeURIComponent(process.env.E2E_RETRY_ID)}/retry` : '/prompts', { method: 'POST', body: JSON.stringify({ prompt: scenario.prompt }) });
  console.log(JSON.stringify({ scenario: scenario.name, execution: submitted.execution_id }));
  let job;
  const deadline = Date.now() + 780000;
  let lastPrint = 0;
  while (Date.now() < deadline) {
    job = await api(`/executions/${submitted.execution_id}`);
    if (Date.now() - lastPrint > 20000) {
      console.log(JSON.stringify({ scenario: scenario.name, status: job.status, accepted: job.collection?.accepted_records, candidates: job.collection?.candidate_records, action: job.collection?.activity?.message, pages: job.collection?.pages_visited }));
      lastPrint = Date.now();
    }
    if (['completed', 'failed'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const inspection = await api(`/executions/${submitted.execution_id}/records`);
  await writeFile(`reports/${scenario.name}${process.env.E2E_RETRY_ID ? '-resume' : ''}.json`, JSON.stringify({ job, records: inspection.records }, null, 2));
  if (job.status === 'completed') {
    assert.ok(job.verification_stages.every(stage => stage.status === 'success'));
    for (const record of inspection.records) {
      assert.ok(record._provenance.evidence_review?.accepted, 'Missing evidence review');
      for (const field of Object.keys(record).filter(field => field !== '_provenance' && field !== 'source_url')) {
        assert.ok(record._provenance.field_evidence[field]?.quote, `${field}: missing field evidence`);
      }
    }
  }
  const fulfilled = job.status === 'completed' && inspection.records.length === scenario.count && job.collection.coverage === 'requested_count_reached';
  if (!fulfilled) shortfalls++;
  console.log(JSON.stringify({ scenario: scenario.name, fulfilled, status: job.status, records: inspection.records.length, requested: scenario.count, stop_reason: job.collection?.stop_reason, error: job.error }));
}
// Partial output is useful but is not a passing requested-count benchmark.
process.exitCode = shortfalls ? 1 : 0;
