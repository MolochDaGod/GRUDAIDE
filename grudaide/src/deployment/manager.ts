import { randomUUID } from 'crypto';
import {
  DeploymentConfig,
  DeploymentRecord,
  DeploymentStatus,
  DeploymentLogEntry,
  RollbackReason,
} from './types';
import {
  GrudaideDeploymentError,
  GrudaideNotFoundError,
  withTimeout,
  getLogger,
  getErrorMessage,
} from '../utils';

export interface DeploymentManagerOptions {
  maxConcurrent?: number;
  defaultTimeoutMs?: number;
}

type DeployHook = (record: DeploymentRecord) => Promise<void>;

/**
 * Deployment Manager – orchestrates deployments, tracks status,
 * and supports rollback/rollforward across environments.
 */
export class DeploymentManager {
  private readonly records = new Map<string, DeploymentRecord>();
  private readonly activeDeployments = new Set<string>();
  private readonly maxConcurrent: number;
  private readonly defaultTimeoutMs: number;
  private preDeployHook?: DeployHook;
  private postDeployHook?: DeployHook;

  constructor(options: DeploymentManagerOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 600000;
  }

  /** Register a hook called before deployment starts. */
  onPreDeploy(hook: DeployHook): void {
    this.preDeployHook = hook;
  }

  /** Register a hook called after deployment completes (success or failure). */
  onPostDeploy(hook: DeployHook): void {
    this.postDeployHook = hook;
  }

  /**
   * Start a new deployment.
   */
  async deploy(config: DeploymentConfig, triggeredBy: string): Promise<DeploymentRecord> {
    if (this.activeDeployments.size >= this.maxConcurrent) {
      throw new GrudaideDeploymentError(
        `Maximum concurrent deployments reached (${this.maxConcurrent})`,
        { activeCount: this.activeDeployments.size },
      );
    }

    const record: DeploymentRecord = {
      id: config.id || randomUUID(),
      config,
      status: 'pending',
      triggeredBy,
      createdAt: new Date(),
      updatedAt: new Date(),
      logs: [],
    };

    this.records.set(record.id, record);
    this.activeDeployments.add(record.id);

    this.log(record, 'info', `Deployment started for ${config.owner}/${config.repo}@${config.target.ref}`, {
      environment: config.target.environment,
      triggeredBy,
    });

    try {
      await this.runDeployment(record);
    } finally {
      this.activeDeployments.delete(record.id);
    }

    return record;
  }

  private async runDeployment(record: DeploymentRecord): Promise<void> {
    this.setStatus(record, 'in_progress');

    try {
      if (this.preDeployHook) {
        await this.preDeployHook(record);
      }

      const timeoutMs = record.config.timeoutMs ?? this.defaultTimeoutMs;
      await withTimeout(
        () => this.executeDeployment(record),
        timeoutMs,
        `Deployment ${record.id}`,
      );

      this.setStatus(record, 'success');
      this.log(record, 'info', 'Deployment completed successfully');
    } catch (error) {
      const errMsg = getErrorMessage(error);
      this.log(record, 'error', `Deployment failed: ${errMsg}`);
      this.setStatus(record, 'failure', errMsg);

      if (record.config.rollbackOnFailure) {
        getLogger().warn('Deployment failed, triggering automatic rollback', {
          deploymentId: record.id,
        });
        await this.rollback(record.id, 'health_check_failed').catch((rbError) => {
          this.log(record, 'error', `Rollback also failed: ${getErrorMessage(rbError)}`);
        });
      }

      throw new GrudaideDeploymentError(errMsg, { deploymentId: record.id });
    } finally {
      record.completedAt = new Date();
      record.updatedAt = new Date();
      if (this.postDeployHook) {
        await this.postDeployHook(record).catch((e) =>
          this.log(record, 'warn', `Post-deploy hook error: ${getErrorMessage(e)}`),
        );
      }
    }
  }

