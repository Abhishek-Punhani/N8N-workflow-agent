import type { DashboardView } from './types';

/**
 * Base URL for the backend API.
 * In production, the Vite proxy rewrites /api/* → http://platform:3000/*
 * In development, set VITE_API_BASE_URL in dashboard/.env to override.
 */
const API_BASE = '/api';

/**
 * Fetch the full dashboard state from the backend Status API.
 * Throws on non-2xx responses.
 */
export const fetchDashboardData = async (): Promise<DashboardView> => {
  const response = await fetch(`${API_BASE}/dashboard`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch dashboard data: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<DashboardView>;
};

/**
 * Fetch execution details for a specific workflow.
 */
export const fetchExecutionDetails = async (executionId: string): Promise<DashboardView['execution_results'][0]> => {
  const response = await fetch(`${API_BASE}/executions/${executionId}`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch execution ${executionId}: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
};

/**
 * Trigger a data export job.
 */
export const triggerExport = async (
  executionId: string,
  format: 'csv' | 'json'
): Promise<{ download_url: string; expires_at: string }> => {
  const response = await fetch(`${API_BASE}/executions/${executionId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format }),
  });

  if (!response.ok) {
    throw new Error(
      `Export failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
};
