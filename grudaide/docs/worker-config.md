# Worker Configuration Reference

All worker configuration is validated against the `WorkerConfigSchema` (Zod).

## Fields

| Field         | Type      | Default     | Description                                                  |
|---------------|-----------|-------------|--------------------------------------------------------------|
| `id`          | `string`  | required    | Unique identifier for the worker                            |
| `name`        | `string`  | required    | Human-readable display name                                  |
| `type`        | `enum`    | required    | One of: `deployment`, `monitoring`, `automation`, `data-sync`, `custom` |
| `enabled`     | `boolean` | `true`      | Whether the worker accepts new tasks                        |
| `concurrency` | `number`  | `5`         | Max concurrent tasks (1–50)                                  |
| `retryLimit`  | `number`  | `3`         | Max retries per task (0–10)                                  |
| `retryDelay`  | `number`  | `1000`      | Initial retry backoff in ms (doubles each attempt)          |
| `timeout`     | `number`  | `30000`     | Per-task timeout in ms (1000–3600000)                        |
| `triggers`    | `string[]`| `[]`        | GitHub events that activate this worker (see below)         |
| `metadata`    | `object`  | `undefined` | Arbitrary key/value metadata                                 |

## Supported Triggers

| Trigger            | GitHub Event           |
|--------------------|------------------------|
| `push`             | Push to a branch       |
| `pull_request`     | PR opened/updated      |
| `issues`           | Issue opened/edited    |
| `issue_comment`    | Comment on an issue    |
| `deployment`       | Deployment created     |
| `deployment_status`| Deployment status update|
| `workflow_run`     | Workflow run completed |
| `schedule`         | Cron schedule (manual) |
| `manual`           | Programmatic dispatch  |

## Example: `grudaide.config.yml`

```yaml
workers:
  - id: my-deployment-worker
    name: My Deployment Worker
    type: deployment
    enabled: true
    concurrency: 3
    retryLimit: 2
    retryDelay: 5000
    timeout: 600000   # 10 minutes
    triggers:
      - push
      - deployment
    metadata:
      branch: main
      environment: production
```

## Example: Programmatic Registration

```typescript
import { BaseWorker, WorkerContext, getRegistry } from "grudaide";

class MyWorker extends BaseWorker {
  constructor() {
    super({
      id: "my-worker",
      name: "My Worker",
      type: "custom",
      enabled: true,
      concurrency: 5,
      retryLimit: 2,
      retryDelay: 1000,
      timeout: 30000,
      triggers: ["push"],
    });
  }

  async execute(context: WorkerContext): Promise<unknown> {
    const { payload } = context.task;
    this.logger.info("Handling push", { ref: payload.ref });
    return { handled: true };
  }
}

const registry = getRegistry();
registry.register(new MyWorker());
await registry.initializeAll();
```

## Health Report

Call `registry.healthReport()` or hit `GET /health` to see:

```json
[
  {
    "workerId": "my-worker",
    "status": "idle",
    "lastHeartbeat": "2026-01-01T00:00:00.000Z",
    "tasksCompleted": 42,
    "tasksFailed": 1,
    "uptime": 86400000
  }
]
```

## Worker Status Lifecycle

```
idle ──▶ running ──▶ idle
              │
              ▼
            error (auto-recovers on next task)

idle ──▶ paused ──▶ idle (resume)
idle ──▶ stopped (terminal)
```