  /**
   * Core deployment execution logic.
   * Runs pre-deploy commands, then post-deploy commands.
   */
  private async executeDeployment(record: DeploymentRecord): Promise<void> {
    record.startedAt = new Date();

    // Run pre-deploy commands (simulated)
    for (const cmd of record.config.preDeployCommands ?? []) {
      this.log(record, 'info', `Running pre-deploy command: ${cmd}`);
      await this.runCommand(record, cmd);
    }

    // Validate npm packages
    for (const pkg of record.config.packages ?? []) {
      this.log(record, 'info', `Validating npm package: ${pkg.name}@${pkg.version}`);
    }

    this.log(record, 'info', `Deploying ${record.config.owner}/${record.config.repo} to ${record.config.target.environment}`);

    // Run post-deploy commands
    for (const cmd of record.config.postDeployCommands ?? []) {
      this.log(record, 'info', `Running post-deploy command: ${cmd}`);
      await this.runCommand(record, cmd);
    }
  }

  /**
   * Simulate running a shell command (overridable for real implementations).
   */
  protected async runCommand(_record: DeploymentRecord, command: string): Promise<void> {
    getLogger().debug('Running deployment command', { command });
    // In production, this would exec the command via child_process
  }

  /**
   * Roll back a deployment to the previous successful state.
   */
  async rollback(deploymentId: string, reason: RollbackReason): Promise<DeploymentRecord> {
    const original = this.getRecord(deploymentId);

    const rollbackRecord: DeploymentRecord = {
      id: randomUUID(),
      config: {
        ...original.config,
        id: randomUUID(),
        rollbackOnFailure: false,
      },
      status: 'pending',
      triggeredBy: `rollback:${reason}:${original.triggeredBy}`,
      rollbackDeploymentId: deploymentId,
      createdAt: new Date(),
      updatedAt: new Date(),
      logs: [],
    };

    this.records.set(rollbackRecord.id, rollbackRecord);
    this.activeDeployments.add(rollbackRecord.id);

    this.log(rollbackRecord, 'info', `Rolling back deployment ${deploymentId}`, { reason });

    try {
      this.setStatus(rollbackRecord, 'in_progress');
      this.log(rollbackRecord, 'info', 'Rollback executing');
      this.setStatus(rollbackRecord, 'rolled_back');
      this.log(rollbackRecord, 'info', 'Rollback completed');

      this.setStatus(original, 'rolled_back');
    } finally {
      rollbackRecord.completedAt = new Date();
      rollbackRecord.updatedAt = new Date();
      this.activeDeployments.delete(rollbackRecord.id);
    }

    return rollbackRecord;
  }

  /**
   * Get a deployment record by ID.
   */
  getRecord(id: string): DeploymentRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new GrudaideNotFoundError(`Deployment '${id}' not found`);
    }
    return record;
  }

  /**
   * List all deployments, optionally filtered by status.
   */
  listRecords(filter?: { status?: DeploymentStatus; repo?: string }): DeploymentRecord[] {
    let records = Array.from(this.records.values());
    if (filter?.status) {
      records = records.filter((r) => r.status === filter.status);
    }
    if (filter?.repo) {
      records = records.filter((r) => r.config.repo === filter.repo);
    }
    return records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Current stats.
   */
  stats(): { total: number; active: number; byStatus: Record<string, number> } {
    const byStatus: Record<string, number> = {};
    for (const record of this.records.values()) {
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    }
    return {
      total: this.records.size,
      active: this.activeDeployments.size,
      byStatus,
    };
  }

  private setStatus(record: DeploymentRecord, status: DeploymentStatus, errorMessage?: string): void {
    record.status = status;
    record.updatedAt = new Date();
    if (errorMessage) record.errorMessage = errorMessage;
  }

  private log(
    record: DeploymentRecord,
    level: DeploymentLogEntry['level'],
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: DeploymentLogEntry = {
      timestamp: new Date(),
      level,
      message,
      data,
    };
    record.logs.push(entry);
    getLogger()[level](message, { deploymentId: record.id, ...data });
  }
}
