/**
 * Core type definitions for AI workers in GRUDAIDE.
 */

export type WorkerStatus =
  | 'registered'
  | 'initializing'
  | 'idle'
  | 'running'
  | 'paused'
  | 'error'
  | 'terminated';

export type WorkerCapability =
  | 'code-review'
  | 'deployment'
  | 'testing'
  | 'monitoring'
  | 'data-analysis'
  | 'documentation'
  | 'security-scan'
  | 'custom';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export type TaskStatus =
  | 'queued'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface WorkerMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: WorkerCapability[];
  repository?: string;
  author?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkerConfig {
  timeoutMs?: number;
  maxRetries?: number;
  resourceLimits?: {
    maxMemoryMb?: number;
    maxCpuPercent?: number;
  };
  environment?: Record<string, string>;
  autoRestart?: boolean;
}

export interface WorkerState {
  status: WorkerStatus;
  lastHeartbeat?: Date;
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  errorMessage?: string;
  startedAt?: Date;
  uptimeMs?: number;
}

export interface WorkerRegistration {
  metadata: WorkerMetadata;
  config: WorkerConfig;
  state: WorkerState;
}

export interface Task {
  id: string;
  type: string;
  priority: TaskPriority;
  status: TaskStatus;
  workerId?: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  metadata?: Record<string, unknown>;
}

export interface WorkerHealthCheck {
  workerId: string;
  healthy: boolean;
  checkedAt: Date;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface WorkerMetrics {
  workerId: string;
  tasksCompleted: number;
  tasksFailed: number;
  averageTaskDurationMs: number;
  uptime: number;
  lastActivity: Date;
}

/**
 * Interface that all AI workers must implement.
 */
export interface AIWorker {
  readonly id: string;
  readonly metadata: WorkerMetadata;

  /**
   * Initialize the worker with configuration.
   */
  initialize(config: WorkerConfig): Promise<void>;

  /**
   * Execute a task and return the result.
   */
  execute(task: Task): Promise<Record<string, unknown>>;

  /**
   * Health check – returns true if the worker is healthy.
   */
  healthCheck(): Promise<WorkerHealthCheck>;

  /**
   * Gracefully shut down the worker.
   */
  shutdown(): Promise<void>;
}
