# Kubernetes templates — not validated for release

These manifests are examples only. The tested deployment is Docker Compose. Do not apply these to an existing cluster without configuring the following:

1. Create namespace `ai-data` and provision storage/backups.
2. Publish the built platform image under your registry and replace the image reference.
3. Create `ai-platform-secrets` through your secret manager with `GEMINI_API_KEY`, `PLATFORM_API_TOKEN`, `N8N_API_KEY`, `N8N_ENCRYPTION_KEY`, and `DB_PASSWORD`. Set up the n8n owner and scoped API key securely before starting the platform. Do not copy the Compose bootstrap onto an existing n8n account.
4. Provide a dashboard deployment, ingress and TLS. Its nginx upstream must be `ai-platform-service:3000`; the Compose nginx Docker DNS resolver (`127.0.0.11`) is not valid inside Kubernetes.
5. Add network policies, resource/storage limits, backup/restore procedures and cluster-specific security settings. The API token grants access to the whole workspace.
6. Validate manifests with your cluster's admission policies; run the live-stack and browser suites against staging.

No production ingress, certificates, secret values or image registry are hardcoded here. A successful local Docker test does not certify these manifests.
