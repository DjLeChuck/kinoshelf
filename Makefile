# Shortcuts for the pnpm scripts. Outside the dev shell (direnv), commands go through
# `nix develop -c`; override with `make RUN= <target>` to disable that.
RUN ?= $(if $(shell command -v pnpm 2>/dev/null),,nix develop -c)
PNPM := $(RUN) pnpm
IMAGE ?= kinoshelf:dev
# Building ffprobe needs a compiler and a static libc: the flake's `ffprobe` shell. Empty where the
# toolchain is already there (CI): `make FFPROBE_RUN= ffprobe`.
FFPROBE_RUN ?= nix develop .\#ffprobe -c
FFPROBE_DIR := .work/ffprobe-out
SEA_DIST := packages/sea/dist
SEA_CONFIG ?= .work/sea-config
SEA_PORT ?= 18484
VERSION ?= 0.0.0-dev

.DEFAULT_GOAL := help

.PHONY: help hooks install build build-web dev-server dev-web typecheck lint format format-check test test-corpus \
        test-e2e test-live corpus-report corpus-record check docker-build ffprobe sea sea-run test-sea sea-archive smoke-sea players-up players-down players-seed flake-check clean

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install the dependencies
	$(PNPM) install

build: ## Build every package (tsc -b)
	$(PNPM) build

build-web: ## Build the web UI
	$(PNPM) build:web

dev-server: build ## Start the REST server on :8484 (API key: KINOSHELF_API_KEY, or `kinoshelf-server api-key create`)
	$(RUN) node packages/server/dist/main.js

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

test-e2e: ## End-to-end tests of the web UI (Playwright; builds the server and the UI first)
	$(PNPM) test:e2e

test-live: ## Contract tests against the real TMDB API (needs TMDB_API_KEY in .env)
	$(PNPM) test:live

corpus-report: ## Print every corpus verdict with its score and runner-ups
	$(PNPM) corpus:report

corpus-record: ## Re-record the TMDB responses (needs TMDB_API_KEY in .env)
	$(PNPM) corpus:record

check: typecheck lint format-check test ## Everything required before considering work done

$(FFPROBE_DIR)/ffprobe: scripts/build-ffprobe.sh
	$(FFPROBE_RUN) scripts/build-ffprobe.sh $(FFPROBE_DIR)

ffprobe: $(FFPROBE_DIR)/ffprobe ## Build the minimal ffprobe into .work/ffprobe-out (cached; rebuilt when the script changes)

sea: build build-web ffprobe ## Build the standalone binary, with its ffprobe, in packages/sea/dist
	$(PNPM) --filter @kinoshelf/sea build
	cp $(FFPROBE_DIR)/ffprobe $(SEA_DIST)/ffprobe
	mkdir -p $(SEA_DIST)/LICENSES
	cp -r $(FFPROBE_DIR)/LICENSES/. $(SEA_DIST)/LICENSES/

test-sea: sea ## End-to-end tests against the standalone binary (needs a browser, like test-e2e)
	KINOSHELF_E2E_BINARY=$(abspath $(SEA_DIST))/kinoshelf $(PNPM) --filter @kinoshelf/e2e test

sea-archive: sea ## Pack the release archive (VERSION=…); needs a Node with its LICENSE file: nodejs.org's, not nixpkgs'
	scripts/package-sea.sh $(VERSION)

smoke-sea: sea-archive ## Start the archive in debian:12-slim and ubuntu:22.04 (Docker); the Node must be one those images can run
	scripts/smoke-sea.sh $(SEA_DIST)/kinoshelf-$(VERSION)-*.tar.xz

sea-run: sea ## Run the standalone binary on :SEA_PORT with a throwaway config in SEA_CONFIG (.work/sea-config)
	@echo "API key: KINOSHELF_CONFIG_DIR=$(SEA_CONFIG) $(SEA_DIST)/kinoshelf api-key create"
	KINOSHELF_CONFIG_DIR=$(SEA_CONFIG) KINOSHELF_HOST=127.0.0.1 KINOSHELF_PORT=$(SEA_PORT) $(SEA_DIST)/kinoshelf serve

hooks: ## Use the versioned git hooks (.githooks): pre-push runs every test
	git config core.hooksPath .githooks

docker-build: ## Build the Docker image (IMAGE=kinoshelf:dev)
	docker build -t $(IMAGE) .

players-up: ## Start Jellyfin (:8096) and Plex (:32400) in Docker and Kodi (:6080), media in .work/media (see dev/players)
	nix run ./dev/players -- up

players-down: ## Stop them (their state in .work/players is kept)
	nix run ./dev/players -- down

players-seed: ## Put tiny clips named like releases in .work/media/arrivals, for Kinoshelf to organize
	nix run ./dev/players -- seed

flake-check: ## Validate the Nix flake (new files must be `git add -N`)
	nixfmt --check flake.nix dev/players/flake.nix
	nix flake check
	nix flake check ./dev/players

clean: ## Remove build output, including files whose source is gone (`tsc -b --clean` keeps them)
	rm -rf packages/*/dist packages/providers/*/dist packages/*/tsconfig.tsbuildinfo packages/providers/*/tsconfig.tsbuildinfo
