# Deployment and operations

## Local Docker deployment

Requires Docker Engine and Compose v2. Copy `.env.example` to `.env`, supply a Gemini key, and generate independent random values for `PLATFORM_API_TOKEN`, `DB_PASSWORD`, and `N8N_ENCRYPTION_KEY` (for example `openssl rand -hex 32`). Configure an owner email and strong password for n8n.

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

Dashboard: http://localhost. Its sign-in key is `PLATFORM_API_TOKEN`. Platform API: http://localhost:3000 for manual loopback checks. n8n editor: http://localhost:5678, using the configured owner account. Keep `.env` mode 600 and do not paste it into issues or build logs.

The bootstrap service uses the n8n owner credentials to provision a scoped API key, stores it in a private Docker volume and reuses it on restart. It stops on provisioning errors. The current key lifetime is one year; rotate before expiry. The bootstrap uses n8n's internal owner/API-key management routes; this is version-dependent, so n8n is pinned to 2.41.4. Upgrades require rerunning the full-stack test. Do not point the bootstrap at an unrelated n8n instance.

PostgreSQL listens only on the Compose network. The dashboard, platform API and n8n editor bind to loopback by default. Container builds exclude `.env`, caches and local dependencies, and application containers run as non-root. Never run `docker compose down -v` against data you need.

## External deployment gate

This repository does **not** yet satisfy every requirement in the original design. Read [READINESS.md](reports/READINESS.md) before treating it as a public service. The supported use case is a private, single-workspace JSON collection application.

Before making it public:

- Terminate TLS at a trusted ingress/reverse proxy. Set `COOKIE_SECURE=true` and `N8N_SECURE_COOKIE=true` when the corresponding browser endpoint uses HTTPS. Publish only the dashboard; restrict the n8n editor to administrators.
- Put secrets in your deployment secret manager and replace local passwords/tokens. Preserve the n8n encryption key across upgrades and restores.
- Add user identities, authorization/tenant isolation and audit logging before offering separate customer workspaces. Current authentication grants access to the entire workspace.
- Use managed PostgreSQL or establish encrypted backups and test restore procedures. Configure external DB TLS if deployed outside the private Docker network; the included local pool is not a managed-database TLS configuration.
- Test the expected load and set container memory/CPU and export disk quotas. The one-million-record/500-MB export limits are enforcement ceilings, not demonstrated capacity. Acquisition is limited to 10 MB per source.
- Pin all base image digests in your release pipeline, scan images, and validate the Gemini model's availability and quota for your account.

Kubernetes files are deployment templates, **not a validated cluster deployment**. No changes have been made to the existing local Kubernetes clusters. They need your image registry, ingress/TLS, secret management, storage class, resource sizing and real cluster validation. Compose is the tested path.

## Health, recovery and diagnostics

- `/api/health`: process liveness; `/api/ready`: PostgreSQL and n8n readiness (no billable Gemini request).
- `docker compose logs --tail=100 platform n8n-bootstrapper`: startup and provisioning. Logs do not print secrets or prompts.
- Gemini HTTP 401/403: check key access. HTTP 429: quota/rate limit; no fallback. Gemini 5xx gets at most three attempts on the configured model, within the request timeout.
- Unsupported source: supply a direct HTTPS JSON array endpoint. Redirects, private addresses, HTML, embedded URL credentials and nonstandard ports are rejected.
- Failed jobs retain the stage/error and zero published records. Jobs are durably queued. Stale running jobs are marked failed after ten minutes without progress instead of being silently replayed. Inspect n8n before retrying an interrupted job.
- Trial workflows are removed after the trial. Full workflows are retained but deactivated after execution. Do not expose their webhook routes to the internet.
- Exports are written to a private temporary directory, size-checked, streamed and deleted. CSV cells are escaped and formula-prefixed values are neutralized.

## Backups and upgrades

Back up PostgreSQL using your backup system and store an encrypted copy of the n8n encryption key. The database contains prompts, plans, execution metadata, records and n8n state. Do not write database dumps into the repository. A backup is only proven after a restore test.

Build and run the unit/browser/live-stack suites in a staging environment before rolling an image or n8n version into service. During shutdown the API stops accepting work and gives its current job 25 seconds to finish; interrupted work is retained for reconciliation. n8n caps execution at 120 seconds.
