import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.E2E_BASE_URL ?? 'http://localhost';
const headers = { authorization: `Bearer ${process.env.PLATFORM_API_TOKEN}`, 'content-type': 'application/json' };
const prompt = process.env.E2E_PROMPT ?? 'Find 2 TV retailers physically located in Pune, India. Return name, full street address and publicly listed business phone as fields named name, address, phone. Include source evidence. A city name alone is not a street address.';
async function api(path, options = {}, status = 200) {
  const response = await fetch(`${base}/api${path}`, { headers, ...options });
  assert.equal(response.status, status, `${path}: HTTP ${response.status}`);
  return response.json();
}
const submitted = await api('/prompts', { method: 'POST', body: JSON.stringify({ prompt }) }, 202);
console.log(`Submitted general collection: ${submitted.execution_id}`);
let job;
const deadline = Date.now() + 420000;
let printed = 0;
while (Date.now() < deadline) {
  job = await api(`/executions/${submitted.execution_id}`);
  if (Date.now() - printed > 25000) {
    console.log(JSON.stringify({ status: job.status, pages: job.collection?.pages_visited, records: job.collection?.accepted_records }));
    printed = Date.now();
  }
  if (['completed', 'failed'].includes(job.status)) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
const inspection = await api(`/executions/${submitted.execution_id}/records`);
await mkdir('reports', { recursive: true });
await writeFile('reports/general-collection.json', JSON.stringify({ job, records: inspection.records }, null, 2));
assert.equal(job.status, 'completed', job.error ?? job.status);
assert.ok(inspection.records.length > 0);
assert.ok(job.verification_stages.every(stage => stage.status === 'success'));
for (const record of inspection.records) {
  assert.equal(record._provenance.extraction_confidence, null);
  for (const field of Object.keys(record).filter(field => field !== '_provenance')) {
    if (field === 'source_url') continue;
    const evidence = record._provenance.field_evidence[field];
    assert.ok(evidence?.quote && evidence.source_url && evidence.retrieved_at, `${field}: missing evidence`);
  }
}
console.log(JSON.stringify({ execution: job.execution_id, records: job.records_processed, coverage: job.collection.coverage, stop_reason: job.collection.stop_reason }));
