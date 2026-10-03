#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "❌  terraform/.env not found. Fill in your values first."
  exit 1
fi

echo "📦  Loading environment from .env..."
set -o allexport
source "$SCRIPT_DIR/.env"
set +o allexport

echo "🔍  Project : $TF_VAR_project_id"
echo "🖥️   Instance : $TF_VAR_instance_name"
echo "🌐  Domain  : ${TF_VAR_domain_name:-<none, using IP>}"
echo ""

terraform -chdir="$SCRIPT_DIR" init -upgrade
terraform -chdir="$SCRIPT_DIR" apply "$@"
