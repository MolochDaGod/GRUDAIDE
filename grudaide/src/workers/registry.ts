import {
  WorkerRegistration,
  WorkerMetadata,
  WorkerConfig,
  WorkerState,
  WorkerStatus,
  AIWorker,
  WorkerCapability,
} from './types';
import {
  GrudaideNotFoundError,
  GrudaideValidationError,
  GrudaideWorkerError,
  getLogger,
} from '../utils';

export interface RegistryOptions {
  maxWorkers?: number;
}

interface RegistryEntry {
  registration: WorkerRegistration;
  worker?: AIWorker;
}

/**
 * Worker Registry – central store for all registered AI workers.
 * Supports registration, lookup, versioning, and state management.
 */
export class WorkerRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly maxWorkers: number;

  constructor(options: RegistryOptions = {}) {
    this.maxWorkers = options.maxWorkers ?? 100;
  }

  /**
   * Register a new worker with its metadata and default config.
   */
  register(metadata: WorkerMetadata, config: WorkerConfig = {}, worker?: AIWorker): string {
    if (this.entries.size >= this.maxWorkers) {
      throw new GrudaideValidationError(
        `Worker registry is full (max ${this.maxWorkers} workers)`,
        { maxWorkers: this.maxWorkers },
      );
    }

    this.validateMetadata(metadata);

    const existing = this.entries.get(metadata.id);
    if (existing) {
      getLogger().warn('Re-registering existing worker, overwriting', { workerId: metadata.id });
    }

    const now = new Date();
    const registration: WorkerRegistration = {
      metadata: {
        ...metadata,
        updatedAt: now,
        createdAt: existing?.registration.metadata.createdAt ?? now,
      },
      config: {
        timeoutMs: 300000,
        maxRetries: 3,
        autoRestart: true,
        ...config,
      },
      state: {
        status: 'registered',
        tasksCompleted: 0,
        tasksFailed: 0,
        ...(existing?.registration.state ?? {}),
      },
    };

    this.entries.set(metadata.id, { registration, worker });

    getLogger().info('Worker registered', {
      workerId: metadata.id,
      name: metadata.name,
      version: metadata.version,
      capabilities: metadata.capabilities,
    });

    return metadata.id;
  }

  /**
   * Look up a worker registration by ID.
   */
  get(workerId: string): WorkerRegistration {
    const entry = this.entries.get(workerId);
    if (!entry) {
      throw new GrudaideNotFoundError(`Worker '${workerId}' not found in registry`);
    }
    return entry.registration;
  }

  /**
   * Get the AIWorker instance for the given ID (if bound).
   */
  getWorkerInstance(workerId: string): AIWorker | undefined {
    return this.entries.get(workerId)?.worker;
  }

  /**
   * List all registered workers, optionally filtered by capability.
   */
  list(capability?: WorkerCapability): WorkerRegistration[] {
    const all = Array.from(this.entries.values()).map((e) => e.registration);
    if (!capability) return all;
    return all.filter((r) => r.metadata.capabilities.includes(capability));
  }

  /**
   * Update the state of a worker.
   */
  updateState(workerId: string, updates: Partial<WorkerState>): void {
    const entry = this.entries.get(workerId);
    if (!entry) {
      throw new GrudaideNotFoundError(`Worker '${workerId}' not found`);
    }
    entry.registration.state = {
      ...entry.registration.state,
      ...updates,
    };
    entry.registration.metadata.updatedAt = new Date();
  }

  /**
   * Transition a worker to a new status.
   */
  setStatus(workerId: string, status: WorkerStatus, errorMessage?: string): void {
    const entry = this.entries.get(workerId);
    if (!entry) {
      throw new GrudaideNotFoundError(`Worker '${workerId}' not found`);
    }

    const prev = entry.registration.state.status;
    if (!this.isValidTransition(prev, status)) {
      throw new GrudaideWorkerError(
        `Invalid status transition: ${prev} → ${status} for worker '${workerId}'`,
        { workerId, from: prev, to: status },
      );
    }

    entry.registration.state.status = status;
    if (errorMessage !== undefined) {
      entry.registration.state.errorMessage = errorMessage;
    }
    if (status === 'running') {
      entry.registration.state.startedAt = new Date();
    }
    entry.registration.metadata.updatedAt = new Date();

    getLogger().debug('Worker status changed', { workerId, from: prev, to: status });
  }

  /**
   * Record a heartbeat for the worker.
   */
  heartbeat(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (!entry) {
      throw new GrudaideNotFoundError(`Worker '${workerId}' not found`);
    }
    entry.registration.state.lastHeartbeat = new Date();
  }

  /**
   * Deregister a worker from the registry.
   */
  deregister(workerId: string): void {
    if (!this.entries.has(workerId)) {
      throw new GrudaideNotFoundError(`Worker '${workerId}' not found`);
    }
    this.entries.delete(workerId);
    getLogger().info('Worker deregistered', { workerId });
  }

  /**
   * Return the count of workers with each status.
   */
  stats(): Record<WorkerStatus, number> {
    const counts: Record<WorkerStatus, number> = {
      registered: 0,
      initializing: 0,
      idle: 0,
      running: 0,
      paused: 0,
      error: 0,
      terminated: 0,
    };
    for (const { registration } of this.entries.values()) {
      counts[registration.state.status]++;
    }
    return counts;
  }

  /** Total registered workers. */
  get size(): number {
    return this.entries.size;
  }

  private validateMetadata(metadata: WorkerMetadata): void {
    if (!metadata.id || typeof metadata.id !== 'string') {
      throw new GrudaideValidationError('Worker metadata must have a non-empty string id');
    }
    if (!metadata.name) {
      throw new GrudaideValidationError('Worker metadata must have a name', { id: metadata.id });
    }
    if (!metadata.version) {
      throw new GrudaideValidationError('Worker metadata must have a version', {
        id: metadata.id,
      });
    }
    if (!Array.isArray(metadata.capabilities) || metadata.capabilities.length === 0) {
      throw new GrudaideValidationError('Worker metadata must list at least one capability', {
        id: metadata.id,
      });
    }
  }

  private isValidTransition(from: WorkerStatus, to: WorkerStatus): boolean {
    const allowed: Record<WorkerStatus, WorkerStatus[]> = {
      registered: ['initializing', 'terminated'],
      initializing: ['idle', 'error', 'terminated'],
      idle: ['running', 'paused', 'terminated'],
      running: ['idle', 'error', 'terminated'],
      paused: ['idle', 'running', 'terminated'],
      error: ['initializing', 'idle', 'terminated'],
      terminated: [],
    };
    return (allowed[from] ?? []).includes(to);
  }
}
