#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/4] Checking Docker availability..."
docker --version >/dev/null
docker compose version >/dev/null

echo "[2/4] Stopping old stack (if any)..."
docker compose down --remove-orphans >/dev/null 2>&1 || true

echo "[3/4] Building image..."
docker compose build app

echo "[4/4] Starting container..."
docker compose up -d app

echo "Waiting for health check..."
for i in {1..40}; do
  status="$(docker inspect --format='{{.State.Health.Status}}' paper-llm-gateway 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    echo "Container is healthy."
    exit 0
  fi
  sleep 2
done

echo "Container failed to become healthy. Recent logs:"
docker compose logs --tail=200 app || true
exit 1
