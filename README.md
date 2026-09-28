# AI Data Intelligence Platform

Transform natural language prompts into verified n8n workflows. This platform separates LLM reasoning from deterministic validation, ensuring workflows are verifiable, secure, and maintainable.

## Overview

The AI Data Intelligence Platform implements a three-phase architecture:

1. **PLAN** - LLM-based planning using Intake Agent and Workflow Planner
2. **VERIFY** - Deterministic validation with structural checks, compilation, and contract verification
3. **RUN** - Deployment and execution with sandbox testing and observability

## Features

- **Natural Language to Workflow** - Convert user prompts into structured n8n workflows
- **Deterministic Validation** - Property-based testing ensures correctness
- **Capability Vocabulary** - 11 step types for data processing workflows
- **Provenance Tracking** - Full traceability of data sources and transformations
- **Fault Tolerance** - Automatic retries and degraded mode handling
- **Observability** - Real-time workflow monitoring and status tracking

## Tech Stack

- **Runtime**: Node.js >= 18.0.0
- **Language**: TypeScript with strict mode
- **Testing**: Jest with fast-check for property-based testing
- **Workflow Engine**: n8n API
- **Database**: PostgreSQL (production) / SQLite (development)

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd n8n-agent

# Install dependencies
npm install

# Build the project
npm run build

# Run linting
npm run lint

# Format code
npm run format
```

## Project Structure

```
src/
├── core/           # Core type definitions and schemas
├── plan/           # LLM-based planning components
├── verify/         # Deterministic validation pipeline
├── run/            # Execution and deployment
├── observability/  # Monitoring and metrics
└── dashboard/      # UI interface types
```

## Configuration

Create a `.env` file in the root directory:

```env
# LLM Configuration
LLM_ENDPOINT=https://api.openai.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4

# n8n Configuration
N8N_API_URL=https://your-n8n-instance.com
N8N_API_KEY=your-api-key

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_data_platform

# Platform Settings
PLATFORM_TIMEOUT_INTAKE_MS=30000
PLATFORM_TIMEOUT_PLANNER_MS=30000
PLATFORM_MAX_EXPORT_RECORDS=1000000
PLATFORM_MAX_EXPORT_SIZE_MB=500
```

## Usage

### From TypeScript

```typescript
import { PlatformOrchestrator } from '@core/index.js';

const orchestrator = new PlatformOrchestrator({
  llmEndpoint: process.env.LLM_ENDPOINT!,
  n8nApiUrl: process.env.N8N_API_URL!,
});

const result = await orchestrator.processPrompt('Find all customers in California with orders over $1000');
console.log(result);
```

### CLI Interface

```bash
# Process a prompt
npx ts-node src/cli/index.ts --prompt "Find all customers in California"

# View execution status
npx ts-node src/cli/index.ts --status <execution_id>

# Deploy workflow
npx ts-node src/cli/index.ts --deploy <workflow_id>
```

## Development

### Running Tests

```bash
# Unit tests
npm run test

# Property-based tests
npm run test:properties

# All tests
npm run test:all
```

### Code Quality

```bash
# Lint check
npm run lint

# Lint with fixes
npm run lint:fix

# Format check
npm run format:check

# Format all files
npm run format

# Full check (lint + format + build)
npm run check
```

### Build

```bash
# Build for production
npm run build

# Watch mode for development
npx tsc --watch
```

## Documentation

- [Architecture Overview](docs/architecture.md)
- [Capability Vocabulary](docs/capabilities.md)
- [IR Schema](docs/ir-schema.md)
- [API Reference](docs/api.md)

## License

MIT
