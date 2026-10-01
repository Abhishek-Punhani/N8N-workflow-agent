import { setTimeout as delay } from 'node:timers/promises';
export interface ExecutableWorkflow {
  name: string;
  nodes: Array<{ id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, unknown>; webhookId?: string }>;
  connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }>;
  settings: Record<string, unknown>;
}

export class N8nRuntime {
  constructor(private baseUrl: string, private key: string, private timeout: number) {}
  async api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    let response!: Response;
    for (let attempt = 0; attempt < 6; attempt++) {
    response = await fetch(`${this.baseUrl}/api/v1${path}`, { method, headers: { 'X-N8N-API-KEY': this.key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.timeout) });
    if (!(method === 'DELETE' && response.status === 409) || attempt === 5) break;
    await response.body?.cancel();
    await delay(250 * 2 ** attempt);
    }
    if (!response.ok) throw new Error(`n8n ${method} ${path} failed (HTTP ${response.status})`);
    if (response.status === 204) return {};
    return await response.json() as Record<string, unknown>;
  }
  async create(workflow: ExecutableWorkflow): Promise<string> {
    const result = await this.api('POST', '/workflows', workflow);
    if (typeof result.id !== 'string') throw new Error('n8n returned no workflow ID');
    return result.id;
  }
  async execute(id: string, path: string, records: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    await this.api('POST', `/workflows/${id}/activate`);
    let response!: Response;
    for (let attempt = 0; attempt < 6; attempt++) {
    response = await fetch(`${this.baseUrl}/webhook/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }), signal: AbortSignal.timeout(this.timeout) });
    // Activation returns before webhook registration completes in n8n 2.x.
    // Only retry a 404: no workflow was invoked. Never replay a timed-out execution.
    if (response.status !== 404 || attempt === 5) break;
    await response.body?.cancel();
    await delay(250 * 2 ** attempt);
    }
    if (!response.ok) throw new Error(`n8n workflow execution failed (HTTP ${response.status})`);
    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw new Error('n8n did not return a record array');
    return data as Record<string, unknown>[];
  }
  async remove(id: string): Promise<void> {
    await this.deactivate(id);
    await this.api('DELETE', `/workflows/${id}`);
  }
  async deactivate(id: string): Promise<void> { await this.api('POST', `/workflows/${id}/deactivate`); }
}
