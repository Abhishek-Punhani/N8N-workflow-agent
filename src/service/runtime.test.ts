import { GeminiLLMClient } from '../plan/gemini-client';
import { isPublicAddress, fetchSource } from './source';
import { compileExecutable } from './compiler';
import { validateRecords } from './pipeline';
import { csvCell } from './http';
import type { IR, StructuredObjective } from '../core/types';

const objective: StructuredObjective = { target_entity: 'users', constraints: [], required_fields: [{ name: 'id', type: 'number', required: true }] };
const schema = { type: 'object' as const, properties: { id: { type: 'number' as const } } };
const graph = (): IR => ({
  metadata: { objective_hash: 'test', created_at: new Date().toISOString(), planner_version: 'test' },
  steps: [
    { id: 'acquire', type: 'Acquire', parameters: { urls: ['https://example.org/data'], method: 'GET' }, input_schema: { type: 'object' }, output_schema: schema },
    { id: 'deliver', type: 'Deliver', parameters: { records: [], format: 'json' }, input_schema: schema, output_schema: schema },
  ], connections: [{ from_step: 'acquire', from_output: 'main', to_step: 'deliver', to_input: 'main' }], field_mappings: [],
});
describe('Production runtime safeguards', () => {
  it.each(['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.2','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','0.0.0.0','224.0.0.1'])('blocks private source %s', address => expect(isPublicAddress(address)).toBe(false));
  it('accepts public IPv4', () => expect(isPublicAddress('8.8.8.8')).toBe(true));
  it.each(['http://example.com','https://user:secret@example.com','https://example.com:8080'])('rejects unsafe URLs before networking: %s', async url => { await expect(fetchSource(url)).rejects.toThrow('HTTPS'); });
  it('compiles the real n8n connection array shape', () => {
    const workflow = compileExecutable(graph(), objective, 'test');
    expect(workflow.connections.Trigger.main[0][0].node).toBe('Input');
    expect(workflow.nodes.every(n => ['n8n-nodes-base.webhook','n8n-nodes-base.code'].includes(n.type))).toBe(true);
  });
  it('rejects disconnected graphs and duplicate IDs', () => {
    const ir = graph(); ir.connections = [];
    expect(() => compileExecutable(ir, objective, 'test')).toThrow('single Acquire');
    ir.steps[1].id = 'acquire';
    expect(() => compileExecutable(ir, objective, 'test')).toThrow('Duplicate');
  });
  it('rejects undeclared output fields', () => {
    const ir = graph(); ir.steps[1].output_schema = { type: 'object', properties: {} };
    expect(() => compileExecutable(ir, objective, 'test')).toThrow('missing field: id');
  });
  it('does not certify missing fields or type coercions', () => {
    expect(() => validateRecords([{}], objective, 'https://example.org')).toThrow('missing');
    expect(() => validateRecords([{ id: '1' }], objective, 'https://example.org')).toThrow('type mismatch');
  });
  it('deduplicates deterministically and attaches the actual acquired source', () => {
    const output = validateRecords([{id:1},{id:1},{id:2}], objective, 'https://example.org');
    expect(output).toHaveLength(2);
    expect(output[0]._provenance).toMatchObject({ source_url: 'https://example.org', validation_status: 'valid' });
  });
  it.each(['=SUM(1,2)','+1','-2','@IMPORT','\tformula','  =1'])('neutralizes spreadsheet formula %s', value => { expect(csvCell(value)).toMatch(/^"'/); });
  it('quotes CSV commas, quotes and newlines', () => expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'));
});

describe('Gemini-only transport', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  it('rejects a non-Gemini-3 model', () => expect(() => new GeminiLLMClient('test','gpt-4o')).toThrow('Gemini 3'));
  it('uses native system instructions, the selected model, and request cancellation', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }] }) });
    const signal = new AbortController().signal;
    await expect(new GeminiLLMClient('test','gemini-3-flash-preview').complete('system','user',signal)).resolves.toBe('{"ok":true}');
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toContain('gemini-3-flash-preview:generateContent');
    expect(call[1].signal).toBe(signal);
    expect(JSON.parse(call[1].body).systemInstruction.parts[0].text).toBe('system');
  });
  it('does not switch models or return synthetic content on a quota error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(new GeminiLLMClient('test','gemini-3-flash-preview').complete('system','user',new AbortController().signal)).rejects.toThrow('429');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects already cancelled calls without making a request', async () => {
    global.fetch = jest.fn(); const controller = new AbortController(); controller.abort();
    await expect(new GeminiLLMClient('test','gemini-3-flash-preview').complete('s','u',controller.signal)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
