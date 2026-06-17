import express, { Request, Response, NextFunction } from 'express';
import { createNodeMiddleware } from '@octokit/webhooks';
import { GrudaideConfig } from './config';
import { WebhookRouter } from './webhooks/router';
import { DeploymentManager } from './deployment/manager';
import { DeploymentStatus } from './deployment/types';
import { TaskQueue } from './queue/task-queue';
import { WorkerRegistry } from './workers/registry';
import { WorkerExecutor } from './workers/executor';
import { WorkerHealthMonitor } from './workers/health';
import { initLogger, getLogger } from './utils';

export interface AppServices {
  config: GrudaideConfig;
  taskQueue: TaskQueue;
  workerRegistry: WorkerRegistry;
  workerExecutor: WorkerExecutor;
  healthMonitor: WorkerHealthMonitor;
  deploymentManager: DeploymentManager;
  webhookRouter: WebhookRouter;
}

/**
 * Build and wire up all GRUDAIDE services.
 */
export function createServices(config: GrudaideConfig): AppServices {
  initLogger(config);

  const taskQueue = new TaskQueue(config.taskQueueMaxSize);

  const workerRegistry = new WorkerRegistry({ maxWorkers: config.maxConcurrentWorkers * 10 });

  const workerExecutor = new WorkerExecutor(taskQueue, workerRegistry, {
    maxConcurrentWorkers: config.maxConcurrentWorkers,
    defaultTimeoutMs: config.workerTimeoutMs,
    autoRecovery: config.autoRecovery,
  });

  const healthMonitor = new WorkerHealthMonitor(workerExecutor, workerRegistry, config);

  const deploymentManager = new DeploymentManager({
    maxConcurrent: 3,
    defaultTimeoutMs: config.workerTimeoutMs,
  });

  const webhookRouter = new WebhookRouter({
    secret: config.webhookSecret,
    queue: taskQueue,
    deploymentManager,
  });

  return {
    config,
    taskQueue,
    workerRegistry,
    workerExecutor,
    healthMonitor,
    deploymentManager,
    webhookRouter,
  };
}

/**
 * Create the Express application with all middleware and routes.
 */
export function createApp(services: AppServices): express.Application {
  const app = express();
  const logger = getLogger();

  // Webhook endpoint (must come before json body parser to access raw body)
  app.use(
    '/webhooks',
    createNodeMiddleware(services.webhookRouter.webhooks, { path: '/webhooks' }),
  );

  app.use(express.json());

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    const stats = services.workerRegistry.stats();
    const queueStats = services.taskQueue.stats();
    res.json({
      status: 'ok',
      environment: services.config.environment,
      workers: stats,
      queue: queueStats,
      timestamp: new Date().toISOString(),
    });
  });

  // Worker endpoints
  app.get('/workers', (_req: Request, res: Response) => {
    const workers = services.workerRegistry.list();
    res.json({ workers });
  });

  app.get('/workers/:id', (req: Request, res: Response) => {
    try {
      const worker = services.workerRegistry.get(String(req.params['id']));
      res.json(worker);
    } catch {
      res.status(404).json({ error: 'Worker not found' });
    }
  });

  // Queue endpoints
  app.get('/queue', (_req: Request, res: Response) => {
    res.json({
      stats: services.taskQueue.stats(),
      pending: services.taskQueue.listPending().slice(0, 20),
      active: services.taskQueue.listActive(),
    });
  });

  app.post('/queue/tasks', (req: Request, res: Response) => {
    try {
      const { type, payload, priority, timeoutMs, maxAttempts } = req.body as {
        type: string;
        payload: Record<string, unknown>;
        priority?: string;
        timeoutMs?: number;
        maxAttempts?: number;
      };

      if (!type || !payload) {
        res.status(400).json({ error: 'Missing required fields: type, payload' });
        return;
      }

      const task = services.taskQueue.enqueue({
        type,
        payload,
        priority: (priority as 'critical' | 'high' | 'normal' | 'low') ?? 'normal',
        timeoutMs,
        maxAttempts,
        metadata: { source: 'api' },
      });

      res.status(201).json(task);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Deployment endpoints
  app.get('/deployments', (req: Request, res: Response) => {
    const { status, repo } = req.query as { status?: string; repo?: string };
    const records = services.deploymentManager.listRecords({
      status: status as DeploymentStatus | undefined,
      repo,
    });
    res.json({ deployments: records, stats: services.deploymentManager.stats() });
  });

  app.get('/deployments/:id', (req: Request, res: Response) => {
    try {
      const record = services.deploymentManager.getRecord(String(req.params['id']));
      res.json(record);
    } catch {
      res.status(404).json({ error: 'Deployment not found' });
    }
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled request error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

/**
 * Start the GRUDAIDE server.
 */
export async function startServer(config: GrudaideConfig): Promise<void> {
  const services = createServices(config);
  const app = createApp(services);
  const logger = getLogger();

  // Start background services
  services.workerExecutor.start();
  services.healthMonitor.start();

  const server = app.listen(config.port, () => {
    logger.info('GRUDAIDE server started', {
      port: config.port,
      environment: config.environment,
      maxWorkers: config.maxConcurrentWorkers,
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down GRUDAIDE server...');
    services.workerExecutor.stop();
    services.healthMonitor.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}
