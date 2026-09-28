# AI Data Intelligence Platform - Makefile

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Project paths
PROJECT_ROOT := $(shell pwd)
SRC_DIR := $(PROJECT_ROOT)/src
DIST_DIR := $(PROJECT_ROOT)/dist
NODE_MODULES := $(PROJECT_ROOT)/node_modules

# NPM packages
NPM := npm
TSC := $(NODE_MODULES)/.bin/tsc
ESLINT := $(NODE_MODULES)/.bin/eslint
PRETTIER := $(NODE_MODULES)/.bin/prettier

# ==============================================================================
# Development
# ==============================================================================

.PHONY: install
install: ## Install dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	$(NPM) install
	@echo "$(GREEN)✓ Dependencies installed$(NC)"

.PHONY: build
build: ## Compile TypeScript to JavaScript
	@echo "$(BLUE)Building project...$(NC)"
	$(NPM) run build
	@echo "$(GREEN)✓ Build complete$(NC)"

.PHONY: watch
watch: ## Watch for changes and recompile
	@echo "$(BLUE)Watching for changes...$(NC)"
	$(TSC) --watch

.PHONY: clean
clean: ## Remove build artifacts
	@echo "$(YELLOW)Cleaning build artifacts...$(NC)"
	@rm -rf $(DIST_DIR)
	@rm -f tsconfig.tsbuildinfo
	@echo "$(GREEN)✓ Clean complete$(NC)"

.PHONY: dev
dev: install build ## Set up development environment
	@echo "$(GREEN)✓ Development environment ready$(NC)"

# ==============================================================================
# Code Quality
# ==============================================================================

.PHONY: lint
lint: ## Run ESLint on source files
	@echo "$(BLUE)Running ESLint...$(NC)"
	$(NPM) run lint
	@echo "$(GREEN)✓ Linting complete$(NC)"

.PHONY: lint-fix
lint-fix: ## Run ESLint and auto-fix issues
	@echo "$(BLUE)Running ESLint with auto-fix...$(NC)"
	$(NPM) run lint:fix
	@echo "$(GREEN)✓ Linting and fixing complete$(NC)"

.PHONY: format
format: ## Format code with Prettier
	@echo "$(BLUE)Formatting code...$(NC)"
	$(NPM) run format
	@echo "$(GREEN)✓ Formatting complete$(NC)"

.PHONY: format-check
format-check: ## Check code formatting
	@echo "$(BLUE)Checking code format...$(NC)"
	$(NPM) run format:check
	@echo "$(GREEN)✓ Format check passed$(NC)"

.PHONY: check
check: lint format-check build ## Run all checks (lint, format, build)
	@echo "$(GREEN)✓ All checks passed$(NC)"

# ==============================================================================
# Testing
# ==============================================================================

.PHONY: test
test: ## Run tests
	@echo "$(BLUE)Running tests...$(NC)"
	$(NPM) test
	@echo "$(GREEN)✓ Tests complete$(NC)"

.PHONY: test-watch
test-watch: ## Watch for changes and re-run tests
	@echo "$(BLUE)Watching tests...$(NC)"
	$(NPM) run test:watch

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report
	@echo "$(BLUE)Running tests with coverage...$(NC)"
	$(NPM) run test:coverage

# ==============================================================================
# Git Operations
# ==============================================================================

.PHONY: status
status: ## Show git status
	@echo "$(BLUE)Git Status:$(NC)"
	@git status

.PHONY: commit
commit: ## Commit changes (usage: make commit m="your message")
	@if [ -z "$(m)" ]; then \
		echo "$(RED)Error: Please provide a commit message$(NC)"; \
		echo "Usage: make commit m=\"your message\""; \
		exit 1; \
	fi
	@echo "$(BLUE)Committing changes...$(NC)"
	@git add -A
	@git commit -m "$(m)"
	@echo "$(GREEN)✓ Changes committed$(NC)"

.PHONY: push
push: ## Push changes to remote
	@echo "$(BLUE)Pushing to remote...$(NC)"
	@git push
	@echo "$(GREEN)✓ Changes pushed$(NC)"

.PHONY: pull
pull: ## Pull changes from remote
	@echo "$(BLUE)Pulling from remote...$(NC)"
	@git pull
	@echo "$(GREEN)✓ Changes pulled$(NC)"

# ==============================================================================
# Docker (for future deployment)
# ==============================================================================

.PHONY: docker-build
docker-build: ## Build Docker image
	@echo "$(BLUE)Building Docker image...$(NC)"
	docker build -t ai-data-intelligence-platform:latest .
	@echo "$(GREEN)✓ Docker image built$(NC)"

.PHONY: docker-run
docker-run: ## Run Docker container
	@echo "$(BLUE)Running Docker container...$(NC)"
	docker run -p 3000:3000 ai-data-intelligence-platform:latest

# ==============================================================================
# Documentation
# ==============================================================================

.PHONY: docs
docs: ## Generate documentation
	@echo "$(BLUE)Generating documentation...$(NC)"
	@echo "$(YELLOW)Documentation generation not yet implemented$(NC)"

# ==============================================================================
# Utility
# ==============================================================================

.PHONY: info
info: ## Show project information
	@echo "$(BLUE)Project Information:$(NC)"
	@echo "  Project: AI Data Intelligence Platform"
	@echo "  Source:  $(SRC_DIR)"
	@echo "  Build:   $(DIST_DIR)"
	@echo "  Node:    $(shell node --version)"
	@echo "  NPM:     $(shell npm --version)"
	@echo "  TypeScript: $(shell $(TSC) --version 2>/dev/null || echo 'not installed')"

.PHONY: help
help: ## Show this help message
	@echo ""
	@echo "$(BLUE)AI Data Intelligence Platform - Makefile Commands$(NC)"
	@echo ""
	@echo "$(GREEN)Usage:$(NC)"
	@echo "  make [target]"
	@echo ""
	@echo "$(GREEN)Targets:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
