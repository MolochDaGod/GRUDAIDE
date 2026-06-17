import { Task, TaskStatus, TaskPriority } from '../workers/types';
import { GrudaideValidationError, GrudaideNotFoundError, getLogger } from '../utils';
import { randomUUID } from 'crypto';

export interface CreateTaskOptions {
  type: string;
  payload: Record<string, unknown>;
  priority?: TaskPriority;
  timeoutMs?: number;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * In-memory task queue with priority ordering and lifecycle management.
 */
export class TaskQueue {
  private readonly pending: Task[] = [];
  private readonly active = new Map<string, Task>();
  private readonly completed = new Map<string, Task>();
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Enqueue a new task. Returns the created Task object.
   */
  enqueue(options: CreateTaskOptions): Task {
    if (this.pending.length + this.active.size >= this.maxSize) {
      throw new GrudaideValidationError(
        `Task queue is full (max ${this.maxSize} pending/active tasks)`,
      );
    }

    const task: Task = {
      id: randomUUID(),
      type: options.type,
      priority: options.priority ?? 'normal',
      status: 'queued',
      payload: options.payload,
      createdAt: new Date(),
      updatedAt: new Date(),
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      timeoutMs: options.timeoutMs ?? 300000,
      metadata: options.metadata,
    };

    this.pending.push(task);
    this.sortPending();

    getLogger().debug('Task enqueued', { taskId: task.id, type: task.type, priority: task.priority });
    return task;
  }

  /**
   * Dequeue the highest-priority pending task and mark it as assigned.
   * Returns undefined if the queue is empty.
   */
  dequeue(): Task | undefined {
    const task = this.pending.shift();
    if (!task) return undefined;

    task.status = 'assigned';
    task.updatedAt = new Date();
    this.active.set(task.id, task);

    getLogger().debug('Task dequeued', { taskId: task.id, type: task.type });
    return task;
  }

  /**
   * Mark a task as running (assigned to a worker).
   */
  markRunning(taskId: string, workerId: string): void {
    const task = this.active.get(taskId);
    if (!task) {
      throw new GrudaideNotFoundError(`Task '${taskId}' not found in active queue`);
    }
    task.status = 'running';
    task.workerId = workerId;
    task.startedAt = new Date();
    task.updatedAt = new Date();
    task.attempts++;
  }

  /**
   * Complete a task with a result.
   */
  complete(taskId: string, result: Record<string, unknown>): void {
    const task = this.active.get(taskId);
    if (!task) {
      throw new GrudaideNotFoundError(`Task '${taskId}' not found in active queue`);
    }
    task.status = 'completed';
    task.result = result;
    task.completedAt = new Date();
    task.updatedAt = new Date();
    this.active.delete(taskId);
    this.completed.set(taskId, task);

    getLogger().info('Task completed', { taskId, type: task.type, workerId: task.workerId });
  }

  /**
   * Fail a task. If retries remain, re-queue it.
   */
  fail(taskId: string, error: string): boolean {
    const task = this.active.get(taskId);
    if (!task) {
      throw new GrudaideNotFoundError(`Task '${taskId}' not found in active queue`);
    }

    const canRetry = task.attempts < task.maxAttempts;
    this.active.delete(taskId);

    if (canRetry) {
      task.status = 'queued';
      task.error = error;
      task.workerId = undefined;
      task.startedAt = undefined;
      task.updatedAt = new Date();
      this.pending.push(task);
      this.sortPending();
      getLogger().warn('Task failed, re-queuing', {
        taskId,
        attempts: task.attempts,
        maxAttempts: task.maxAttempts,
        error,
      });
      return true;
    }

    task.status = 'failed';
    task.error = error;
    task.completedAt = new Date();
    task.updatedAt = new Date();
    this.completed.set(taskId, task);
    getLogger().error('Task permanently failed', {
      taskId,
      type: task.type,
      attempts: task.attempts,
      error,
    });
    return false;
  }

  /**
   * Cancel a pending task.
   */
  cancel(taskId: string): void {
    const idx = this.pending.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new GrudaideNotFoundError(`Pending task '${taskId}' not found`);
    }
    const [task] = this.pending.splice(idx, 1);
    task.status = 'cancelled';
    task.updatedAt = new Date();
    this.completed.set(taskId, task);
  }

  /** Get a task by ID (from any pool). */
  getTask(taskId: string): Task | undefined {
    return (
      this.active.get(taskId) ??
      this.completed.get(taskId) ??
      this.pending.find((t) => t.id === taskId)
    );
  }

  /** Count of pending tasks. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Count of active tasks. */
  get activeCount(): number {
    return this.active.size;
  }

  /** Snapshot of queue stats. */
  stats(): { pending: number; active: number; completed: number } {
    return {
      pending: this.pending.length,
      active: this.active.size,
      completed: this.completed.size,
    };
  }

  /** Returns a copy of pending tasks (ordered by priority). */
  listPending(): Task[] {
    return [...this.pending];
  }

  /** Returns a copy of active tasks. */
  listActive(): Task[] {
    return Array.from(this.active.values());
  }

  private sortPending(): void {
    this.pending.sort(
      (a, b) =>
        PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }
}

/**
 * Mark a task as timed out (called externally by the executor).
 */
export function setTaskStatus(task: Task, status: TaskStatus, error?: string): void {
  task.status = status;
  task.updatedAt = new Date();
  if (error) task.error = error;
  if (status === 'timed_out' || status === 'failed' || status === 'completed') {
    task.completedAt = new Date();
  }
}
