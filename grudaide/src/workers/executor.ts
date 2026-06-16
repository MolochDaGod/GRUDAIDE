import { AIWorker, Task, WorkerHealthCheck, WorkerMetrics } from './types';
import { TaskQueue } from '../queue/task-queue';
import { WorkerRegistry } from './registry';
import {
  GrudaideWorkerError,
  GrudaideNotFoundError,
  withTimeout,
  getLogger,
  getErrorMessage,
} from '../utils';

export interface ExecutorOptions {
  maxConcurrentWorkers?: number;
  defaultTimeoutMs?: number;
  autoRecovery?: boolean;
}

interface ActiveExecution {
  task: Task;
  worker: AIWorker;
  startedAt: Date;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * Task Executor – coordinates dispatching tasks from the queue to workers.
 * Handles concurrency limits, timeouts, and error recovery.
 */
export class WorkerExecutor {
  private readonly queue: TaskQueue;
  private readonly registry: WorkerRegistry;
  private readonly maxConcurrent: number;
  private readonly defaultTimeoutMs: number;
  private readonly autoRecovery: boolean;
  private readonly executions = new Map<string, ActiveExecution>();
  /** Per-worker rolling history of task durations (last 100). */
  private readonly durationHistory = new Map<string, number[]>();
  private dispatchInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(queue: TaskQueue, registry: WorkerRegistry, options: ExecutorOptions = {}) {
    this.queue = queue;
    this.registry = registry;
    this.maxConcurrent = options.maxConcurrentWorkers ?? 10;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300000;
    this.autoRecovery = options.autoRecovery ?? true;
  }

  /**
   * Start the executor dispatch loop.
   */
  start(intervalMs = 500): void {
    if (this.running) return;
    this.running = true;
    this.dispatchInterval = setInterval(() => this.dispatch(), intervalMs);
    getLogger().info('WorkerExecutor started', { maxConcurrent: this.maxConcurrent });
  }

  /**
   * Stop the executor.
   */
  stop(): void {
    this.running = false;
    if (this.dispatchInterval) {
      clearInterval(this.dispatchInterval);
      this.dispatchInterval = undefined;
    }
    // Cancel timeout handles
    for (const exec of this.executions.values()) {
      clearTimeout(exec.timeoutHandle);
    }
    getLogger().info('WorkerExecutor stopped');
  }

  /**
   * Dispatch pending tasks to idle workers.
   */
  async dispatch(): Promise<void> {
    if (this.executions.size >= this.maxConcurrent) return;
    if (this.queue.pendingCount === 0) return;

    const idleWorkers = this.registry
      .list()
      .filter((r) => r.state.status === 'idle' && r.metadata.id)
      .map((r) => r.metadata.id);

    for (const workerId of idleWorkers) {
      if (this.executions.size >= this.maxConcurrent) break;
      if (this.queue.pendingCount === 0) break;

      const task = this.queue.dequeue();
      if (!task) break;

      const workerInstance = this.registry.getWorkerInstance(workerId);
      if (!workerInstance) {
        // Re-queue if no instance bound
        this.queue.fail(task.id, 'No worker instance bound');
        continue;
      }

      this.queue.markRunning(task.id, workerId);
      this.registry.setStatus(workerId, 'running');
      this.registry.updateState(workerId, { currentTaskId: task.id });

      void this.executeTask(task, workerInstance, workerId);
    }
  }

  /**
   * Execute a single task on a worker.
   */
  private async executeTask(task: Task, worker: AIWorker, workerId: string): Promise<void> {
    const timeoutMs = task.timeoutMs ?? this.defaultTimeoutMs;

    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(task.id, workerId);
    }, timeoutMs);

    this.executions.set(task.id, { task, worker, startedAt: new Date(), timeoutHandle });

