/**
 * GRUDAIDE - Worker Registry
 * Central registry for registering, discovering, and managing AI workers
 */

import { createLogger } from "../utils/logger";
import { WorkerError } from "../utils/errors";
import { WorkerConfig } from "../config/schema";
import { TaskQueue, EnqueueOptions } from "./queue";
import {
  IWorker,
  WorkerHealth,
  WorkerRegistryEntry,
  WorkerContext,
} from "./types";
import { generateId, formatDate } from "../utils/helpers";
import { withRetry } from "../utils/errors";

const logger = createLogger("worker-registry");

export class WorkerRegistry {
  private readonly workers = new Map<string, WorkerRegistryEntry>();
  private readonly queue: TaskQueue;

  constructor(concurrency = 10) {
    this.queue = new TaskQueue(concurrency);
  }

  /**
   * Register a worker. Throws if a worker with the same ID already exists.
   */
  register(worker: IWorker): void {
    if (this.workers.has(worker.config.id)) {
      throw new WorkerError(
        `Worker with id "${worker.config.id}" is already registered`,
        { workerId: worker.config.id }
      );
    }
    this.workers.set(worker.config.id, {
      worker,
      registeredAt: formatDate(),
    });
    logger.info(`Worker registered: ${worker.config.id}`, {
      type: worker.config.type,
      triggers: worker.config.triggers,
    });
  }

  /**
   * Unregister and stop a worker.
   */
  async unregister(workerId: string): Promise<void> {
    const entry = this.workers.get(workerId);
    if (!entry) return;
    await entry.worker.stop();
    this.workers.delete(workerId);
    logger.info(`Worker unregistered: ${workerId}`);
  }

  /**
   * Retrieve a registered worker by ID.
   */
  get(workerId: string): IWorker | undefined {
    return this.workers.get(workerId)?.worker;
  }

  /**
   * List all registered workers (optionally filtered by type).
   */
  list(type?: WorkerConfig["type"]): IWorker[] {
    const all = Array.from(this.workers.values()).map((e) => e.worker);
    return type ? all.filter((w) => w.config.type === type) : all;
  }

  /**
   * Get health status for all workers.
   */
  healthReport(): WorkerHealth[] {
    return Array.from(this.workers.values()).map((e) => e.worker.health);
  }

  /**
   * Initialise all registered workers.
   */
  async initializeAll(): Promise<void> {
    logger.info(`Initialising ${this.workers.size} worker(s)`);
    await Promise.all(
      Array.from(this.workers.values()).map(async ({ worker }) => {
        try {
          await worker.initialize();
        } catch (err) {
          logger.error(`Failed to initialise worker ${worker.config.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
  }

  /**
   * Stop all registered workers.
   */
  async stopAll(): Promise<void> {
    logger.info("Stopping all workers…");
    await Promise.all(
      Array.from(this.workers.values()).map(({ worker }) => worker.stop())
    );
    this.queue.clear();
  }

  /**
   * Dispatch a task to a specific worker with retry logic.
   */
  async dispatch(
    workerId: string,
    options: Omit<EnqueueOptions, "workerId">
  ): Promise<unknown> {
    const entry = this.workers.get(workerId);
    if (!entry) {
      throw new WorkerError(`Worker not found: ${workerId}`, { workerId });
    }
    const { worker } = entry;
    if (!worker.config.enabled) {
      throw new WorkerError(`Worker is disabled: ${workerId}`, { workerId });
    }

    const taskId = this.queue.enqueue({ workerId, ...options });
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      worker.config.timeout
    );

    const context: WorkerContext = {
      task: {
        id: taskId,
        workerId,
        trigger: options.trigger,
        payload: options.payload ?? {},
        status: "running",
        priority: options.priority ?? 0,
        createdAt: formatDate(),
        startedAt: formatDate(),
        attempts: 1,
      },
      config: worker.config,
      logger: createLogger(`worker:${workerId}:task:${taskId}`),
      signal: controller.signal,
    };

    try {
      const result = await withRetry(
        () => worker.run(context),
        {
          attempts: worker.config.retryLimit + 1,
          delay: worker.config.retryDelay,
        },
        `worker:${workerId}`
      );
      this.queue.complete(taskId, result, "completed");
      entry.lastActivity = formatDate();
      return result;
    } catch (err) {
      this.queue.complete(taskId, err, "failed");
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Broadcast a trigger event to all matching workers.
   */
  async broadcast(
    trigger: EnqueueOptions["trigger"],
    payload: Record<string, unknown>
  ): Promise<void> {
    const matchingWorkers = this.list().filter(
      (w) => w.config.enabled && w.config.triggers.includes(trigger)
    );

    logger.info(
      `Broadcasting trigger "${trigger}" to ${matchingWorkers.length} worker(s)`
    );

    await Promise.allSettled(
      matchingWorkers.map((w) =>
        this.dispatch(w.config.id, { trigger, payload })
      )
    );
  }

  get taskQueue(): TaskQueue {
    return this.queue;
  }
}

// Singleton instance
let _registry: WorkerRegistry | null = null;

export function getRegistry(concurrency?: number): WorkerRegistry {
  if (!_registry) {
    _registry = new WorkerRegistry(concurrency);
  }
  return _registry;
}

export function resetRegistry(): void {
  _registry = null;
}
