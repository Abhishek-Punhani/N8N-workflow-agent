#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# redeploy.sh  –  SSH into the running GCP instance and hot-swap the code.
# Run from inside the /terraform directory:
#   ./redeploy.sh
#
# Prereqs:
#   1. terraform/.env  filled with your secrets (see .env.example)
#   2. gcloud auth application-default login   (one-time auth)
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source the main .env to pick up GCP / GitHub / app config
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -o allexport
  source "$SCRIPT_DIR/.env"
  set +o allexport
else
  echo "❌  terraform/.env not found. Copy .env.example and fill it in."
  exit 1
fi

# Validate required vars
: "${TF_VAR_project_id:?  Set TF_VAR_project_id in terraform/.env}"
: "${TF_VAR_instance_name:=n8n-agent-platform}"
: "${TF_VAR_branch_name:=master}"

echo "🚀 Redeploying N8N-Agent (instance: $TF_VAR_instance_name, branch: $TF_VAR_branch_name)..."

# Resolve the zone dynamically from gcloud
ZONE=$(gcloud compute instances list \
  --project="$TF_VAR_project_id" \
  --filter="name=($TF_VAR_instance_name)" \
  --format="value(zone)" | head -n 1)

if [ -z "$ZONE" ]; then
  echo "❌  Could not find zone for instance '$TF_VAR_instance_name'"
  exit 1
fi

INSTANCE_IP=$(gcloud compute instances describe "$TF_VAR_instance_name" \
  --project="$TF_VAR_project_id" \
  --zone="$ZONE" \
  --format="value(networkInterfaces[0].accessConfigs[0].natIP)")

echo "✅  Instance: $TF_VAR_instance_name  |  IP: $INSTANCE_IP  |  Zone: $ZONE"

# Helper
run_ssh() {
  gcloud compute ssh "$TF_VAR_instance_name" \
    --project="$TF_VAR_project_id" \
    --zone="$ZONE" \
    --command "$1" \
    -- -o StrictHostKeyChecking=no
}

echo "⏳  Checking SSH connectivity..."
if ! run_ssh "echo 'SSH OK'" &>/dev/null; then
  echo "❌  SSH not reachable. Is the instance running?"
  exit 1
fi
echo "✅  SSH ready."

REMOTE_CMD="
set -e
echo '──── Starting Update ────'

sudo bash -c '
  set -e
  git config --global --add safe.directory /opt/n8n-agent
  cd /opt/n8n-agent

  echo \"[1/2] Pulling latest code from origin $TF_VAR_branch_name...\"
  git pull origin $TF_VAR_branch_name

  echo \"[2/2] Rebuilding and restarting containers...\"
  docker compose up -d --build --force-recreate

  echo \"──── Update Complete ────\"
'
"

run_ssh "$REMOTE_CMD"

echo "🎉  Redeploy of $TF_VAR_instance_name finished successfully!"
echo "🌐  App is live at: https://${TF_VAR_domain_name:-$INSTANCE_IP}"