    try {
      const execStartedAt = this.executions.get(task.id)?.startedAt;
      const result = await withTimeout(
        () => worker.execute(task),
        timeoutMs,
        `Task ${task.id}`,
      );

      const durationMs = execStartedAt ? Date.now() - execStartedAt.getTime() : 0;
      clearTimeout(timeoutHandle);
      this.executions.delete(task.id);
      this.recordDuration(workerId, durationMs);
      this.queue.complete(task.id, result);
      this.registry.setStatus(workerId, 'idle');
      this.registry.updateState(workerId, {
        currentTaskId: undefined,
        tasksCompleted: (this.registry.get(workerId).state.tasksCompleted ?? 0) + 1,
      });
      this.registry.heartbeat(workerId);
    } catch (error) {
      clearTimeout(timeoutHandle);
      this.executions.delete(task.id);

      const errMsg = getErrorMessage(error);
      const requeued = this.queue.fail(task.id, errMsg);

      if (!requeued) {
        this.registry.updateState(workerId, {
          tasksFailed: (this.registry.get(workerId).state.tasksFailed ?? 0) + 1,
        });
      }

      if (this.autoRecovery) {
        this.registry.setStatus(workerId, 'idle', errMsg);
      } else {
        this.registry.setStatus(workerId, 'error', errMsg);
      }
    }
  }

  private handleTimeout(taskId: string, workerId: string): void {
    const exec = this.executions.get(taskId);
    if (!exec) return;
    this.executions.delete(taskId);

    getLogger().warn('Task timed out', { taskId, workerId });
    this.queue.fail(taskId, 'Task timed out');
    this.registry.setStatus(workerId, this.autoRecovery ? 'idle' : 'error', 'Task timed out');
  }

  /**
   * Run health checks on all registered workers.
   */
  async runHealthChecks(): Promise<WorkerHealthCheck[]> {
    const results: WorkerHealthCheck[] = [];
    for (const registration of this.registry.list()) {
      const instance = this.registry.getWorkerInstance(registration.metadata.id);
      if (!instance) continue;

      try {
        const check = await withTimeout(
          () => instance.healthCheck(),
          5000,
          `HealthCheck ${registration.metadata.id}`,
        );
        results.push(check);
        this.registry.heartbeat(registration.metadata.id);
      } catch (error) {
        results.push({
          workerId: registration.metadata.id,
          healthy: false,
          checkedAt: new Date(),
          details: { error: getErrorMessage(error) },
        });

        if (this.autoRecovery && registration.state.status !== 'running') {
          getLogger().warn('Worker unhealthy, attempting recovery', {
            workerId: registration.metadata.id,
          });
          try {
            this.registry.setStatus(registration.metadata.id, 'initializing');
            await instance.initialize(registration.config);
            this.registry.setStatus(registration.metadata.id, 'idle');
          } catch (recoveryError) {
            this.registry.setStatus(
              registration.metadata.id,
              'error',
              getErrorMessage(recoveryError),
            );
          }
        }
      }
    }
    return results;
  }

  /**
   * Collect metrics for a worker.
   */
  getWorkerMetrics(workerId: string): WorkerMetrics {
    const reg = this.registry.get(workerId);
    const durations = this.durationHistory.get(workerId) ?? [];
    const averageTaskDurationMs =
      durations.length > 0
        ? durations.reduce((sum, d) => sum + d, 0) / durations.length
        : 0;

    return {
      workerId,
      tasksCompleted: reg.state.tasksCompleted,
      tasksFailed: reg.state.tasksFailed,
      averageTaskDurationMs,
      uptime: reg.state.startedAt
        ? Date.now() - reg.state.startedAt.getTime()
        : 0,
      lastActivity: reg.state.lastHeartbeat ?? reg.metadata.updatedAt,
    };
  }

  private recordDuration(workerId: string, durationMs: number): void {
    let history = this.durationHistory.get(workerId);
    if (!history) {
      history = [];
      this.durationHistory.set(workerId, history);
    }
    history.push(durationMs);
    if (history.length > 100) history.shift();
  }

  /** Register a worker instance and initialize it. */
  async registerAndInitialize(worker: AIWorker, config = {}): Promise<void> {
    const workerId = worker.id;
    const existing = (() => {
      try {
        return this.registry.get(workerId);
      } catch {
        return null;
      }
    })();

    if (!existing) {
      throw new GrudaideNotFoundError(
        `Worker '${workerId}' must be registered in the registry before initializing`,
      );
    }

    this.registry.register(worker.metadata, config, worker);
    this.registry.setStatus(workerId, 'initializing');

    try {
      await worker.initialize(existing.config);
      this.registry.setStatus(workerId, 'idle');
      getLogger().info('Worker initialized and ready', { workerId });
    } catch (error) {
      this.registry.setStatus(workerId, 'error', getErrorMessage(error));
      throw new GrudaideWorkerError(
        `Failed to initialize worker '${workerId}': ${getErrorMessage(error)}`,
        { workerId },
      );
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}
