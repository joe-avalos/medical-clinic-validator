#!/bin/bash
# Docker cleanup — removes unused containers, dangling images, and build cache.
# WARNING: Does NOT prune volumes — run 'docker volume prune' manually if needed,
# but be aware it will delete localstack_data and ollama_data if containers are stopped.

echo "=== Stopped containers ==="
docker container prune -f

echo ""
echo "=== Dangling images ==="
docker image prune -f

echo ""
echo "=== Build cache ==="
docker builder prune -f

echo ""
echo "=== Disk usage after cleanup ==="
docker system df
