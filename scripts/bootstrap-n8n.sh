#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════════
# n8n Bootstrapper
# Automatically configures the initial owner account and generates an API key.
# ═══════════════════════════════════════════════════════════════════════════════

N8N_URL="http://n8n:5678"
ENV_FILE="/shared/.env"

echo "Waiting for n8n to start..."
until curl -s ${N8N_URL}/healthz; do
  echo "n8n is not ready yet. Retrying in 2s..."
  sleep 2
done

echo "n8n is up! Checking if owner account exists..."

# Wait a few more seconds for migrations to complete
sleep 5

# Try to setup the owner account
SETUP_RESPONSE=$(curl -s -X POST ${N8N_URL}/rest/owner-setup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.dev","password":"ai_platform_secret","firstName":"AI","lastName":"Platform"}')

echo "Setup Response: $SETUP_RESPONSE"

# Log in to get the auth cookie
curl -s -c /tmp/cookies.txt -X POST ${N8N_URL}/rest/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.dev","password":"ai_platform_secret"}' > /dev/null

# Generate the API Key
API_KEY_RESPONSE=$(curl -s -b /tmp/cookies.txt -X POST ${N8N_URL}/rest/api-keys \
  -H "Content-Type: application/json" \
  -d '{"label":"AI Platform Key"}')

# Extract the raw key from the JSON response
API_KEY=$(echo "$API_KEY_RESPONSE" | grep -o '"apiKey":"[^"]*' | cut -d'"' -f4)

if [ -z "$API_KEY" ]; then
  echo "Failed to generate API Key. n8n might already be set up!"
  exit 0
fi

echo "Successfully generated n8n API Key!"

# Export it to the shared volume so the Platform container can read it
echo "N8N_API_KEY=$API_KEY" > ${ENV_FILE}

echo "Bootstrapping complete."
