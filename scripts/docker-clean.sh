#!/bin/bash

# Clean Docker environment - removes all containers, images, and volumes
# Use this to start completely fresh

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${RED}⚠️  WARNING: This will remove ALL containers, volumes, and images${NC}"
echo -e "${YELLOW}This includes the PostgreSQL database and all workout data!${NC}"
echo ""
read -p "Are you sure? [y/N]: " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled."
  exit 0
fi

echo ""
echo -e "${YELLOW}🧹 Cleaning Docker environment...${NC}"
echo ""

# Stop and remove containers
echo "1/4 Stopping containers..."
docker-compose down -v 2>/dev/null || true

# Remove logeverylift-pwa image
echo "2/4 Removing logeverylift-pwa image..."
docker rmi logeverylift-pwa:latest 2>/dev/null || true

# Remove orphaned volumes
echo "3/4 Removing orphaned volumes..."
docker volume prune -f

# Remove build cache (optional)
read -p "$(echo -e ${YELLOW}Remove build cache too? [y/N]:${NC} )" -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "4/4 Removing build cache..."
  docker builder prune -f
else
  echo "4/4 Skipping build cache..."
fi

echo ""
echo -e "${GREEN}✅ Cleanup complete!${NC}"
echo ""
echo "To rebuild and start fresh:"
echo "  ./scripts/docker-dev.sh --clean"
