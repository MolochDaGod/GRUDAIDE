# GRUDAIDE Setup Guide

## Overview

GRUDAIDE transforms your GitHub repository into a production-ready GitHub App and AI worker management platform for Grudge Studio. It provides:

- **GitHub App** with verified webhook ingestion
- **AI Worker Registry** — register, dispatch, and monitor autonomous workers
- **Task Queue** — concurrent, priority-based task execution
- **Deployment Orchestrator** — full npm project lifecycle with rollback
- **GitHub Issues Data Layer** — structured key-value store backed by GitHub Issues
- **State Manager** — persistent application state via the data layer

---

## 1. Register a GitHub App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
2. Fill in:
   - **App name**: `GRUDAIDE` (or your preferred name)
   - **Homepage URL**: `https://github.com/MolochDaGod/GRUDAIDE`
   - **Webhook URL**: `https://<your-host>/webhooks`
   - **Webhook secret**: generate a strong random string
3. Set permissions:
   - **Repository**: Contents (read), Issues (read/write), Pull requests (read/write)
   - **Metadata**: Read-only
4. Subscribe to events: `push`, `pull_request`, `issues`, `issue_comment`, `deployment`, `workflow_run`
5. After creation, note your **App ID**
6. Generate and download a **private key** (PEM file)
7. Install the app on your repository

---

## 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp grudaide/.env.example grudaide/.env
```

Required variables:

| Variable                  | Description                                      |
|---------------------------|--------------------------------------------------|
| `GITHUB_APP_ID`           | Your GitHub App's numeric ID                    |
| `GITHUB_PRIVATE_KEY`      | RSA private key (escape newlines as `\n`)        |
| `GITHUB_WEBHOOK_SECRET`   | Secret set in your GitHub App webhook settings  |
| `GITHUB_OWNER`            | Repository owner (e.g. `MolochDaGod`)           |
| `GITHUB_REPO`             | Repository name (e.g. `GRUDAIDE`)               |

Set the private key as a single line by escaping newlines:

```bash
GITHUB_PRIVATE_KEY=$(cat your-app.pem | tr '\n' '\\n' | sed 's/\\n$//')
```

---

## 3. Add GitHub Actions Secrets

In your repository **Settings → Secrets and variables → Actions**, add:

| Secret                    | Value                              |
|---------------------------|------------------------------------|
| `GRUDAIDE_APP_ID`         | Your GitHub App ID                 |
| `GRUDAIDE_PRIVATE_KEY`    | Your PEM private key               |
| `GRUDAIDE_WEBHOOK_SECRET` | Your webhook secret                |

---

## 4. Install and Run

```bash
cd grudaide
npm install
npm run build
npm start
```

For local development with hot-reload:

```bash
npm run dev
```

---

## 5. Verify the Setup

Check the health endpoint:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "uptime": 12.34,
  "workers": [...],
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

---

## 6. Register a Custom Worker

```typescript
import { BaseWorker, WorkerContext, getRegistry } from "grudaide";

class MyWorker extends BaseWorker {
  constructor() {
    super({
      id: "my-worker",
      name: "My Custom Worker",
      type: "automation",
      enabled: true,
      concurrency: 5,
      retryLimit: 2,
      retryDelay: 1000,
      timeout: 30000,
      triggers: ["push"],
    });
  }

  async execute(context: WorkerContext): Promise<unknown> {
    this.logger.info("Processing event", { trigger: context.task.trigger });
    // ... your logic here
    return { success: true };
  }
}

// Register with the singleton registry
const registry = getRegistry();
registry.register(new MyWorker());
await registry.initializeAll();
```

---

## 7. Use GitHub Issues as Data Storage

```typescript
import { GitHubStorage, StateManager } from "grudaide";
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const storage = new GitHubStorage(octokit, {
  owner: "MolochDaGod",
  repo: "GRUDAIDE",
  issueDataLabel: "grudaide:data",
  stateLabel: "grudaide:state",
  dataPrefix: "grudaide/",
});

const state = new StateManager(storage);

// Save state
await state.setState("deployment", { lastDeploy: new Date().toISOString() });

// Read state
const s = await state.getState("deployment", { lastDeploy: null });
console.log(s.lastDeploy);
```

---

## Next Steps

- See [`docs/architecture.md`](./architecture.md) for system architecture
- See [`docs/worker-config.md`](./worker-config.md) for all worker options
- Browse [`examples/`](../examples/) for ready-made workers
