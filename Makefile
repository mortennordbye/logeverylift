# LogEveryLift — developer task runner.
# `make` (or `make help`) lists targets. Dev runs in Docker; tests run locally.
# Written for stock macOS GNU Make 3.81: no .ONESHELL, so each recipe line is a
# self-contained shell command (state is not shared across lines).

SHELL := /bin/bash

# Dev vs prod stage, selected with PROD=1.
STAGE := $(if $(PROD),runner,dev)
IMAGE := logeverylift-pwa:$(if $(PROD),prod,dev)
CACHE_FLAG := $(if $(CLEAN),--no-cache,)
COMPOSE := docker-compose

.DEFAULT_GOAL := help

.PHONY: help dev logs down clean \
        test test-watch typecheck lint verify verify-full build \
        db-push db-generate db-migrate db-seed db-seed-fake db-reset-user db-studio \
        create-admin

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  dev flags (set to 1):  PROD  CLEAN  SKIP_BUILD  TEST"
	@echo "  e.g.  make dev CLEAN=1   |   make dev PROD=1   |   make clean CACHE=1"

# ---------------------------------------------------------------- Docker / dev

dev: ## Build the image and start the containers (health-checked)
	@if [ -n "$(TEST)" ]; then echo "Running tests..."; pnpm test; fi
	@echo "If you changed src/db/schema/, run: make db-generate && git add drizzle/"
	@echo "Stopping existing containers..."
	@$(COMPOSE) down 2>/dev/null || true
	@if [ -z "$(SKIP_BUILD)" ]; then echo "Building stage [$(STAGE)]..."; docker build $(CACHE_FLAG) --target $(STAGE) -t $(IMAGE) .; fi
	@echo "Launching containers..."
	@IMAGE_NAME=$(IMAGE) $(COMPOSE) up -d
	@echo "Waiting for application health check..."
	@for i in $$(seq 1 40); do if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then echo "Application is LIVE."; break; fi; printf '.'; sleep 1; done; echo ""
	@echo "Mode: $(STAGE)   Local: http://localhost:3000"
	@IP=$$(ipconfig getifaddr en0 2>/dev/null || echo "YOUR-IP"); echo "iPhone: http://$$IP:3000"
	@echo "Tail logs with: make logs"

logs: ## Follow container logs
	$(COMPOSE) logs -f

down: ## Stop and remove containers
	$(COMPOSE) down

clean: ## Remove containers, volumes, and images (DESTROYS the DB; CACHE=1 also prunes build cache)
	@echo "WARNING: this removes ALL containers, volumes, and images."
	@echo "That includes the PostgreSQL database and all workout data."
	@read -p "Are you sure? [y/N]: " -n 1 -r REPLY; echo ""; \
	  if [[ ! $$REPLY =~ ^[Yy]$$ ]]; then echo "Cancelled."; exit 0; fi; \
	  echo "Stopping containers and removing volumes..."; $(COMPOSE) down -v 2>/dev/null || true; \
	  echo "Removing images..."; for tag in dev prod latest; do docker rmi logeverylift-pwa:$$tag 2>/dev/null || true; done; \
	  echo "Pruning orphaned volumes..."; docker volume prune -f; \
	  if [ -n "$(CACHE)" ]; then echo "Pruning build cache..."; docker builder prune -f; fi; \
	  echo "Cleanup complete. Rebuild with: make dev CLEAN=1"

# ------------------------------------------------------------------- quality

test: ## Run the unit test suite once (local)
	pnpm test

test-watch: ## Run the unit tests in watch mode (local)
	pnpm test:watch

typecheck: ## Type-check with tsc --noEmit (local)
	pnpm typecheck

lint: ## Run ESLint (local)
	pnpm lint

verify: ## typecheck + lint + tests (run before pushing)
	pnpm verify

verify-full: ## verify + Playwright e2e (needs dev server up)
	pnpm verify:full

build: ## Production build check (in container)
	$(COMPOSE) exec app pnpm build

# ------------------------------------------------------------------- database

db-push: ## Push schema changes to the DB (dev iteration)
	$(COMPOSE) exec app pnpm db:push

db-generate: ## Generate a Drizzle migration (interactive prompts)
	$(COMPOSE) exec app pnpm db:generate

db-migrate: ## Apply committed migrations
	$(COMPOSE) exec app pnpm db:migrate

db-seed: ## Seed the exercise library + demo user
	$(COMPOSE) exec app pnpm db:seed

db-seed-fake: ## Populate the demo user with realistic test data
	$(COMPOSE) exec app pnpm db:seed-fake

db-reset-user: ## Wipe all user data (keeps exercises + user record)
	$(COMPOSE) exec app pnpm db:reset-user

db-studio: ## Open Drizzle Studio
	$(COMPOSE) exec app pnpm db:studio

create-admin: ## Create an admin user
	$(COMPOSE) exec app pnpm create-admin
