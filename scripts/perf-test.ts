import { StructuralCheck } from '../src/verify/structural-check.js';
import { Compiler } from '../src/verify/compiler.js';
import type { IR } from '../src/core/types.js';

const mockIR: IR = {
  steps: [
    {
      id: 'step_discover',
      type: 'Discover',
      description: 'Find target data',
      parameters: { query: 'test', source_type: 'web', target_entity: 'company' },
      dependencies: [],
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: { url: { type: 'string' } } },
    }
  ],
  connections: [],
  field_mappings: [],
  metadata: {
    objective_hash: 'abc',
    created_at: new Date().toISOString(),
    planner_version: '1.0'
  }
};

async function runPerfTest() {
  console.log('--- Performance Testing (Validation Pipeline Latency & Throughput) ---');
  const ITERATIONS = 10000;
  
  const structuralCheck = new StructuralCheck();
  const compiler = new Compiler();

  const scResult = structuralCheck.validate(mockIR);
  if (scResult.status !== 'valid') throw new Error('SC failed');

  const start = performance.now();

  for (let i = 0; i < ITERATIONS; i++) {
    const scRun = structuralCheck.validate(mockIR);
    const compRun = await compiler.compile(scRun.verified_ir!);
  }

  const end = performance.now();
  const totalMs = end - start;
  const avgMs = totalMs / ITERATIONS;
  const throughput = ITERATIONS / (totalMs / 1000);

  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Total Time: ${totalMs.toFixed(2)} ms`);
  console.log(`Average Latency per pipeline run: ${avgMs.toFixed(3)} ms`);
  console.log(`Throughput: ${throughput.toFixed(2)} validations / sec`);
}

runPerfTest().catch(console.error);
