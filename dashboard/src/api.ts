import type { DashboardView, ExecutionResult, RecordInspection } from './types';
export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(response.status, error.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
export const fetchDashboardData = () => request<DashboardView>('/dashboard');
export const fetchExecutionDetails = (id: string) => request<ExecutionResult>(`/executions/${encodeURIComponent(id)}`);
export const signIn = (token: string) => request('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
export const signOut = () => request('/session', { method: 'DELETE' });
export const submitPrompt = (prompt: string) => request<ExecutionResult>('/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
export const fetchRecords = (id: string, offset = 0) => request<RecordInspection>(`/executions/${encodeURIComponent(id)}/records?limit=25&offset=${offset}`);
export const triggerExport = (id: string, format: 'csv' | 'json') => request<{ download_url: string }>(`/executions/${encodeURIComponent(id)}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) });
