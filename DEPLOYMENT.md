# AI Data Intelligence Platform - Deployment Guide

This guide covers the installation, setup process, and troubleshooting procedures for the AI Data Intelligence Platform across various environments (local development, Docker Compose, and Kubernetes).

## 1. Prerequisites

- **Docker & Docker Compose** (for local containerized deployment)
- **Node.js 20+** (for bare-metal development)
- **Kubernetes Cluster** (for production deployment, e.g., EKS, GKE, or minikube)
- API Keys:
  - OpenAI API Key (or compatible LLM endpoint)
  - n8n API Key (Generated from your n8n instance)

## 2. Environment Configuration

The platform relies strictly on environment variables for configuration. Create a `.env` file at the root of the project:

```env
NODE_ENV=development

# LLM Configuration
LLM_API_KEY=your_openai_api_key
LLM_ENDPOINT=https://api.openai.com/v1
LLM_MODEL=gpt-4o

# n8n Configuration
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=your_n8n_api_key

# Limits
LIMIT_MAX_RECORDS=1000000
LIMIT_MAX_EXPORT_SIZE_MB=500
```

## 3. Local Docker Compose Deployment (Recommended for Testing)

The easiest way to stand up the full stack (Platform, n8n, PostgreSQL) is via Docker Compose.

```bash
# Build and start the platform in detached mode
docker-compose up -d --build

# View logs
docker-compose logs -f platform
```

### Accessing Services:
- **Platform Health Check:** `http://localhost:3000/health`
- **n8n Dashboard:** `http://localhost:5678`
- **PostgreSQL:** `localhost:5432`

## 4. Kubernetes Production Deployment

For production, we recommend deploying to Kubernetes. Example manifests are provided in the `kubernetes/` directory.

### Step 1: Create Namespace and Secrets
```bash
kubectl create namespace ai-data

# Create your secrets
kubectl create secret generic ai-platform-secrets \
  --namespace ai-data \
  --from-literal=LLM_API_KEY="your-llm-key" \
  --from-literal=N8N_API_KEY="your-n8n-key" \
  --from-literal=DB_PASSWORD="your-secure-db-password"
```

### Step 2: Apply Manifests
```bash
kubectl apply -f kubernetes/postgres.yaml
kubectl apply -f kubernetes/n8n.yaml
kubectl apply -f kubernetes/platform.yaml
```

### Step 3: Verify Deployment
```bash
kubectl get pods -n ai-data
kubectl logs -f deployment/ai-platform -n ai-data
```

## 5. API Documentation

Currently, the primary entry point for health monitoring is exposed on the HTTP server:

### GET `/health`
Returns the status of the platform node.
**Response (200 OK):**
```json
{
  "status": "ok",
  "environment": "production",
  "timestamp": "2026-09-30T10:00:00.000Z"
}
```

## 6. Troubleshooting

### Problem: Platform container crashes on startup with `Configuration validation failed`
**Cause:** Missing required API keys in the environment.
**Fix:** Ensure `LLM_API_KEY` and `N8N_API_KEY` are provided either via `.env` or Docker/K8s secrets.

### Problem: Workflows fail to deploy to n8n
**Cause:** The `N8N_BASE_URL` is unreachable or the API key is incorrect.
**Fix:** If running in Docker Compose, ensure `N8N_BASE_URL=http://n8n:5678`. Ensure the n8n container is fully booted and healthy before the platform attempts to deploy.

### Problem: Database connection timeouts
**Cause:** Postgres container is taking too long to initialize.
**Fix:** The Docker Compose file includes a `depends_on: condition: service_healthy` block which mitigates this. Ensure your local Docker daemon supports health checks.

## 7. Example Prompts & Expected Workflows

When the orchestration pipeline is running, here are examples of what you can ask the Intake Agent:

**Prompt:** "Extract recent tech news from HackerNews and persist it to our analytics Postgres database."
**Expected Workflow:**
1. `Discover` (Scrape HackerNews RSS)
2. `Extract` (Parse titles and links)
3. `Transform` (Normalize JSON structure)
4. `Persist` (Write to PostgreSQL node)

**Prompt:** "Monitor my support inbox and alert me in Slack if a high-priority customer is angry."
**Expected Workflow:**
1. `Acquire` (IMAP/Gmail Trigger)
2. `Enrich` (LLM node to determine sentiment/priority)
3. `Filter` (Condition node: Priority == HIGH && Sentiment == ANGRY)
4. `Deliver` (Slack node)
