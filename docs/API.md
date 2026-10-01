# HTTP API

Browser-facing routes use `/api`; the backend receives the suffix without that prefix. Except for health, readiness and sign-in, all routes require `Authorization: Bearer <PLATFORM_API_TOKEN>` or the HttpOnly session cookie obtained at sign-in. Secrets should be injected by your client environment, never committed.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/health` | Process liveness |
| GET | `/api/ready` | 200 if PostgreSQL and n8n are ready; otherwise 503 |
| POST | `/api/session` | Body `{ "token": "<workspace key>" }`; sets eight-hour HttpOnly, SameSite=Strict session |
| DELETE | `/api/session` | Clears session cookie |
| POST | `/api/prompts` | Body `{ "prompt": "..." }`; returns 202 and durable job with `execution_id` |
| GET | `/api/dashboard` | Most recent 100 jobs, verification stages, configured model, export limits |
| GET | `/api/executions/:id` | One job, status, stage failures, counts, duration and n8n workflow ID |
| GET | `/api/executions/:id/records?limit=25&offset=0` | Stored records; limit 1–100; nonnegative offset |
| POST | `/api/executions/:id/export` | Body `{ "format": "csv" }` or `json`; returns authenticated download URL |
| GET | `/api/executions/:id/download?format=json` | Actual downloadable file; completed jobs only |

Job status: `pending`, `running`, `completed`, `failed`. Stage status: `pending`, `running`, `success`, `failed`. Poll status or dashboard; this release does not implement server-pushed node-level updates.

Errors are JSON `{ "error": "message" }` except errors produced by the reverse proxy (for example its request-size limit). Status codes: 400 malformed input; 401 unauthenticated; 403 origin mismatch; 404 missing resource; 409 unfinished export; 413 request/export too large; 429 sign-in/queue limit; 500 unexpected server error.

Limits: prompt 10,000 characters; JSON request 32 KB; queued/running jobs 20; one worker per API instance; source response 10 MB. Export defaults are configurable up to the deployment's tested capacity. CSV includes serialized provenance and neutralizes spreadsheet formulas.
