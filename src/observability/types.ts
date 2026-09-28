/**
 * AI Data Intelligence Platform - Observability Module Type Definitions
 */

import { ExecutionStatus, NodeStatus } from '@core/types.js';

// ============================================================================
// Observability Service Types
// ============================================================================

export interface ObservabilityConfig {
  webhook_endpoint: string;
  reconciliation_poll_interval_ms: number;
  stalled_workflow_threshold_ms: number;
  metrics_export_endpoint?: string;
}

export interface WebhookPayload {
  workflow_id: string;
  execution_id: string;
  node_name: string;
  status: NodeStatus['status'];
  records_processed?: number;
  error_message?: string;
  timestamp: string;
}

export interface ObservabilityService {
  startWebhookServer(port: number): Promise<void>;
  handleWebhook(payload: WebhookPayload): Promise<void>;
  pollExecution(executionId: string): Promise<ExecutionStatus>;
  getExecutionStatus(executionId: string): Promise<ExecutionStatus>;
  getStalledWorkflows(): Promise<string[]>;
  exportMetrics(): Promise<Metrics>;
}

// ============================================================================
// Status API Types
// ============================================================================

export interface StatusApiResponse {
  workflow_id: string;
  execution_id: string;
  status: ExecutionStatus['status'];
  record_count?: number;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  verification_status: string;
  source_urls?: string[];
}

export interface ExecutionHistoryQuery {
  workflow_id?: string;
  status?: ExecutionStatus['status'];
  start_time?: string;
  end_time?: string;
  limit?: number;
  offset?: number;
}

export interface ExecutionHistoryResponse {
  executions: ExecutionStatus[];
  total: number;
  page: number;
  page_size: number;
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface Metrics {
  total_workflows_deployed: number;
  successful_executions: number;
  failed_executions: number;
  average_execution_duration_ms: number;
  p95_execution_duration_ms: number;
  workflows_by_status: Record<string, number>;
  errors_by_type: Record<string, number>;
  last_updated: string;
}

export interface MetricsQuery {
  time_range?: string; // e.g., "1h", "24h", "7d"
  granularity?: string; // e.g., "minute", "hour", "day"
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface WebhookConfig {
  endpoint: string;
  secret?: string;
  timeout_ms: number;
  retry_config: {
    max_attempts: number;
    delay_ms: number;
  };
}

export interface WebhookSubscription {
  webhook_id: string;
  workflow_id: string;
  events: string[];
  config: WebhookConfig;
  created_at: string;
  active: boolean;
}
