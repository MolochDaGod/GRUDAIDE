/**
 * GRUDAIDE - Main GitHub App Entry Point
 * Wires together the GitHub App server, webhook dispatcher, and worker registry
 */

import * as http from "http";
import express, { Request, Response, NextFunction } from "express";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

import { loadConfig } from "./config/manager";
import { createLogger } from "./utils/logger";
import { createWebhookHandler } from "./webhooks/handler";
import { getRegistry } from "./workers/registry";
import { GitHubStorage } from "./storage/github-storage";
import { StateManager } from "./storage/state-manager";

const logger = createLogger("app");

// ─── Simple in-memory rate limiter ──────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createRateLimiter(maxRequests: number, windowMs: number) {
  const store = new Map<string, RateLimitEntry>();

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const key =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "unknown";

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    entry.count++;
    next();
  };
}

export interface GrudaideApp {
  server: http.Server;
  registry: ReturnType<typeof getRegistry>;
  storage?: GitHubStorage;
  state?: StateManager;
  shutdown: () => Promise<void>;
}

/**
 * Bootstrap and start the GRUDAIDE application.
 */
export async function createApp(configPath?: string): Promise<GrudaideApp> {
  const config = loadConfig(configPath);

  logger.info("Bootstrapping GRUDAIDE…", {
    environment: config.deployment?.environment ?? "development",
    port: config.server.port,
  });

  // ─── Octokit client ──────────────────────────────────────────────────────

  let octokit: Octokit | undefined;
  if (config.github.appId && config.github.privateKey) {
    const installationId = config.github.installationId
      ? parseInt(config.github.installationId, 10)
      : undefined;

    octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: parseInt(config.github.appId, 10),
        privateKey: config.github.privateKey,
        ...(installationId ? { installationId } : {}),
      },
    });
    logger.info("GitHub App client initialised");
  } else {
    logger.warn(
      "GitHub App credentials not configured — storage and GitHub API features disabled"
    );
  }

  // ─── Storage layer ───────────────────────────────────────────────────────

  let storage: GitHubStorage | undefined;
  let state: StateManager | undefined;

  if (octokit && config.storage?.owner && config.storage?.repo) {
    storage = new GitHubStorage(octokit, {
      owner: config.storage.owner,
      repo: config.storage.repo,
      issueDataLabel: config.storage.issueDataLabel ?? "grudaide:data",
      stateLabel: config.storage.stateLabel ?? "grudaide:state",
      dataPrefix: config.storage.dataPrefix ?? "grudaide/",
    });
    state = new StateManager(storage);
    logger.info("GitHub storage layer initialised");
  }

  // ─── Worker registry ─────────────────────────────────────────────────────

  const registry = getRegistry(10);

  // Register workers from config
  for (const workerConfig of config.workers) {
    logger.info(`Worker from config registered: ${workerConfig.id}`, {
      type: workerConfig.type,
    });
  }

  await registry.initializeAll();

  // ─── Express server ───────────────────────────────────────────────────────

  const app = express();

  // Health endpoint
  app.get(config.server.healthPath, (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      workers: registry.healthReport(),
      timestamp: new Date().toISOString(),
    });
  });

  // Webhook endpoint — rate-limited to 100 requests per minute per IP
  const webhookRateLimit = createRateLimiter(100, 60_000);
  const webhookHandler = createWebhookHandler({
    secret: config.github.webhookSecret,
    registry,
  });

  app.post(config.server.webhookPath, webhookRateLimit, (req: Request, res: Response) => {
    webhookHandler(req, res).catch((err: unknown) => {
      logger.error("Unhandled error in webhook handler", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  });

  // ─── Start listening ─────────────────────────────────────────────────────

  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(config.server.port, config.server.host, resolve);
    server.once("error", reject);
  });

  logger.info(`GRUDAIDE listening on ${config.server.host}:${config.server.port}`, {
    webhookPath: config.server.webhookPath,
    healthPath: config.server.healthPath,
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down GRUDAIDE…");
    await registry.stopAll();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    logger.info("GRUDAIDE shutdown complete");
  };

  process.once("SIGTERM", () => shutdown().catch(logger.error));
  process.once("SIGINT", () => shutdown().catch(logger.error));

  return { server, registry, storage, state, shutdown };
}

// ─── CLI entry point ──────────────────────────────────────────────────────

if (require.main === module) {
  createApp().catch((err) => {
    logger.error("Failed to start GRUDAIDE", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
