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
