# GRUDAIDE Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         GRUDAIDE                                 │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  Express     │    │   Webhook    │    │  Worker Registry │  │
│  │  HTTP Server │───▶│   Handler   │───▶│  (Singleton)     │  │
│  │  /webhooks   │    │  (HMAC-256) │    │                  │  │
│  │  /health     │    └──────────────┘    │  ┌───────────┐  │  │
│  └──────────────┘                        │  │ Worker A  │  │  │
│                                          │  ├───────────┤  │  │
│  ┌──────────────┐    ┌──────────────┐   │  │ Worker B  │  │  │
│  │  Config Mgr  │    │  Task Queue  │◀──│  ├───────────┤  │  │
│  │  (Zod schema)│    │ (Concurrency │   │  │ Worker C  │  │  │
│  │  .env + YAML │    │  Limiter)    │   │  └───────────┘  │  │
│  └──────────────┘    └──────────────┘   └──────────────────┘  │
│                                                                  │
│  ┌──────────────────┐    ┌───────────────────────────────────┐ │
│  │  GitHub Storage  │    │  Deployment Orchestrator          │ │
│  │  (Issues as DB)  │    │  ┌────────┐ ┌──────┐ ┌───────┐  │ │
│  │  ┌────────────┐  │    │  │Install │▶│Build │▶│Deploy │  │ │
│  │  │DataRecord  │  │    │  └────────┘ └──────┘ └───────┘  │ │
│  │  │StateManager│  │    │  npm Environment Manager         │ │
│  │  └────────────┘  │    └───────────────────────────────────┘ │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
           │                           │
           ▼                           ▼
   GitHub Issues API           npm registry / projects
```

## Component Descriptions

### HTTP Server (`src/app.ts`)
Express-based HTTP server with two endpoints:
- `POST /webhooks` — receives and dispatches GitHub webhook events
- `GET /health` — returns uptime and worker health report

### Webhook Handler (`src/webhooks/handler.ts`)
- Verifies `X-Hub-Signature-256` HMAC using constant-time comparison
- Parses the event name and dispatches to matching workers via `registry.broadcast()`
- Returns `200 OK` immediately; worker execution is asynchronous

### Configuration Manager (`src/config/manager.ts`)
- Loads from a YAML/JSON config file and merges environment variables
- Environment variables always take precedence over file values
- Validates the merged config against Zod schemas
- Caches the parsed config after first load

### Worker Registry (`src/workers/registry.ts`)
- Central singleton registry for all AI workers
- Supports registration, unregistration, dispatch, and broadcast
- Provides health reports for all registered workers
- Wraps execution with retry logic via `withRetry()`

### Task Queue (`src/workers/queue.ts`)
- In-process priority concurrency queue (no external dependencies)
- Tasks are sorted by priority (higher = first)
- Tracks task lifecycle: `pending → running → completed/failed/cancelled`

### Base Worker (`src/workers/base.ts`)
- Abstract base class all workers extend
- Handles status transitions, heartbeat tracking, and error recovery
- Workers implement a single `execute(context: WorkerContext)` method

### GitHub Storage (`src/storage/github-storage.ts`)
- Persists structured JSON data as GitHub Issues
- Issues are tagged with `grudaide:data` label
- Data is embedded in fenced JSON blocks within the issue body
- Supports get, set (upsert), delete, and listKeys

### State Manager (`src/storage/state-manager.ts`)
- Higher-level key-value state management on top of `GitHubStorage`
- Supports `getState`, `setState`, `patchState`, `deleteState`, `listStates`

### Deployment Orchestrator (`src/deployment/orchestrator.ts`)
- Coordinates install → test → build → publish → health-check pipeline
- Tracks deployment records with phase, logs, and rollback info
- Automatic rollback on failure (configurable)

### npm Environment Manager (`src/deployment/npm-manager.ts`)
- Wraps `npm` CLI for install, test, build, publish, version bump
- Supports per-project custom registries and auth tokens

## Data Flow: Webhook → Worker

```
GitHub Event
    │
    ▼
POST /webhooks
    │
    ▼
verifySignature (HMAC-SHA256)
    │
    ▼
registry.broadcast(trigger, payload)
    │
    ├──▶ Worker A.run(context)
    ├──▶ Worker B.run(context)
    └──▶ Worker C.run(context)
              │
              ▼
         withRetry(execute)
              │
         task queue
              │
         complete/fail
```

## Security Considerations

- All incoming webhooks are verified with HMAC-SHA256 constant-time comparison
- Private keys and secrets are never logged
- Deployment credentials are passed via environment variables / GitHub Secrets
- Storage labels prevent accidental data contamination
