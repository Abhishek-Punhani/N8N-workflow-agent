import { randomUUID, createHash } from 'node:crypto';
import { IntakeAgent } from '../plan/intake-agent.js';
import { RepairAgent, type PatchAttempt } from '../plan/repair-agent.js';
import { FailureClassification } from '../core/errors.js';
import { DataContractValidator } from '../verify/data-contract-validator.js';
import { createLLMClient } from '../plan/llm-registry.js';
import { StructuralCheck } from '../verify/structural-check.js';
import type { AppConfig } from '../config/env.js';
import type { JSONSchema, JSONSchemaType, StructuredObjective } from '../core/types.js';
import { Store, type Job } from './store.js';
import { compileExecutable } from './compiler.js';
import { N8nRuntime } from './n8n.js';
import { collectData, type CollectionCheckpoint } from './collection.js';
import type { IR } from '../core/types.js';
import { isCompleteAddress } from './quality.js';

export const RUNTIME_RULES = `\nEXECUTION CONTRACT: This deployment supports read-only, linear collection from records already acquired by the platform.
Discovery, acquisition and evidence extraction have already executed in the collection worker, recorded in the collection report. This graph processes its verified records.
Start with exactly one Acquire {urls:[observed primary source URL],method:"GET"}. End with Deliver {records:[],format:"json"}.
Do not invent URLs. Extract content must be "json" and schema is a field-type map. Input is already parsed normalized records.
Transform mapping and Enrich enrichments are objects of target field to source dot-path STRINGS only (no expressions, code, constants or templates).
Filter conditions are {field,operator,value}, operators equals/contains/greater_than/less_than/between/in. Count limits belong in output_requirements, never a count Filter.
Resolve keys are field names. Validate rules are {field,type,required} using JS types. Persist destination must be "platform".
Provenance and persistence are enforced by the platform. Do not repeat discovery inside this dataset-processing graph.
Schemas describe INDIVIDUAL RECORD fields, not record array wrappers. Include all requested fields in final Deliver output_schema.
Parameters records:[] means consume upstream data. All connections use main. Provide field_mappings for upstream fields.
For a JSON array with already matching fields, Acquire → Deliver is sufficient. Do not add Extract/Transform/Validate unless a real operation requires it.
Only use steps required for the user's request. Do not fabricate record content.\n`;

function simplePassThroughIr(
  source: string,
  objective: StructuredObjective,
  sample: Record<string, unknown>
): IR | null {
  const fields = objective.required_fields ?? [];
  if (
    !fields.length ||
    fields.some(field => field.required && field.name !== 'source_url' && !(field.name in sample))
  )
    return null;
  const jsonType = (type: string): JSONSchemaType =>
    type === 'number'
      ? 'number'
      : type === 'array'
        ? 'array'
        : type === 'object'
          ? 'object'
          : 'string';
  const properties: Record<string, JSONSchema> = Object.fromEntries(
    fields.map(field => [field.name, { type: jsonType(field.type) }])
  );
  const schema: JSONSchema = { type: 'object', properties };
  return {
    metadata: {
      objective_hash: createHash('sha256').update(JSON.stringify(objective)).digest('hex'),
      created_at: new Date().toISOString(),
      planner_version: 'runtime-1',
    },
    steps: [
      {
        id: 'step-acquire-1',
        type: 'Acquire',
        parameters: { urls: [source], method: 'GET' },
        input_schema: { type: 'object', properties: {} },
        output_schema: schema,
      },
      {
        id: 'step-deliver-1',
        type: 'Deliver',
        parameters: { records: [], format: 'json' },
        input_schema: schema,
        output_schema: schema,
      },
    ],
    connections: [
      {
        from_step: 'step-acquire-1',
        from_output: 'main',
        to_step: 'step-deliver-1',
        to_input: 'main',
      },
    ],
    field_mappings: fields.map(field => ({
      source_step: 'step-acquire-1',
      source_field: field.name,
      target_field: field.name,
    })),
  };
}

