# Shortcuts for the pnpm scripts. Outside the dev shell (direnv), commands go through
# `nix develop -c`; override with `make RUN= <target>` to disable that.
RUN ?= $(if $(shell command -v pnpm 2>/dev/null),,nix develop -c)
PNPM := $(RUN) pnpm
IMAGE ?= kinoshelf:dev

.DEFAULT_GOAL := help

.PHONY: help install build build-web dev-web typecheck lint format format-check test test-corpus \
        test-live corpus-report corpus-record check docker-build flake-check clean

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install the dependencies
	$(PNPM) install

build: ## Build every package (tsc -b)
	$(PNPM) build

build-web: ## Build the web UI
	$(PNPM) build:web

dev-web: ## Start the web UI dev server (Vite)
	$(PNPM) --filter @kinoshelf/web dev

typecheck: ## Type-check sources, tests and the web UI
	$(PNPM) typecheck

lint: ## Lint (builds first)
	$(PNPM) lint

format: ## Format with Prettier
	$(PNPM) format

format-check: ## Check the formatting without writing
	$(PNPM) format:check

test: ## Run every test, corpus included (builds first)
	$(PNPM) test

test-corpus: ## Run the matching corpus only
	$(PNPM) test:corpus

test-live: ## Contract tests against the real TMDB API (needs TMDB_API_KEY in .env)
	$(PNPM) test:live

corpus-report: ## Print every corpus verdict with its score and runner-ups
	$(PNPM) corpus:report

corpus-record: ## Re-record the TMDB responses (needs TMDB_API_KEY in .env)
	$(PNPM) corpus:record

check: typecheck lint format-check test ## Everything required before considering work done

docker-build: ## Build the Docker image (IMAGE=kinoshelf:dev)
	docker build -t $(IMAGE) .

flake-check: ## Validate the Nix flake (new files must be `git add -N`)
	nixfmt --check flake.nix
	nix flake check

clean: ## Remove build output
	$(PNPM) exec tsc -b --clean
	rm -rf packages/web/dist
