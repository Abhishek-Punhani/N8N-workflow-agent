import { StructuralCheck } from '../src/verify/structural-check.js';
import { Compiler } from '../src/verify/compiler.js';
import type { IR } from '../src/core/types.js';

const mockIR: IR = {
  steps: [
    {
      id: 'step-1',
      capability_type: 'Discover',
      description: 'Find target data',
      parameters: { query: 'test' },
      dependencies: []
    },
    {
      id: 'step-2',
      capability_type: 'Extract',
      description: 'Extract data',
      parameters: { format: 'json' },
      dependencies: ['step-1']
    }
  ],
  connections: [
    { from_step: 'step-1', to_step: 'step-2', condition: null }
  ],
  field_mappings: [],
  metadata: {
    objective_hash: 'abc',
    created_at: new Date().toISOString(),
    planner_version: '1.0'
  }
};
console.log(JSON.stringify(new StructuralCheck().validate(mockIR), null, 2));