export function validateRecords(
  records: Record<string, unknown>[],
  objective: StructuredObjective,
  source: string
): Record<string, unknown>[] {
  const fields = objective.required_fields ?? [];
  const unique = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const recordSource =
      typeof record.source_url === 'string' && /^https?:\/\//.test(record.source_url)
        ? record.source_url
        : source;
    for (const constraint of objective.constraints ?? []) {
      const actual = record[constraint.field];
      const expected: unknown = constraint.value;
      let matches = false;
      switch (constraint.operator) {
        case 'equals':
          matches = actual === expected;
          break;
        case 'contains':
          matches =
            typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
          break;
        case 'greater_than':
          matches = typeof actual === 'number' && typeof expected === 'number' && actual > expected;
          break;
        case 'less_than':
          matches = typeof actual === 'number' && typeof expected === 'number' && actual < expected;
          break;
        case 'in':
          matches = Array.isArray(expected) && expected.includes(actual);
          break;
        case 'between':
          matches =
            typeof actual === 'number' &&
            Array.isArray(expected) &&
            actual >= Number(expected[0]) &&
            actual <= Number(expected[1]);
          break;
      }
      if (!matches)
        throw new Error(
          `Output violates requested constraint: ${constraint.field} ${constraint.operator}`
        );
    }
    const output: Record<string, unknown> = {};
    for (const f of fields) {
      const value = f.name === 'source_url' ? recordSource : record[f.name];
      if (value === undefined || value === null) {
        if (f.required) throw new Error(`Output missing required field: ${f.name}`);
        else continue;
      }
      const valid =
        f.type === 'array'
          ? Array.isArray(value)
          : f.type === 'object'
            ? typeof value === 'object' && !Array.isArray(value)
            : f.type === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : typeof value === 'string';
      if (!valid) throw new Error(`Output type mismatch: ${f.name}`);
      if (
        /(^|_)(street_address|business_address|address)$/.test(f.name) &&
        f.type === 'string' &&
        !isCompleteAddress(value)
      )
        throw new Error(`Incomplete business address: ${f.name}`);
      if (f.type === 'url') {
        try {
          const url = new URL(String(value));
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error();
        } catch {
          throw new Error(`Invalid URL field: ${f.name}`);
        }
      }
      if (f.type === 'date' && !Number.isFinite(Date.parse(String(value))))
        throw new Error(`Invalid date field: ${f.name}`);
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))
        throw new Error(`Invalid email field: ${f.name}`);
      if (/phone|telephone|contact_number/i.test(f.name)) {
        const phone = String(value);
        const digits = phone.replace(/\D/g, '');
        if (!/^[+\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15)
          throw new Error(`Invalid business phone: ${f.name}`);
      }
      output[f.name] = value;
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)))
        )
      )
      .digest('hex');
    output._provenance = {
      source_url: recordSource,
      extraction_confidence: null,
      confidence_method: 'not_calibrated',
      field_evidence: record._collection_evidence ?? {},
      qualification_evidence: record._qualification_evidence ?? [],
      dedupe_group: fingerprint,
      validation_status: 'valid',
      evidence_review: record._evidence_review ?? null,
    };
    unique.set(fingerprint, output);
  }
  const result = [...unique.values()];
  const limit = objective.output_requirements?.max_records;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error('Invalid requested record limit');
  return limit ? result.slice(0, limit) : result;
}

