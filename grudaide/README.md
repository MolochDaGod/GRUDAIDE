# GRUDAIDE – AI Worker Deployment Platform

> **Grudge Studio's** production-ready platform for deploying, managing, and scaling AI workers integrated with GitHub.

## Overview

GRUDAIDE is the core infrastructure for Grudge Studio's agentic deployment solution. It provides:

- **GitHub App integration** – webhook handling, authentication, and event routing
- **AI Worker management** – registry, executor, health monitoring, and auto-recovery
- **Deployment orchestration** – multi-environment deployments with rollback support
- **Data persistence** – GitHub Issues as structured data storage
- **Task queue** – priority-based queue with retry logic and timeout management

---

## Quick Start

### Prerequisites
- Node.js ≥ 18
- A GitHub App (see [GitHub App Setup](#github-app-setup))

### Installation

```bash
cd grudaide
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|---|---|
| `GITHUB_APP_ID` | Your GitHub App's numeric ID |
| `GITHUB_PRIVATE_KEY` | PEM-encoded private key (newlines as `\n`) |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret for payload verification |

Optional:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `info` | Log level (`debug`/`info`/`warn`/`error`) |
| `MAX_CONCURRENT_WORKERS` | `10` | Max workers running in parallel |
| `WORKER_TIMEOUT_MS` | `300000` | Task execution timeout (ms) |
| `AUTO_RECOVERY` | `true` | Auto-restart failed workers |
| `NODE_ENV` | `development` | Environment (`development`/`staging`/`production`) |

### Run

```bash
# Development
npm run dev

# Production (build first)
npm run compile
npm start
```

---

## Architecture

```
grudaide/
├── src/
│   ├── index.ts          # Entry point & public API exports
│   ├── app.ts            # Express server + service wiring
│   ├── config/           # Environment-based configuration
│   ├── workers/
│   │   ├── types.ts      # AIWorker interface + type definitions
│   │   ├── registry.ts   # Worker registry with metadata & versioning
│   │   ├── executor.ts   # Task executor with concurrency control
│   │   └── health.ts     # Health monitor with auto-recovery
│   ├── queue/
│   │   └── task-queue.ts # Priority task queue with retry
│   ├── deployment/
│   │   ├── types.ts      # Deployment type definitions
│   │   └── manager.ts    # Multi-environment deployment manager
│   ├── webhooks/
│   │   ├── handlers.ts   # push / pull_request / issues / deployment handlers
│   │   └── router.ts     # Webhook event router
│   ├── data/
│   │   └── github-issues.ts  # GitHub Issues data storage adapter
│   └── utils/
│       ├── logger.ts     # Winston structured logger
│       └── errors.ts     # Error classes + retry/timeout utilities
├── tests/                # Jest test suites (78 tests)
└── examples/             # Reference worker implementations
```

---

## Creating an AI Worker

Implement the `AIWorker` interface:

```typescript
import { AIWorker, WorkerMetadata, WorkerConfig, WorkerHealthCheck, Task } from '@grudge-studio/grudaide';

export class MyWorker implements AIWorker {
  readonly id = 'my-worker-v1';
  readonly metadata: WorkerMetadata = {
    id: this.id,
    name: 'My Worker',
    version: '1.0.0',
    description: 'Does amazing things',
    capabilities: ['custom'],
    tags: ['my-tag'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  async initialize(config: WorkerConfig): Promise<void> {
    // Set up AI client, load models, warm caches
  }

  async execute(task: Task): Promise<Record<string, unknown>> {
    // Process the task and return the result
    return { status: 'done', result: 'your-output' };
  }

  async healthCheck(): Promise<WorkerHealthCheck> {
    return { workerId: this.id, healthy: true, checkedAt: new Date() };
  }

  async shutdown(): Promise<void> {
    // Clean up resources
  }
}
```

See [`examples/code-review-worker.ts`](examples/code-review-worker.ts) for a complete example.

---

## Registering & Running Workers

```typescript
import { createServices, loadConfig } from '@grudge-studio/grudaide';
import { MyWorker } from './my-worker';

const config = loadConfig();
const services = createServices(config);

// Register the worker
const worker = new MyWorker();
services.workerRegistry.register(worker.metadata, { timeoutMs: 60000 }, worker);
services.workerRegistry.setStatus(worker.id, 'initializing');
await worker.initialize({ timeoutMs: 60000 });
services.workerRegistry.setStatus(worker.id, 'idle');

// Start the executor
services.workerExecutor.start();

// Enqueue tasks
services.taskQueue.enqueue({
  type: 'custom',
  payload: { data: 'process this' },
  priority: 'high',
});
```

---

## Deployment

```typescript
import { DeploymentManager } from '@grudge-studio/grudaide';

const manager = new DeploymentManager();
const record = await manager.deploy({
  id: 'deploy-001',
  owner: 'grudge-studio',
  repo: 'my-service',
  target: { environment: 'staging', ref: 'main' },
  rollbackOnFailure: true,
  timeoutMs: 300000,
}, 'ci-bot');

console.log(record.status); // 'success'
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check + worker/queue stats |
| `GET` | `/workers` | List all registered workers |
| `GET` | `/workers/:id` | Get a specific worker |
| `GET` | `/queue` | Queue stats + pending/active tasks |
| `POST` | `/queue/tasks` | Enqueue a task manually |
| `GET` | `/deployments` | List deployments (filterable) |
| `GET` | `/deployments/:id` | Get a specific deployment |
| `POST` | `/webhooks` | GitHub webhook endpoint |

---

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Type-check
npx tsc --noEmit

# Coverage
npm run test:coverage
```

---

## GitHub App Setup

1. Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**
2. Set the webhook URL to `https://your-server/webhooks`
3. Generate a private key and download it
4. Set permissions: Issues (R/W), Pull requests (R/W), Deployments (R/W), Contents (R)
5. Subscribe to events: Push, Pull request, Issues, Deployment
6. Add credentials to your `.env` file

---

## License

AGPL-3.0 – see [LICENSE-AGPL](../LICENSE-AGPL)
