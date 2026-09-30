import type { DashboardView } from './types';

const MOCK_DATA: DashboardView = {
  verification_stages: [
    { stage_name: 'Structural Check', status: 'success', timestamp: new Date().toISOString() },
    { stage_name: 'Compiler Check', status: 'success', timestamp: new Date().toISOString() },
    { stage_name: 'Contract Check', status: 'success', timestamp: new Date().toISOString() },
    { stage_name: 'Sandbox Validation', status: 'success', timestamp: new Date().toISOString() },
  ],
  execution_results: [
    {
      execution_id: 'exec-123',
      workflow_id: 'wf-abc',
      status: 'completed',
      records_processed: 1250,
      started_at: new Date(Date.now() - 60000).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 60000,
      verification_stages: [
        { stage_name: 'Sandbox', status: 'success' }
      ]
    },
    {
      execution_id: 'exec-124',
      workflow_id: 'wf-xyz',
      status: 'failed',
      records_processed: 45,
      started_at: new Date(Date.now() - 120000).toISOString(),
      completed_at: new Date(Date.now() - 110000).toISOString(),
      duration_ms: 10000,
      error: 'Timeout waiting for data source.',
      verification_stages: [
        { stage_name: 'Sandbox', status: 'success' }
      ]
    },
    {
      execution_id: 'exec-125',
      workflow_id: 'wf-def',
      status: 'running',
      records_processed: 890,
      started_at: new Date(Date.now() - 30000).toISOString(),
      verification_stages: [
        { stage_name: 'Sandbox', status: 'success' }
      ]
    }
  ],
  record_inspection: {
    execution_id: 'exec-123',
    total_records: 1250,
    records: [
      { id: 1, name: 'Alice', email: 'alice@example.com', _provenance: { source_url: 'https://api.example.com/users', extraction_confidence: 0.95 } },
      { id: 2, name: 'Bob', email: 'bob@example.com', _provenance: { source_url: 'https://api.example.com/users', extraction_confidence: 0.99 } },
    ]
  },
  export_options: {
    available_formats: ['csv', 'json'],
    max_records: 1000000,
    max_size_mb: 500,
  },
  degraded_sources: [
    { source_id: 'salesforce-crm', status: 'degraded' },
    { source_id: 'zendesk-api', status: 'available' }
  ]
};

export const fetchDashboardData = async (): Promise<DashboardView> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(MOCK_DATA);
    }, 500);
  });
};
