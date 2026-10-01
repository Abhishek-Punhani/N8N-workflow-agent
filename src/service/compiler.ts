import type { IR, StructuredObjective } from '../core/types.js';
import type { ExecutableWorkflow } from './n8n.js';

/** This function is compiled by TypeScript, then embedded as a vetted n8n Code template.
 * Model output is serialized as data and is never evaluated as JavaScript. */
function transform(items: Array<{ json: Record<string, unknown> }>, type: string, params: Record<string, unknown>): Array<{ json: Record<string, unknown> }> {
  const read = (obj: unknown, path: string): unknown => path.split('.').reduce<unknown>((value, key) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe field path');
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  }, obj);
  let records = items.map(i => i.json);
  if (type === 'Acquire' || type === 'Extract' || type === 'Provenance' || type === 'Persist' || type === 'Deliver') return items;
  if (type === 'Transform' || type === 'Enrich') {
    const mapping = (type === 'Transform' ? params.mapping : params.enrichments) as Record<string, string>;
    records = records.map(record => {
      const result: Record<string, unknown> = { ...record };
      for (const [target, source] of Object.entries(mapping)) {
        if (['__proto__', 'constructor', 'prototype'].includes(target)) throw new Error('Unsafe target field');
        const value = read(record, source);
        if (value === undefined) throw new Error(`Field mapping missing source: ${source}`);
        result[target] = value;
      }
      return result;
    });
  } else if (type === 'Filter') {
    const conditions = params.conditions as Array<{ field: string; operator: string; value: unknown }>;
    records = records.filter(record => conditions.every(c => {
      const actual = read(record, c.field);
      switch (c.operator) {
        case 'equals': return actual === c.value;
        case 'contains': return typeof actual === 'string' && typeof c.value === 'string' && actual.includes(c.value);
        case 'greater_than': return typeof actual === 'number' && typeof c.value === 'number' && actual > c.value;
        case 'less_than': return typeof actual === 'number' && typeof c.value === 'number' && actual < c.value;
        case 'in': return Array.isArray(c.value) && c.value.includes(actual);
        case 'between': return typeof actual === 'number' && Array.isArray(c.value) && actual >= Number(c.value[0]) && actual <= Number(c.value[1]);
        default: throw new Error(`Unsupported filter operator: ${c.operator}`);
      }
    }));
  } else if (type === 'Resolve') {
    const seen = new Set<string>();
    const keys = params.keys as string[];
    records = records.filter(record => {
      const values = keys.map(k => read(record, k));
      if (values.some(v => v === undefined)) throw new Error('Deduplication key is missing');
      const key = JSON.stringify(values);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  } else if (type === 'Validate') {
    for (const record of records) for (const rule of params.rules as Array<{ field: string; type: string; required?: boolean }>) {
      const value = read(record, rule.field);
      if (value === undefined || value === null) {
        if (rule.required !== false) throw new Error(`Missing required field: ${rule.field}`);
      } else if (rule.type === 'array' ? !Array.isArray(value) : typeof value !== rule.type) throw new Error(`Invalid field type: ${rule.field}`);
    }
  } else throw new Error(`Unsupported capability: ${type}`);
  return records.map(json => ({ json }));
}

export function compileExecutable(ir: IR, objective: StructuredObjective, path: string): ExecutableWorkflow {
  if (ir.steps.length < 2 || ir.steps.length > 30) throw new Error('A workflow must have 2–30 steps');
  const byId = new Map(ir.steps.map(s => [s.id, s]));
  if (byId.size !== ir.steps.length) throw new Error('Duplicate step IDs');
  const roots = ir.steps.filter(s => !ir.connections.some(c => c.to_step === s.id));
  if (roots.length !== 1 || roots[0].type !== 'Acquire') throw new Error('Workflow must start with a single Acquire step for an explicit JSON source');
  const ordered = [];
  let current = roots[0];
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id)) throw new Error('Workflow contains a cycle');
    visited.add(current.id); ordered.push(current);
    const outgoing = ir.connections.filter(c => c.from_step === current.id);
    if (outgoing.length > 1) throw new Error('Branching workflows are not supported in this release');
    if (!outgoing.length) break;
    const next = byId.get(outgoing[0].to_step);
    if (!next) throw new Error('Unknown connection target');
    current = next;
  }
  if (ordered.length !== ir.steps.length || ir.connections.length !== ordered.length - 1) throw new Error('Workflow must be a connected linear graph');
  if (ordered[ordered.length - 1].type !== 'Deliver') throw new Error('Workflow must end with Deliver');
  const output = ordered[ordered.length - 1].output_schema.properties ?? {};
  for (const field of objective.required_fields ?? []) {
    if (field.required && !(field.name in output)) throw new Error(`Output contract missing field: ${field.name}`);
  }
  const workflow: ExecutableWorkflow = {
    name: `Data Intelligence · ${objective.target_entity.slice(0, 70)}`,
    nodes: [{ id: 'trigger', name: 'Trigger', type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: path, position: [0, 0], parameters: { httpMethod: 'POST', path, responseMode: 'lastNode', responseData: 'allEntries', options: {} } },
      { id: 'input', name: 'Input', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: { jsCode: 'const records = $input.first().json.body.records; if (!Array.isArray(records)) throw new Error("Records required"); return records.map(json => ({json}));' } }],
    connections: { Trigger: { main: [[{ node: 'Input', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', executionTimeout: 120, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' },
  };
  for (const [i, step] of ordered.entries()) {
    const p = step.parameters as Record<string, unknown>;
    if (step.type === 'Discover') throw new Error('Discovery needs a configured search connector');
    if (step.type === 'Acquire' && (i !== 0 || p.method !== 'GET')) throw new Error('Only one read-only Acquire is supported');
    if (step.type === 'Extract' && p.content !== 'json') throw new Error('Extract supports JSON only');
    if (step.type === 'Persist' && p.destination !== 'platform') throw new Error('Persist destination must be platform');
    if (step.type === 'Transform' || step.type === 'Enrich') {
      const mapping = step.type === 'Transform' ? p.mapping : p.enrichments;
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.values(mapping).some(v => typeof v !== 'string')) throw new Error('Mappings must contain target field → source field paths; code and constants are not supported');
    }
    if (step.type === 'Filter' && (!Array.isArray(p.conditions) || p.conditions.some(c => !c || typeof c !== 'object' || !['equals','contains','greater_than','less_than','between','in'].includes(String((c as Record<string, unknown>).operator))))) throw new Error('Unsupported filter conditions');
    if (step.type === 'Resolve' && (!Array.isArray(p.keys) || !p.keys.length || p.keys.some(k => typeof k !== 'string'))) throw new Error('Resolve requires deduplication field paths');
    const name = `${step.type} ${i + 1}`;
    const previous = workflow.nodes[workflow.nodes.length - 1].name;
    workflow.connections[previous] = { main: [[{ node: name, type: 'main', index: 0 }]] };
    workflow.nodes.push({ id: step.id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [(i + 2) * 200, 0], parameters: { jsCode: `return (${transform.toString()})($input.all(), ${JSON.stringify(step.type)}, JSON.parse(${JSON.stringify(JSON.stringify(p))}));` } });
  }
  return workflow;
}