export async function runJob(store: Store, job: Job, config: AppConfig): Promise<void> {
  const llm = createLLMClient(config);
  const n8n = new N8nRuntime(config.n8n.baseUrl, config.n8n.apiKey, config.timeouts.n8nRequestMs);
  let stage = '';
  const progress = async (name: string, action: () => Promise<void> | void) => {
    stage = name;
    const entry = job.verification_stages.find(s => s.stage_name === name)!;
    entry.status = 'running';
    entry.timestamp = new Date().toISOString();
    await store.save(job);
    await action();
    entry.status = 'success';
    entry.timestamp = new Date().toISOString();
    await store.save(job);
  };
  try {
    let objective!: StructuredObjective;
    await progress('Intake', async () => {
      if (
        job.artifacts?.collection_version === 2 &&
        job.artifacts?.objective &&
        job.artifacts?.collection_checkpoint
      ) {
        objective = job.artifacts.objective as StructuredObjective;
        return;
      }
      const result = await new IntakeAgent({
        llmClient: llm,
        timeoutMs: config.timeouts.llmRequestMs,
      }).parse(job.prompt);
      if (result.clarification_needed)
        throw new Error(`Clarification needed: ${result.clarification_needed.questions.join(' ')}`);
      objective = result.structured_objective;
      if (!objective.required_fields?.length) throw new Error('Specify the fields to collect');
      job.artifacts = {
        objective,
        assumptions: result.assumptions,
        model: config.llm.model,
        collection_version: 2,
      };
    });
    let source = '';
    if (objective.constraints?.length) {
      objective.constraints = objective.constraints.filter(
        c => c.field !== 'source_url' && c.field !== '_provenance.source_url'
      );
      job.artifacts = { ...job.artifacts, objective };
    }
    let ir!: IR;
    let input: Record<string, unknown>[] = [];
    await progress('Plan', async () => {
      const acquired = await collectData(job.prompt, objective, llm, {
        maxPages: Number(process.env.LIMIT_WEB_PAGES || '30'),
        maxRecords: Math.min(
          config.limits.maxRecords,
          Number(process.env.LIMIT_COLLECTION_RECORDS || '500')
        ),
        maxModelCalls: Number(process.env.LIMIT_COLLECTION_MODEL_CALLS || '40'),
        maxRefineRounds: Number(process.env.LIMIT_COLLECTION_REFINE_ROUNDS || '1'),
        timeoutMs: Number(process.env.TIMEOUT_COLLECTION_MS || '300000'),
        llmTimeoutMs: config.timeouts.llmRequestMs,
        browser: process.env.COLLECTION_BROWSER_ENABLED !== 'false',
        checkpoint: job.artifacts?.collection_checkpoint as CollectionCheckpoint | undefined,
        accept: (record, recordSource) => {
          try {
            return validateRecords([record], objective, recordSource).length === 1;
          } catch {
            return false;
          }
        },
        onProgress: async (report, checkpoint) => {
          job.collection = report;
          job.artifacts = { ...job.artifacts, collection_checkpoint: checkpoint };
          const plan = job.verification_stages.find(stage => stage.stage_name === 'Plan')!;
          plan.message = `${report.phase}: ${report.pages_visited} pages, ${report.accepted_records} accepted records`;
          await store.save(job);
        },
      });
      input = acquired.records;
      source = acquired.source;
      if (!input.length) throw new Error('Source returned no records');
      if (input.length > config.limits.maxRecords)
        throw new Error('Source exceeds configured record limit');
      const deterministic = simplePassThroughIr(source, objective, input[0]);
      if (deterministic) ir = deterministic;
      else throw new Error('Collected records do not satisfy the output schema');
      job.artifacts = {
        ...job.artifacts,
        ir,
        source,
        acquisition_mode: 'general_collection',
        discovered_urls: acquired.report.sources.map(entry => entry.url),
        acquired_records: input.length,
      };
    });
    await progress('Structure', async () => {
      const patches: PatchAttempt[] = [];
      for (let attempt = 0; attempt <= 3; attempt++) {
        const result = new StructuralCheck().validate(ir);
        const contracts = new DataContractValidator().validate(ir);
        const error = result.errors?.[0];
        const contractError = contracts.errors[0];
        if (!error && !contractError) break;
        const message = error?.message ?? contractError.message;
        if (attempt === 3) throw new Error('Plan invalid after three targeted repairs: ' + message);
        const stepId = error?.step_id ?? contractError.to_step;
        const repair = await new RepairAgent({
          llmClient: {
            complete: (system, user, signal) => llm.complete(system + RUNTIME_RULES, user, signal),
          },
          timeoutMs: config.timeouts.llmRequestMs,
        }).repair({
          original_ir: ir,
          attempt_number: attempt + 1,
          previous_patches: patches,
          failure_trace: {
            step_id: stepId,
            error_message: message,
            classification: FailureClassification.LOGIC_FAILURE,
            retry_count: attempt,
            timestamp: new Date().toISOString(),
          },
        });
        if (!repair.patched_ir) throw new Error('Repair escalated: ' + message);
        patches.push({
          attempt_number: attempt + 1,
          patch_description: repair.patch_description ?? message,
          result: 'still_failing',
        });
        ir = repair.patched_ir;
        job.artifacts = { ...job.artifacts, ir, repairs: patches };
        await store.save(job);
      }
      const acquire = ir.steps.find(s => s.type === 'Acquire');
      if (JSON.stringify(acquire?.parameters.urls) !== JSON.stringify([source]))
        throw new Error('Plan changed the source URL');
    });
    let workflow!: ReturnType<typeof compileExecutable>;
    const path = randomUUID();
    await progress('Compile', () => {
      workflow = compileExecutable(ir, objective, path);
      job.artifacts = { ...job.artifacts, workflow };
    });
    await progress('Contract', () => {
      const supported = ['equals', 'contains', 'greater_than', 'less_than', 'between', 'in'];
      if (objective.constraints?.some(c => !supported.includes(c.operator)))
        throw new Error('Unsupported objective constraint');
      if ((objective.output_requirements?.max_records ?? 0) > config.limits.maxRecords)
        throw new Error('Requested count exceeds platform limit');
    });
    await progress('Sandbox', async () => {
      const id = await n8n.create(workflow);
      try {
        const output = await n8n.execute(id, path, input.slice(0, 5));
        validateRecords(output, objective, source);
      } finally {
        await n8n.remove(id);
      }
    });
    let output: Record<string, unknown>[] = [];
    await progress('Run', async () => {
      // A different webhook per deployment prevents stale trigger collisions.
      const productionPath = randomUUID();
      workflow = compileExecutable(ir, objective, productionPath);
      const id = await n8n.create(workflow);
      job.workflow_id = id;
      await store.save(job);
      try {
        output = await n8n.execute(id, productionPath, input);
      } finally {
        await n8n.deactivate(id);
      }
      output = validateRecords(output, objective, source);
      if (!output.length) throw new Error('Workflow returned no matching records');
    });
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    job.duration_ms = Date.now() - Date.parse(job.started_at);
    job.records_processed = output.length;
    await store.complete(job, output);
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : 'Execution failed';
    job.completed_at = new Date().toISOString();
    job.duration_ms = Date.now() - Date.parse(job.started_at);
    const entry = job.verification_stages.find(s => s.stage_name === stage);
    if (entry) {
      entry.status = 'failed';
      entry.message = job.error;
    }
    await store.save(job);
  }
}
