#!/bin/bash
set -euo pipefail

# Medical Clinic Legal Validator — Full Infrastructure Reset
# Destroys and recreates all Docker containers, CloudFormation stacks,
# DynamoDB tables, SQS queues, and Redis cache from scratch.
#
# Usage: ./infra/reset.sh

echo "=== Medical Validator: Full Reset ==="

cd "$(dirname "$0")/.."

# 1. Kill any running dev processes (api, workers, frontend)
echo "[1/5] Stopping dev processes..."
pkill -f "tsx watch" 2>/dev/null || true
pkill -f "services/worker" 2>/dev/null || true
pkill -f "services/api" 2>/dev/null || true

# 2. Destroy Docker containers + volumes (clean slate)
echo "[2/5] Destroying Docker containers and volumes..."
docker compose down -v 2>/dev/null || true

# 3. Recreate containers and wait for healthy
echo "[3/5] Starting Docker containers..."
docker compose up -d --wait

# 4. Verify bootstrap ran (queues + tables created by init hook)
echo "[4/5] Verifying infrastructure..."

MAX_RETRIES=10
RETRY=0
until aws --endpoint-url=http://localhost:4566 sqs list-queues 2>/dev/null | grep -q "verification-queue.fifo"; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "ERROR: SQS queues not created after ${MAX_RETRIES} retries"
    echo "Check bootstrap logs: docker compose logs localstack"
    exit 1
  fi
  echo "  Waiting for bootstrap to complete... (${RETRY}/${MAX_RETRIES})"
  sleep 2
done

echo ""
echo "SQS queues:"
aws --endpoint-url=http://localhost:4566 sqs list-queues --output text 2>/dev/null || true

echo ""
echo "DynamoDB tables:"
aws --endpoint-url=http://localhost:4566 dynamodb list-tables --output text 2>/dev/null || true

echo ""
echo "Redis:"
redis-cli -u redis://localhost:6379 ping 2>/dev/null || echo "  (redis-cli not installed, skipping)"

# 5. Flush Redis (clear any stale cache)
echo ""
echo "[5/5] Flushing Redis cache..."
redis-cli -u redis://localhost:6379 FLUSHALL 2>/dev/null || docker compose exec -T redis redis-cli FLUSHALL 2>/dev/null || true

echo ""
echo "=== Reset complete. Run 'npm run dev' to start. ==="
