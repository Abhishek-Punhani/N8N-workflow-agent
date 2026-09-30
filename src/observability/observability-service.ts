import { ExecutionStatus, NodeStatus } from '../core/types.js';
import { Metrics, ObservabilityConfig, WebhookPayload } from './types.js';

export class ObservabilityServiceImpl {
  private executions: Map<string, ExecutionStatus> = new Map();
  private config: ObservabilityConfig;
  private reconciliationTimer?: NodeJS.Timeout;

  constructor(config: ObservabilityConfig) {
    this.config = config;
  }

  public handleWebhook(payload: WebhookPayload): void {
    let execution = this.executions.get(payload.execution_id);
    if (!execution) {
      execution = {
        workflow_id: payload.workflow_id,
        execution_id: payload.execution_id,
        status: 'running',
        node_statuses: [],
        record_count: 0,
        started_at: payload.timestamp,
      };
      this.executions.set(payload.execution_id, execution);
    }

    const existingNodeIndex = execution.node_statuses.findIndex(
      n => n.node_name === payload.node_name
    );

    if (existingNodeIndex >= 0) {
      const existingNode = execution.node_statuses[existingNodeIndex];
      execution.node_statuses[existingNodeIndex] = {
        ...existingNode,
        status: payload.status,
        ...(payload.records_processed !== undefined && {
          records_processed: payload.records_processed,
        }),
        ...(payload.error_message !== undefined && {
          error_message: payload.error_message,
        }),
      };
    } else {
      const newNode: NodeStatus = {
        node_name: payload.node_name,
        status: payload.status,
        ...(payload.records_processed !== undefined && {
          records_processed: payload.records_processed,
        }),
        ...(payload.error_message !== undefined && {
          error_message: payload.error_message,
        }),
      };
      execution.node_statuses.push(newNode);
    }

    const totalRecords = execution.node_statuses.reduce(
      (sum, n) => sum + (n.records_processed || 0),
      0
    );
    execution.record_count = totalRecords;

    const hasFailure = execution.node_statuses.some(n => n.status === 'failed');
    const allSuccess =
      execution.node_statuses.length > 0 &&
      execution.node_statuses.every(n => n.status === 'success');

    const nowIso = new Date().toISOString();

    if (hasFailure) {
      execution.status = 'failed';
      if (!execution.completed_at) {
        execution.completed_at = payload.timestamp || nowIso;
      }
      const startTime = Date.parse(execution.started_at);
      const endTime = Date.parse(execution.completed_at);
      execution.duration_ms = Math.max(0, endTime - startTime);
    } else if (allSuccess) {
      execution.status = 'completed';
      if (!execution.completed_at) {
        execution.completed_at = payload.timestamp || nowIso;
      }
      const startTime = Date.parse(execution.started_at);
      const endTime = Date.parse(execution.completed_at);
      execution.duration_ms = Math.max(0, endTime - startTime);
    } else {
      execution.status = 'running';
    }
  }

  public getExecutionStatus(executionId: string): ExecutionStatus {
    const status = this.executions.get(executionId);
    if (!status) {
      throw new Error(`Execution with ID '${executionId}' not found.`);
    }
    return status;
  }

  public getStalledExecutions(): string[] {
    const stalledIds: string[] = [];
    const now = Date.now();

    for (const [executionId, execution] of this.executions.entries()) {
      if (execution.status === 'running') {
        const startTime = Date.parse(execution.started_at);
        if (!isNaN(startTime) && now - startTime > this.config.stalled_workflow_threshold_ms) {
          execution.status = 'stalled';
          stalledIds.push(executionId);
        }
      }
    }

    return stalledIds;
  }

  public startReconciliation(): void {
    if (this.reconciliationTimer) {
      return;
    }
    this.reconciliationTimer = setInterval(() => {
      this.getStalledExecutions();
    }, this.config.reconciliation_poll_interval_ms);
  }

  public stopReconciliation(): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = undefined;
    }
  }

  public exportMetrics(): Metrics {
    let completed = 0;
    let failed = 0;
    let stalled = 0;
    let running = 0;
    let totalDuration = 0;
    let completedWithDurationCount = 0;

    for (const execution of this.executions.values()) {
      switch (execution.status) {
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'stalled':
          stalled++;
          break;
        case 'running':
          running++;
          break;
      }

      if (execution.duration_ms !== undefined) {
        totalDuration += execution.duration_ms;
        completedWithDurationCount++;
      }
    }

    const avgDuration =
      completedWithDurationCount > 0 ? totalDuration / completedWithDurationCount : 0;

    return {
      total_workflows_deployed: 0, // Placeholder, usually from another source
      successful_executions: completed,
      failed_executions: failed,
      average_execution_duration_ms: avgDuration,
      p95_execution_duration_ms: avgDuration, // simplified for now
      workflows_by_status: {
        completed,
        failed,
        stalled,
        running,
      },
      errors_by_type: {},
      last_updated: new Date().toISOString(),
    };
  }

  public listExecutions(): string[] {
    return Array.from(this.executions.keys());
  }
}
