import { jest } from '@jest/globals';
import { ObservabilityServiceImpl } from './observability-service.js';
import type { ObservabilityConfig, WebhookPayload } from './types.js';

describe('ObservabilityServiceImpl Integration Tests', () => {
  let service: ObservabilityServiceImpl;
  const config: ObservabilityConfig = {
    webhook_endpoint: 'http://localhost:3000/webhook',
    reconciliation_poll_interval_ms: 1000,
    stalled_workflow_threshold_ms: 5000,
  };

  beforeEach(() => {
    service = new ObservabilityServiceImpl(config);
  });

  afterEach(() => {
    service.stopReconciliation();
    jest.useRealTimers();
  });

  test('1. handleWebhook processes a single node completion and creates ExecutionStatus', () => {
    const payload: WebhookPayload = {
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'running',
      records_processed: 10,
      timestamp: new Date().toISOString(),
    };

    service.handleWebhook(payload);
    const status = service.getExecutionStatus('exec-1');

    expect(status.workflow_id).toBe('wf-1');
    expect(status.execution_id).toBe('exec-1');
    expect(status.status).toBe('running');
    expect(status.node_statuses).toHaveLength(1);
    expect(status.node_statuses[0]).toEqual({
      node_name: 'Node1',
      status: 'running',
      records_processed: 10,
    });
  });

  test('2. handleWebhook accumulates node_statuses across multiple webhook calls', () => {
    const ts = new Date().toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'success',
      records_processed: 10,
      timestamp: ts,
    });

    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node2',
      status: 'running',
      records_processed: 5,
      timestamp: ts,
    });

    const status = service.getExecutionStatus('exec-1');
    expect(status.node_statuses).toHaveLength(2);
    expect(status.node_statuses[0].node_name).toBe('Node1');
    expect(status.node_statuses[1].node_name).toBe('Node2');
  });

  test('3. handleWebhook transitions status to completed when all nodes succeed', () => {
    const ts = new Date().toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'success',
      records_processed: 10,
      timestamp: ts,
    });

    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node2',
      status: 'success',
      records_processed: 20,
      timestamp: ts,
    });

    const status = service.getExecutionStatus('exec-1');
    expect(status.status).toBe('completed');
    expect(status.completed_at).toBeDefined();
    expect(status.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('4. handleWebhook transitions status to failed when any node fails', () => {
    const ts = new Date().toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'success',
      records_processed: 10,
      timestamp: ts,
    });

    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node2',
      status: 'failed',
      error_message: 'Connection timed out',
      timestamp: ts,
    });

    const status = service.getExecutionStatus('exec-1');
    expect(status.status).toBe('failed');
    expect(status.node_statuses[1].error_message).toBe('Connection timed out');
    expect(status.completed_at).toBeDefined();
  });

  test('5. handleWebhook updates record_count by summing records_processed from all nodes', () => {
    const ts = new Date().toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'running',
      records_processed: 15,
      timestamp: ts,
    });

    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node2',
      status: 'running',
      records_processed: 25,
      timestamp: ts,
    });

    const status = service.getExecutionStatus('exec-1');
    expect(status.record_count).toBe(40);
  });

  test('6. getExecutionStatus returns correct status after webhooks', () => {
    const ts = new Date().toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'running',
      timestamp: ts,
    });

    const status = service.getExecutionStatus('exec-1');
    expect(status.workflow_id).toBe('wf-1');
    expect(status.execution_id).toBe('exec-1');
  });

  test('7. getExecutionStatus throws when execution not found', () => {
    expect(() => service.getExecutionStatus('non-existent')).toThrow(
      "Execution with ID 'non-existent' not found."
    );
  });

  test('8. getStalledExecutions returns IDs of running executions exceeding threshold', () => {
    const oldTimestamp = new Date(Date.now() - 10000).toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-stalled',
      node_name: 'Node1',
      status: 'running',
      timestamp: oldTimestamp,
    });

    const freshTimestamp = new Date().toISOString();
    service.handleWebhook({
      workflow_id: 'wf-2',
      execution_id: 'exec-fresh',
      node_name: 'Node1',
      status: 'running',
      timestamp: freshTimestamp,
    });

    const stalled = service.getStalledExecutions();
    expect(stalled).toEqual(['exec-stalled']);
    expect(service.getExecutionStatus('exec-stalled').status).toBe('stalled');
    expect(service.getExecutionStatus('exec-fresh').status).toBe('running');
  });

  test('9. getStalledExecutions does not return completed/failed executions', () => {
    const oldTimestamp = new Date(Date.now() - 10000).toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-completed',
      node_name: 'Node1',
      status: 'success',
      timestamp: oldTimestamp,
    });

    const stalled = service.getStalledExecutions();
    expect(stalled).toEqual([]);
  });

  test('10. exportMetrics returns correct counts', () => {
    const ts = new Date().toISOString();

    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'success',
      records_processed: 10,
      timestamp: ts,
    });

    service.handleWebhook({
      workflow_id: 'wf-2',
      execution_id: 'exec-2',
      node_name: 'Node1',
      status: 'failed',
      records_processed: 5,
      timestamp: ts,
    });

    service.handleWebhook({
      workflow_id: 'wf-3',
      execution_id: 'exec-3',
      node_name: 'Node1',
      status: 'running',
      records_processed: 15,
      timestamp: ts,
    });

    const metrics = service.exportMetrics();
    expect(metrics.successful_executions).toBe(1);
    expect(metrics.failed_executions).toBe(1);
    expect(metrics.workflows_by_status.running).toBe(1);
    expect(metrics.workflows_by_status.stalled).toBe(0);
  });

  test('11. startReconciliation/stopReconciliation - reconciliation marks stalled workflows', () => {
    jest.useFakeTimers();

    const oldTimestamp = new Date(Date.now() - 10000).toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'running',
      timestamp: oldTimestamp,
    });

    service.startReconciliation();

    jest.advanceTimersByTime(1500);

    const status = service.getExecutionStatus('exec-1');
    expect(status.status).toBe('stalled');

    service.stopReconciliation();
  });

  test('12. listExecutions returns all tracked execution IDs', () => {
    const ts = new Date().toISOString();
    service.handleWebhook({
      workflow_id: 'wf-1',
      execution_id: 'exec-1',
      node_name: 'Node1',
      status: 'running',
      timestamp: ts,
    });
    service.handleWebhook({
      workflow_id: 'wf-2',
      execution_id: 'exec-2',
      node_name: 'Node1',
      status: 'running',
      timestamp: ts,
    });

    const executions = service.listExecutions();
    expect(executions).toEqual(['exec-1', 'exec-2']);
  });
});
