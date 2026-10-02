import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const headers = { authorization: `Bearer ${process.env.PLATFORM_API_TOKEN}`, 'content-type': 'application/json' };
async function api(path, options = {}, expected = 200) {
  const response = await fetch(`${base}/api${path}`, { headers, ...options });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`);
  return response;
}
const readyDeadline = Date.now() + 60000;
while (Date.now() < readyDeadline) {
  try { if ((await fetch(`${base}/api/ready`)).ok) break; } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.equal((await fetch(`${base}/api/dashboard`)).status, 401);
await api('/ready');
await api('/prompts', { method: 'POST', body: '{bad json' }, 400);
await api('/prompts', { method: 'POST', body: JSON.stringify({prompt:''}) }, 400);
await api('/prompts', { method: 'POST', body: JSON.stringify({prompt:'x'.repeat(33000)}) }, 413);
await api('/executions/00000000-0000-0000-0000-000000000000', {}, 404);
const prompt = process.env.E2E_PROMPT ?? 'From https://jsonplaceholder.typicode.com/users collect all users with id, name and email. Return JSON.';
const submitted = await (await api('/prompts', { method: 'POST', body: JSON.stringify({ prompt }) }, 202)).json();
console.log(`Live collection → n8n run submitted: ${submitted.execution_id}`);
let job;
const deadline = Date.now() + 300000;
while (Date.now() < deadline) {
  job = await (await api(`/executions/${submitted.execution_id}`)).json();
  if (['completed','failed'].includes(job.status)) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
assert.equal(job.status, 'completed', `Live run failed: ${job.error ?? job.status}`);
assert.ok(job.workflow_id, 'Real n8n workflow ID must be persisted');
assert.ok(job.verification_stages.every(s => s.status === 'success'));
const inspection = await (await api(`/executions/${job.execution_id}/records?limit=2&offset=0`)).json();
assert.equal(inspection.records.length, 2);
assert.ok(inspection.total_records >= 2);
assert.equal(inspection.records[0]._provenance.source_url, 'https://jsonplaceholder.typicode.com/users');
assert.equal(typeof inspection.records[0].id, 'number');
await api(`/executions/${job.execution_id}/records?limit=-1`, {}, 400);
await api(`/executions/${job.execution_id}/export`, {method:'POST',body:'{"format":"xml"}'}, 400);
for (const format of ['csv','json']) {
  const exported = await (await api(`/executions/${job.execution_id}/export`, {method:'POST',body:JSON.stringify({format})})).json();
  const response = await fetch(`${base}${exported.download_url}`, {headers});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), new RegExp(`\\.${format}`));
  const content = await response.text();
  if (format === 'json') assert.equal(JSON.parse(content).length, job.records_processed);
  else { assert.ok(content.includes('source_url')); assert.equal(content.split('\r\n').length, job.records_processed + 2); }
}
await writeFile('/tmp/forma-verified-job.json', JSON.stringify({id:job.execution_id,records:job.records_processed,workflow:job.workflow_id}));
console.log(`PASS: authentication, input validation, live collection, n8n sandbox/execution, ${job.records_processed} persisted records, pagination, CSV and JSON exports`);
