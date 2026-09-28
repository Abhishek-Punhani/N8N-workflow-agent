/**
 * AI Data Intelligence Platform - Dashboard Module Type Definitions
 */

import {
  VerificationStage,
  ExecutionResult,
  RecordInspection,
  ExportOptions,
  NodeStatus,
  ExecutionStatus,
} from '@core/types.js';

// ============================================================================
// Dashboard Data Types
// ============================================================================

export interface DashboardView {
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

export interface DashboardState {
  data: DashboardView;
  filters: DashboardFilters;
  selected_workflow?: string;
  selected_execution?: string;
  pagination: {
    page: number;
    page_size: number;
    total: number;
  };
}

// ============================================================================
// Export Manager Types
// ============================================================================

export interface ExportRequest {
  format: 'csv' | 'json';
  record_ids?: string[];
  max_records?: number;
  include_provenance?: boolean;
}

export interface ExportResponse {
  status: 'completed' | 'pending' | 'failed';
  file_url?: string;
  file_size_mb?: number;
  record_count?: number;
  format: 'csv' | 'json';
  exported_at?: string;
  error?: string;
}

export interface ExportHistory {
  exports: ExportResponse[];
  total: number;
  pagination: {
    page: number;
    page_size: number;
  };
}

// ============================================================================
// WebSocket Types (for real-time updates)
// ============================================================================

export interface WebSocketMessage {
  type: 'status_update' | 'progress' | 'error' | 'export_ready';
  payload: any;
  timestamp: string;
}

export interface StatusUpdatePayload {
  execution_id: string;
  workflow_id: string;
  status: ExecutionStatus['status'];
  node_statuses: NodeStatus[];
}

export interface ProgressPayload {
  execution_id: string;
  current_records: number;
  total_records?: number;
  stage: string;
}

// ============================================================================
// UI Component Props (TypeScript interfaces for React/Vue components)
// ============================================================================

export interface VerificationStagesProps {
  stages: VerificationStage[];
  show_details?: boolean;
}

export interface ExecutionResultsProps {
  executions: ExecutionResult[];
  filters: DashboardFilters;
  onFilterChange: (filters: DashboardFilters) => void;
  onRowClick?: (execution: ExecutionResult) => void;
}

export interface RecordInspectionProps {
  inspection: RecordInspection;
  onExport?: (request: ExportRequest) => void;
}

export interface DegradedModeIndicatorProps {
  sources: Array<{ source_id: string; status: 'available' | 'degraded' | 'unavailable' }>;
}

// ============================================================================
// Dashboard Configuration
// ============================================================================

export interface DashboardConfig {
  api_endpoint: string;
  websocket_endpoint?: string;
  refresh_interval_ms: number;
  default_page_size: number;
  max_export_size_mb: number;
  export_formats: ('csv' | 'json')[];
  provenance_display: 'always' | 'on_request';
}
