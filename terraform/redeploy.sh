#!/bin/bash
set -e

echo "🚀 Redeploying N8N-Agent instance (Update Only)..."
source source.env

# Get instance details
INSTANCE_NAME=$(terraform output -raw instance_name)
INSTANCE_IP=$(terraform output -raw instance_ip)

# Get Zone dynamically
ZONE=$(gcloud compute instances list --filter="name=(${INSTANCE_NAME})" --format="value(zone)" | head -n 1)

if [ -z "$ZONE" ]; then
  echo "❌ Could not find zone for instance $INSTANCE_NAME"
  exit 1
fi

echo "✅ Target instance: $INSTANCE_NAME ($INSTANCE_IP) in $ZONE"

# Helper to run SSH command
run_ssh() {
    gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --command "$1" -- -o StrictHostKeyChecking=no
}

echo "⏳ Connecting to instance..."
if ! run_ssh "echo 'SSH Ready'" &>/dev/null; then
    echo "❌ SSH not reachable."
    exit 1
fi

echo "✅ SSH is ready. Running updates..."

REMOTE_CMD="
set -e
echo '--- Starting Update ---'

# Ensure we run as root
if [ \"\$EUID\" -ne 0 ]; then
    echo 'Switching to root for git operations...'
    exec sudo -E bash -c \"
        set -e
        git config --global --add safe.directory /opt/n8n-agent
        cd /opt/n8n-agent
        
        echo 'Pulling latest code...'
        git pull origin \${TF_VAR_branch_name}
        
        echo 'Rebuilding and restarting containers...'
        docker compose up -d --build --force-recreate
        
        echo '--- Update Complete ---'
    \"
else
    git config --global --add safe.directory /opt/n8n-agent
    cd /opt/n8n-agent
    
    echo 'Pulling latest code...'
    git pull origin \${TF_VAR_branch_name}
    
    echo 'Rebuilding and restarting containers...'
    docker compose up -d --build --force-recreate
    
    echo '--- Update Complete ---'
fi
"

run_ssh "$REMOTE_CMD"

echo "🎉 Redeploy finished successfully!"
