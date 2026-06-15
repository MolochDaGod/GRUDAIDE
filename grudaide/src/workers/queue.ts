/**
 * GRUDAIDE - Task Queue
 * Priority queue for distributing work to AI workers
 */

import { createLogger } from "../utils/logger";
import { generateId, formatDate } from "../utils/helpers";
import { Task, TaskStatus, WorkerTrigger } from "./types";

const logger = createLogger("task-queue");

export interface EnqueueOptions {
  workerId: string;
  trigger: WorkerTrigger;
  payload?: Record<string, unknown>;
  /** Higher numbers = higher priority (default 0) */
  priority?: number;
}

// ─── Simple in-process concurrency limiter ────────────────────────────────

interface QueueItem {
  fn: () => Promise<void>;
  priority: number;
}

class ConcurrencyQueue {
  private running = 0;
  private readonly items: QueueItem[] = [];

  constructor(private readonly concurrency: number) {}

  add(fn: () => Promise<void>, options?: { priority?: number }): void {
    this.items.push({ fn, priority: options?.priority ?? 0 });
    this.items.sort((a, b) => b.priority - a.priority);
    void this.tick();
  }

  private async tick(): Promise<void> {
    while (this.running < this.concurrency && this.items.length > 0) {
      // Non-null assertion is safe: we checked length > 0
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const item = this.items.shift()!;
      this.running++;
      item.fn().finally(() => {
        this.running--;
        void this.tick();
      });
    }
  }

  get size(): number {
    return this.items.length;
  }

  get pending(): number {
    return this.running;
  }

  clear(): void {
    this.items.length = 0;
  }

  async onIdle(): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.running === 0 && this.items.length === 0) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }
}

// ─── TaskQueue ────────────────────────────────────────────────────────────

export class TaskQueue {
  private readonly queue: ConcurrencyQueue;
  private readonly tasks = new Map<string, Task>();

  constructor(concurrency = 10) {
    this.queue = new ConcurrencyQueue(concurrency);
  }

  /**
   * Add a task to the queue and return its ID.
   */
  enqueue(options: EnqueueOptions): string {
    const id = generateId("task");
    const task: Task = {
      id,
      workerId: options.workerId,
      trigger: options.trigger,
      payload: options.payload ?? {},
      status: "pending",
      priority: options.priority ?? 0,
      createdAt: formatDate(),
      attempts: 0,
    };

    this.tasks.set(id, task);

    this.queue.add(
      async () => {
        const stored = this.tasks.get(id);
        if (!stored || stored.status === "cancelled") return;

        stored.status = "running";
        stored.startedAt = formatDate();
        stored.attempts++;

        logger.info(`Task ${id} started (attempt ${stored.attempts})`, {
          workerId: stored.workerId,
          trigger: stored.trigger,
        });
      },
      { priority: options.priority ?? 0 }
    );

    logger.debug(`Task ${id} enqueued`, { workerId: options.workerId });
    return id;
  }

  /**
   * Update task status and optional result/error.
   */
  complete(
    taskId: string,
    result: unknown,
    status: Extract<TaskStatus, "completed" | "failed"> = "completed"
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = status;
    task.completedAt = formatDate();
    if (status === "completed") {
      task.result = result;
    } else {
      task.error = result instanceof Error ? result.message : String(result);
    }
    logger.info(`Task ${taskId} ${status}`);
  }

  /** Cancel a pending task. */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "pending") return false;
    task.status = "cancelled";
    logger.info(`Task ${taskId} cancelled`);
    return true;
  }

  /** Get a task by ID. */
  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /** List tasks, optionally filtered by status. */
  list(status?: TaskStatus): Task[] {
    const all = Array.from(this.tasks.values());
    return status ? all.filter((t) => t.status === status) : all;
  }

  /** Current queue size (pending + running). */
  get size(): number {
    return this.queue.size + this.queue.pending;
  }

  /** Whether the queue is currently empty and idle. */
  get isIdle(): boolean {
    return this.queue.size === 0 && this.queue.pending === 0;
  }

  /** Wait until all currently queued tasks have been picked up. */
  async drain(): Promise<void> {
    await this.queue.onIdle();
  }

  /** Clear all tasks and reset the queue. */
  clear(): void {
    this.queue.clear();
    this.tasks.clear();
    logger.info("Task queue cleared");
  }
}
