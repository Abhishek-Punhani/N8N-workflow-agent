#!/bin/bash
set -euo pipefail

log() { 
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

log "Starting N8N-Agent deployment setup"

# 1. System update and Install dependencies
log "Updating system & installing dependencies..."
apt-get update -qq
apt-get upgrade -y -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates \
    curl \
    gnupg \
    git \
    nginx \
    certbot

# 2. Docker installation
log "Setting up Docker repository..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

ARCH=$(dpkg --print-architecture)
CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $CODENAME stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 3. Setup Application directory
BASE_DIR="/opt/n8n-agent"
log "Creating application directory: $BASE_DIR"
mkdir -p "$BASE_DIR"
cd "$BASE_DIR"

# 4. Clone Repository with authentication
USERNAME="${github_username}"
TOKEN="${github_token}"
REPO_URL="${repo_url}"
BRANCH="${branch_name}"
HOST_PATH="$${REPO_URL#https://}"

log "Cloning repository: $REPO_URL (branch: $BRANCH)"
git clone -b "$BRANCH" "https://$USERNAME:$TOKEN@$HOST_PATH" .

# 5. Create environment file
log "Creating environment configuration..."
if [ -n "${env_content}" ]; then
  cat > "$BASE_DIR/.env" <<'ENVEOF'
${env_content}
ENVEOF
else
  log "Warning: No environment variables provided via terraform. Using .env.example."
  cp .env.example .env
fi

# 6. SSL Certificate Generation & Nginx setup (if domain is provided)
DOMAIN="${domain_name}"
EMAIL="${admin_email}"

if [ -n "$DOMAIN" ]; then
    log "Configuring domain: $DOMAIN"
    
    if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
        log "Certificates already exist for $DOMAIN. Skipping generation."
    else
        log "Generating SSL certificates for: $DOMAIN"
        fuser -k 80/tcp || true
        certbot certonly --standalone \
            --non-interactive --agree-tos -m "$EMAIL" \
            -d "$DOMAIN"
    fi

    log "Writing nginx configuration for $DOMAIN"
    cat > "/etc/nginx/sites-available/n8n-agent" <<NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 30s;
    }
}
NGINXEOF

    ln -sf /etc/nginx/sites-available/n8n-agent /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    service nginx restart

    CRON_ENTRY="0 3 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx' >> /var/log/certbot-renew.log 2>&1"
    (crontab -l 2>/dev/null | grep -v 'certbot renew' ; echo "$CRON_ENTRY") | crontab -
else
    log "No domain provided. Bypassing Nginx SSL setup. The application will run on port 8080 directly."
    service nginx stop || true
fi

# 7. Start docker containers
log "Starting application containers..."
docker compose up -d --build

log "Deployment complete!"
