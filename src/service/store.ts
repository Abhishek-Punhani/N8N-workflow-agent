import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export interface Stage {
  stage_name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
  timestamp?: string;
}
export interface Job {
  execution_id: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  workflow_id: string | null;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  records_processed: number;
  verification_stages: Stage[];
  error?: string;
  artifacts?: Record<string, unknown>;
  collection?: import('./collection.js').CollectionReport;
}
export const STAGES = ['Intake', 'Plan', 'Structure', 'Compile', 'Contract', 'Sandbox', 'Run'];

export class Store {
  readonly pool: Pool;
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 6,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    this.pool.on('error', () => process.stderr.write('Database connection error\n'));
  }
  async init(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS platform_jobs (
      id uuid PRIMARY KEY, payload jsonb NOT NULL, status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), heartbeat timestamptz NOT NULL DEFAULT now()
    ); CREATE INDEX IF NOT EXISTS platform_jobs_status ON platform_jobs(status, created_at);
    CREATE TABLE IF NOT EXISTS platform_records (
      job_id uuid REFERENCES platform_jobs(id) ON DELETE CASCADE, ordinal integer NOT NULL, data jsonb NOT NULL,
      PRIMARY KEY(job_id, ordinal)
    )`);
  }
  async create(prompt: string, artifacts?: Record<string, unknown>): Promise<Job> {
    const job: Job = {
      execution_id: randomUUID(),
      prompt,
      status: 'pending',
      workflow_id: null,
      started_at: new Date().toISOString(),
      records_processed: 0,
      verification_stages: STAGES.map(stage_name => ({ stage_name, status: 'pending' })),
      ...(artifacts ? { artifacts } : {}),
    };
    await this.pool.query('INSERT INTO platform_jobs(id,payload,status) VALUES($1,$2,$3)', [
      job.execution_id,
      JSON.stringify(job),
      job.status,
    ]);
    return job;
  }
  async save(job: Job): Promise<void> {
    await this.pool.query(
      'UPDATE platform_jobs SET payload=$2,status=$3,heartbeat=now() WHERE id=$1',
      [job.execution_id, JSON.stringify(job), job.status]
    );
  }
  async get(id: string): Promise<Job | undefined> {
    const result = await this.pool.query<{ payload: Job }>(
      'SELECT payload FROM platform_jobs WHERE id=$1',
      [id]
    );
    return result.rows[0]?.payload;
  }
  async list(): Promise<Job[]> {
    const result = await this.pool.query<{ payload: Job }>(
      "SELECT payload - 'artifacts' AS payload FROM platform_jobs ORDER BY created_at DESC LIMIT 100"
    );
    return result.rows.map(row => row.payload);
  }
  async claim(): Promise<Job | undefined> {
    const result = await this.pool.query<{
      payload: Job;
    }>(`UPDATE platform_jobs SET status='running', heartbeat=now(), payload=jsonb_set(payload,'{status}','"running"')
      WHERE id=(SELECT id FROM platform_jobs WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING payload`);
    return result.rows[0]?.payload;
  }
  async reconcile(): Promise<void> {
    await this.pool.query(
      `UPDATE platform_jobs SET status='failed', payload=payload || jsonb_build_object('status','failed','error','Worker stopped during execution. Review workflow before retrying.','completed_at',now()) WHERE status='running' AND heartbeat < now() - interval '10 minutes'`
    );
  }
  async complete(job: Job, records: Record<string, unknown>[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let offset = 0; offset < records.length; offset += 1000) {
        await client.query(
          `INSERT INTO platform_records(job_id,ordinal,data) SELECT $1, $2::integer + ordinality::integer - 1, value FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY`,
          [job.execution_id, offset, JSON.stringify(records.slice(offset, offset + 1000))]
        );
      }
      await client.query(
        'UPDATE platform_jobs SET payload=$2,status=$3,heartbeat=now() WHERE id=$1',
        [job.execution_id, JSON.stringify(job), job.status]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async records(id: string, limit: number, offset: number): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM platform_records WHERE job_id=$1 ORDER BY ordinal LIMIT $2 OFFSET $3',
      [id, limit, offset]
    );
    return result.rows.map(row => row.data);
  }
}
