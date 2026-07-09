#!/bin/bash

# Docker Development & Production Script
# Optimized for Next.js 16 + Turbopack + Multi-stage Dockerfiles

set -e  # Exit on error

# Colors for output - Fixed syntax
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'  # Fixed: changed 1;33 to 0;33 or ensured \033 prefix
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     LogEveryLift - Docker Control      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"

# Default values
TARGET_STAGE="dev"
DOCKER_IMAGE="logeverylift-pwa:dev"
SKIP_BUILD=false
LOGS_ONLY=false
CLEAN=false
RUN_TESTS=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --prod)
      TARGET_STAGE="runner"
      DOCKER_IMAGE="logeverylift-pwa:prod"
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --logs)
      LOGS_ONLY=true
      shift
      ;;
    --clean)
      CLEAN=true
      shift
      ;;
    --test)
      RUN_TESTS=true
      shift
      ;;
    --help)
      echo "Usage: ./scripts/dev.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --prod          Build for PRODUCTION (Stage: runner)"
      echo "  --skip-build    Skip Docker image build"
      echo "  --logs          Only show logs"
      echo "  --clean         Clean build (no cache)"
      echo "  --test          Run tests before starting containers"
      echo "  --help          Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

if [ "$LOGS_ONLY" = true ]; then
  docker-compose logs -f
  exit 0
fi

if [ "$RUN_TESTS" = true ]; then
  echo -e "${BLUE}🧪 Running tests...${NC}"
  pnpm test
  echo -e "${GREEN}✅ All tests passed${NC}"
fi

echo -e "${YELLOW}💡 If you changed src/db/schema/, run: pnpm db:generate && git add drizzle/${NC}"

echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
docker-compose down 2>/dev/null || true

if [ "$SKIP_BUILD" = false ]; then
  echo -e "${BLUE}🔨 Building stage: [${TARGET_STAGE}]...${NC}"
  
  CACHE_FLAG=""
  if [ "$CLEAN" = true ]; then CACHE_FLAG="--no-cache"; fi

  # We use --target to tell your Dockerfile exactly where to stop
  docker build $CACHE_FLAG \
    --target $TARGET_STAGE \
    -t $DOCKER_IMAGE .
  
  echo -e "${GREEN}✅ Build successful for $TARGET_STAGE${NC}"
fi

echo -e "${GREEN}🚀 Launching containers...${NC}"
# We pass the image and target to compose via env vars
IMAGE_NAME=$DOCKER_IMAGE docker-compose up -d

# Wait for health
echo -e "${YELLOW}⏳ Waiting for application health check...${NC}"
RETRY_COUNT=0
MAX_RETRIES=40

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Application is LIVE!${NC}"
    break
  fi
  echo -n "."
  sleep 1
  RETRY_COUNT=$((RETRY_COUNT + 1))
done

echo ""
echo -e "${GREEN}Mode: ${YELLOW}$TARGET_STAGE${NC}"
echo -e "${BLUE}Local Access: ${NC} http://localhost:3000"

# Get Local IP for iPhone testing
IP_ADDR=$(ipconfig getifaddr en0 || echo "YOUR-IP")
echo -e "${BLUE}iPhone Access:${NC} http://$IP_ADDR:3000"
echo ""

if [[ $TARGET_STAGE == "dev" ]]; then
  echo -e "${YELLOW}Pro Tip:${NC} Hot-reloading (Turbopack) is active via volumes."
else
  echo -e "${RED}Warning:${NC} In production mode, code changes require a rebuild."
fi

echo ""
read -p "$(echo -e ${YELLOW}Show logs? [y/N]:${NC} )" -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  docker-compose logs -f app
fi