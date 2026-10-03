export interface VerificationStage {
  stage_name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
  timestamp?: string;
}

export interface NodeStatus {
  node_name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  records_processed?: number;
  error_message?: string;
}

export interface ExecutionStatus {
  workflow_id: string | null;
  execution_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stalled';
  node_statuses: NodeStatus[];
  record_count?: number;
  duration_ms?: number;
  started_at: string;
  completed_at?: string;
}

export interface ExecutionResult {
  collection?: {
    phase: string;
    pages_visited: number;
    accepted_records: number;
    requested_records?: number;
    coverage: string;
    stop_reason?: string;
    sources: Array<{ url: string; state: string; records: number; message?: string }>;
    warnings: string[];
    queries?: string[];
    model_calls?: number;
    activity?: { at: string; kind: string; message: string; url?: string };
    events?: Array<{ at: string; kind: string; message: string; url?: string }>;
    budgets?: { pages: number; model_calls: number; seconds: number };
    elapsed_ms?: number;
    started_at?: string;
    queued_sources?: number;
    candidate_records?: number;
    candidate_issues?: Array<{ entity: string; issues: string[] }>;
    requirements?: string[];
  };
  prompt?: string;
  execution_id: string;
  workflow_id: string | null;
  objective_id?: string;
  status: ExecutionStatus['status'];
  records_processed: number;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;
  verification_stages: VerificationStage[];
}

export interface RecordInspection {
  execution_id: string;
  total_records: number;
  records: Record<string, unknown>[];
}

export interface ExportOptions {
  available_formats: ('csv' | 'json')[];
  max_records: number;
  max_size_mb: number;
}

export interface DashboardView {
  model?: string;
  verification_stages: VerificationStage[];
  execution_results: ExecutionResult[];
  record_inspection?: RecordInspection;
  export_options: ExportOptions;
  degraded_sources?: Array<{ source_id: string; status: 'available' | 'degraded' | 'unavailable' }>;
}

export interface DashboardFilters {
  status?: string;
  date_range?: {
    start: string;
    end: string;
  };
  search?: string;
  source_type?: string;
}
