/**
 * GRUDAIDE - Base AI Worker
 * Abstract base class all workers extend
 */

import { createLogger } from "../utils/logger";
import { WorkerError } from "../utils/errors";
import { WorkerConfig } from "../config/schema";
import {
  IWorker,
  WorkerContext,
  WorkerHealth,
  WorkerStatus,
} from "./types";
import type * as winston from "winston";

export abstract class BaseWorker implements IWorker {
  protected readonly logger: winston.Logger;
  private _status: WorkerStatus = "idle";
  private readonly startTime = Date.now();
  private tasksCompleted = 0;
  private tasksFailed = 0;
  private currentTaskId: string | undefined;

  constructor(public readonly config: WorkerConfig) {
    this.logger = createLogger(`worker:${config.id}`);
  }

  get status(): WorkerStatus {
    return this._status;
  }

  get health(): WorkerHealth {
    return {
      workerId: this.config.id,
      status: this._status,
      lastHeartbeat: new Date().toISOString(),
      tasksCompleted: this.tasksCompleted,
      tasksFailed: this.tasksFailed,
      currentTask: this.currentTaskId,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Optional lifecycle hook: called once on worker startup.
   */
  async initialize(): Promise<void> {
    this.logger.info(`Worker ${this.config.id} initialised`);
    this._status = "idle";
  }

  /**
   * Execute a task. Subclasses must implement this.
   */
  abstract execute(context: WorkerContext): Promise<unknown>;

  /**
   * Optional lifecycle hook: called on worker shutdown.
   */
  async cleanup(): Promise<void> {
    this.logger.info(`Worker ${this.config.id} cleaned up`);
  }

  pause(): void {
    if (this._status !== "running") return;
    this._status = "paused";
    this.logger.info(`Worker ${this.config.id} paused`);
  }

  resume(): void {
    if (this._status !== "paused") return;
    this._status = "idle";
    this.logger.info(`Worker ${this.config.id} resumed`);
  }

  async stop(): Promise<void> {
    this._status = "stopped";
    await this.cleanup();
    this.logger.info(`Worker ${this.config.id} stopped`);
  }

  /** Returns true when the worker is in a terminal state (error or stopped). */
  private isTerminalStatus(): boolean {
    return this._status === "error" || this._status === "stopped";
  }

  /**
   * Internal: wrap execute() with status tracking and error handling.
   */
  async run(context: WorkerContext): Promise<unknown> {
    if (this._status === "stopped") {
      throw new WorkerError(`Worker ${this.config.id} is stopped`, {
        workerId: this.config.id,
      });
    }
    if (this._status === "paused") {
      throw new WorkerError(`Worker ${this.config.id} is paused`, {
        workerId: this.config.id,
      });
    }

    this._status = "running";
    this.currentTaskId = context.task.id;

    try {
      this.logger.info(`Executing task ${context.task.id}`, {
        trigger: context.task.trigger,
        attempt: context.task.attempts,
      });
      const result = await this.execute(context);
      this.tasksCompleted++;
      this.logger.info(`Task ${context.task.id} completed successfully`);
      return result;
    } catch (err) {
      this.tasksFailed++;
      this._status = "error";
      this.logger.error(`Task ${context.task.id} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.currentTaskId = undefined;
      if (!this.isTerminalStatus()) {
        this._status = "idle";
      }
    }
  }
}
