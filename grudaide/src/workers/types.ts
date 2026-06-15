/**
 * GRUDAIDE - AI Worker Types
 */

import { WorkerConfig, WorkerTrigger } from "../config/schema";

export type { WorkerTrigger };

// ─── Worker status ─────────────────────────────────────────────────────────

export type WorkerStatus =
  | "idle"
  | "running"
  | "paused"
  | "error"
  | "stopped";

// ─── Task types ────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  workerId: string;
  trigger: WorkerTrigger;
  payload: Record<string, unknown>;
  status: TaskStatus;
  priority: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
  attempts: number;
}

// ─── Worker execution context ───────────────────────────────────────────────

export interface WorkerContext {
  task: Task;
  config: WorkerConfig;
  logger: import("winston").Logger;
  signal: AbortSignal;
}

// ─── Worker health ─────────────────────────────────────────────────────────

export interface WorkerHealth {
  workerId: string;
  status: WorkerStatus;
  lastHeartbeat: string;
  tasksCompleted: number;
  tasksFailed: number;
  currentTask?: string;
  uptime: number; // ms since start
}

// ─── Worker interface ──────────────────────────────────────────────────────

export interface IWorker {
  readonly config: WorkerConfig;
  readonly status: WorkerStatus;
  readonly health: WorkerHealth;
  initialize(): Promise<void>;
  execute(context: WorkerContext): Promise<unknown>;
  /** Wrapped execute with status tracking and retry — implemented by BaseWorker. */
  run(context: WorkerContext): Promise<unknown>;
  cleanup(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}

// ─── Worker registry entry ─────────────────────────────────────────────────

export interface WorkerRegistryEntry {
  worker: IWorker;
  registeredAt: string;
  lastActivity?: string;
}
