#!/usr/bin/env bash
set -e

echo "=========================================="
echo "  RankLens Production Deployment & Auto-Fix"
echo "=========================================="

# 1. Check if running on Linux/Ubuntu and fix Docker daemon DNS / TLS handshake issues if needed
if [ -d "/etc/docker" ] || command -v systemctl >/dev/null 2>&1; then
    echo "==> Checking Docker daemon network settings..."
    NEED_RESTART=0
    
    # Configure DNS & disable IPv6 for Docker if not configured
    if [ ! -f "/etc/docker/daemon.json" ]; then
        echo "==> Configuring /etc/docker/daemon.json with public DNS to prevent TLS handshake timeouts..."
        sudo mkdir -p /etc/docker
        sudo tee /etc/docker/daemon.json > /dev/null << 'EOF'
{
  "dns": ["8.8.8.8", "1.1.1.1", "8.8.4.4"],
  "ipv6": false,
  "max-concurrent-downloads": 3
}
EOF
        NEED_RESTART=1
    fi
    
    if [ "$NEED_RESTART" -eq 1 ]; then
        echo "==> Restarting Docker service..."
        sudo systemctl restart docker || true
        sleep 2
    fi
fi

# 2. Check for .env.prod
if [ ! -f ".env.prod" ]; then
    if [ -f ".env.prod.example" ]; then
        echo "==> Creating .env.prod from .env.prod.example..."
        cp .env.prod.example .env.prod
        echo "⚠️  Please update .env.prod with your production credentials!"
    else
        echo "❌ Error: .env.prod not found!"
        exit 1
    fi
fi

# 3. Pre-pull required base images with retry to cache them locally
echo "==> Pre-pulling required base images to avoid BuildKit handshake timeouts..."
for img in "python:3.12-slim" "node:22-alpine" "redis:7-alpine" "nginx:alpine"; do
    echo "--> Pulling $img..."
    for i in 1 2 3; do
        if docker pull "$img"; then
            break
        else
            echo "⚠️ Retrying pull for $img (attempt $i/3)..."
            sleep 3
        fi
    done
done

# 4. Build and start containers using docker compose
echo "==> Building and deploying production containers..."
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

# 5. Show status
echo "==> Deployment completed! Container status:"
docker compose -f docker-compose.prod.yml ps

echo "=========================================="
echo "  Deployment Successful!"
echo "=========================================="
