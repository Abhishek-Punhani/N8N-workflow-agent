# Forma · Data Intelligence

A Gemini 3 powered workspace for turning a natural-language request and a public JSON API into a source-linked dataset. React frontend, TypeScript API, PostgreSQL persistence, and actual n8n execution.

**Release status:** working Docker application; the full `.kiro` product specification is not yet launch-complete. See [the readiness audit](reports/READINESS.md) for verified behavior, remaining requirements, and evidence. Existing unit tests alone are not evidence of live integrations.

## Run locally

1. Copy `.env.example` to `.env` and fill the required secrets.
2. `docker compose up -d --build --wait`
3. Open **http://localhost**. Sign in using `PLATFORM_API_TOKEN` from your local `.env`.
4. Describe your dataset, including one public HTTPS JSON API URL and required fields.

Example:

> From https://jsonplaceholder.typicode.com/users collect all users with id, name and email. Return JSON.

JSONPlaceholder is a public test dataset, not real customer data. The example cards only fill the prompt; they never supply canned results.

The platform API is available on loopback at http://localhost:3000 for manual checks, and the dashboard also proxies it through `/api/*`. The n8n editor is available on loopback at http://localhost:5678, using `N8N_OWNER_EMAIL` / `N8N_OWNER_PASSWORD`. PostgreSQL is not exposed directly. [Deployment details](DEPLOYMENT.md).

## What runs

`src/server.ts` starts the authenticated API and durable queue worker. `src/service/` is the connected application path:

- `http.ts`: sessions, prompt submission, status, pagination, streamed disk-backed CSV/JSON downloads.
- `store.ts`: PostgreSQL jobs, claims, recovery state and transactional result persistence.
- `pipeline.ts`: Gemini intake/planning, deterministic checks, targeted structural repair, n8n trial and full execution.
- `compiler.ts`: vetted code templates; model data is serialized, never executed as code.
- `source.ts`: HTTPS JSON acquisition, address pinning, private-network blocking and bounded response size.
- `n8n.ts`: real create/activate/webhook/deactivate/delete lifecycle.

Sources must currently return a JSON array of objects (10 MB acquisition cap). One source and linear graphs are supported. Acquisition parses a source snapshot once; both trial and full n8n runs process that same snapshot. Unsupported search, HTML, authenticated sources and branches fail explicitly. Records are persisted only after the execution and runtime contract checks succeed.

The older `src/orchestration`, `src/run`, and `src/verify/compiler.ts` modules remain design prototypes with unit coverage. They are **not the production HTTP execution path** and must not be substituted for `src/service` without completing their integration. In particular, the old `Sandbox` simulates fixtures.

## Verification

Use Node.js 22+ for development.

```sh
npm ci
npm ci --prefix dashboard
npm run check
npm test
npm run build --prefix dashboard
npm test --prefix dashboard
npm run lint --prefix dashboard
npm run test:stack
npx playwright install chromium
npm run test:browser
```

`test:stack` requires running Docker services and a funded/available Gemini model; it makes real billable API calls and creates workflows and datasets. `test:browser` requires a completed live dataset from that script. No mocked provider or fallback is used in either test. Unit tests remain isolated and deterministic.

## Configuration and design

- [Environment template](.env.example)
- [Deployment and operations](DEPLOYMENT.md)
- [HTTP API](docs/API.md)
- [Requirements](.kiro/specs/ai-data-intelligence-platform/requirements.md)
- [Design](.kiro/specs/ai-data-intelligence-platform/design.md)
- [Task audit](reports/READINESS.md)
