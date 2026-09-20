.PHONY: \
	help require-pnpm install install-frozen \
	dev dev-web start \
	build build-web build-desktop \
	typecheck test test-watch coverage e2e verify audit ci \
	package package-dir smoke release open-package \
	clean clean-all

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
PNPM ?= pnpm
PACKAGED_APP := $(ROOT)/release/mac-arm64/Voidra.app

BLUE := $(shell printf '\033[34m')
GREEN := $(shell printf '\033[32m')
YELLOW := $(shell printf '\033[33m')
RESET := $(shell printf '\033[0m')

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

help:
	@echo ""
	@echo "$(BLUE)Setup$(RESET)"
	@echo "  $(GREEN)install$(RESET)             Install dependencies with $(YELLOW)pnpm install$(RESET)"
	@echo "  $(GREEN)install-frozen$(RESET)      Install exactly from $(YELLOW)pnpm-lock.yaml$(RESET)"
	@echo ""
	@echo "$(BLUE)Development$(RESET)"
	@echo "  $(GREEN)dev$(RESET)                 Build and launch the Electron application"
	@echo "  $(GREEN)dev-web$(RESET)             Run the renderer-only Next.js development server"
	@echo "  $(GREEN)start$(RESET)               Build and launch Electron using the production export"
	@echo ""
	@echo "$(BLUE)Build$(RESET)"
	@echo "  $(GREEN)build$(RESET)               Build the static renderer and desktop processes"
	@echo "  $(GREEN)build-web$(RESET)           Build only the static Next.js renderer"
	@echo "  $(GREEN)build-desktop$(RESET)       Build only Electron, preload, and the local service"
	@echo ""
	@echo "$(BLUE)Quality$(RESET)"
	@echo "  $(GREEN)typecheck$(RESET)           Run strict TypeScript checks"
	@echo "  $(GREEN)test$(RESET)                Run unit and storage integration tests"
	@echo "  $(GREEN)test-watch$(RESET)          Run Vitest in watch mode"
	@echo "  $(GREEN)coverage$(RESET)            Run tests with enforced coverage thresholds"
	@echo "  $(GREEN)e2e$(RESET)                 Build and run the real-Electron Playwright suite"
	@echo "  $(GREEN)verify$(RESET)              Run typecheck, tests, build, and Electron E2E"
	@echo "  $(GREEN)audit$(RESET)               Check all dependencies for known vulnerabilities"
	@echo "  $(GREEN)ci$(RESET)                  Run the complete local CI sequence, including package smoke"
	@echo ""
	@echo "$(BLUE)Packaging ($(RESET)Apple Silicon development build$(BLUE))$(RESET)"
	@echo "  $(GREEN)package$(RESET)              Create $(YELLOW)release/mac-arm64/Voidra.app$(RESET)"
	@echo "  $(GREEN)smoke$(RESET)                Smoke-test the existing packaged application"
	@echo "  $(GREEN)release$(RESET)              Package, then smoke-test the resulting application"
	@echo "  $(GREEN)open-package$(RESET)         Open the existing packaged application on macOS"
	@echo ""
	@echo "$(BLUE)Cleanup$(RESET)"
	@echo "  $(GREEN)clean$(RESET)                Remove generated builds, reports, and coverage"
	@echo "  $(GREEN)clean-all$(RESET)            Also remove $(YELLOW)node_modules$(RESET)"
	@echo ""

require-pnpm:
	@command -v "$(PNPM)" >/dev/null 2>&1 || (echo "$(YELLOW)pnpm is required. Enable Corepack or install pnpm 10.30.3.$(RESET)" && exit 1)

install: require-pnpm
	@cd "$(ROOT)" && $(PNPM) install

install-frozen: require-pnpm
	@cd "$(ROOT)" && $(PNPM) install --frozen-lockfile

dev start: require-pnpm
	@cd "$(ROOT)" && $(PNPM) start

dev-web: require-pnpm
	@cd "$(ROOT)" && $(PNPM) dev:web

build: require-pnpm
	@cd "$(ROOT)" && $(PNPM) build

build-web: require-pnpm
	@cd "$(ROOT)" && $(PNPM) build:web

build-desktop: require-pnpm
	@cd "$(ROOT)" && $(PNPM) build:desktop

typecheck: require-pnpm
	@cd "$(ROOT)" && $(PNPM) typecheck

test: require-pnpm
	@cd "$(ROOT)" && $(PNPM) test

test-watch: require-pnpm
	@cd "$(ROOT)" && $(PNPM) test:watch

coverage: require-pnpm
	@cd "$(ROOT)" && $(PNPM) test:coverage

e2e: require-pnpm
	@cd "$(ROOT)" && $(PNPM) test:e2e

verify: require-pnpm
	@cd "$(ROOT)" && $(PNPM) verify

audit: require-pnpm
	@cd "$(ROOT)" && $(PNPM) audit

ci: require-pnpm
	@cd "$(ROOT)" && $(PNPM) typecheck
	@cd "$(ROOT)" && $(PNPM) test:coverage
	@cd "$(ROOT)" && $(PNPM) test:e2e
	@cd "$(ROOT)" && $(PNPM) package:dir
	@cd "$(ROOT)" && $(PNPM) smoke:package

package package-dir: require-pnpm
	@cd "$(ROOT)" && $(PNPM) package:dir

smoke: require-pnpm
	@test -x "$(PACKAGED_APP)/Contents/MacOS/Voidra" || (echo "$(YELLOW)Package missing. Run make package first.$(RESET)" && exit 1)
	@cd "$(ROOT)" && $(PNPM) smoke:package

release: require-pnpm
	@$(MAKE) package
	@$(MAKE) smoke

open-package:
	@test "$$(uname -s)" = "Darwin" || (echo "$(YELLOW)open-package is available only on macOS.$(RESET)" && exit 1)
	@test -d "$(PACKAGED_APP)" || (echo "$(YELLOW)Package missing. Run make package first.$(RESET)" && exit 1)
	@open "$(PACKAGED_APP)"

clean:
	@rm -rf -- "$(ROOT)/.next" "$(ROOT)/out" "$(ROOT)/dist" "$(ROOT)/release" "$(ROOT)/coverage" "$(ROOT)/playwright-report" "$(ROOT)/test-results"

clean-all: clean
	@rm -rf -- "$(ROOT)/node_modules"
