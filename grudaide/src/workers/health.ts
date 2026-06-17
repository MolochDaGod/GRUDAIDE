import { WorkerRegistry } from './registry';
import { WorkerExecutor } from './executor';
import { GrudaideConfig } from '../config';
import { getLogger } from '../utils';

/**
 * Health monitor that periodically runs health checks and logs metrics.
 */
export class WorkerHealthMonitor {
  private readonly executor: WorkerExecutor;
  private readonly registry: WorkerRegistry;
  private readonly intervalMs: number;
  private intervalHandle?: ReturnType<typeof setInterval>;

  constructor(
    executor: WorkerExecutor,
    registry: WorkerRegistry,
    config: Pick<GrudaideConfig, 'healthCheckIntervalMs'>,
  ) {
    this.executor = executor;
    this.registry = registry;
    this.intervalMs = config.healthCheckIntervalMs;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => void this.runChecks(), this.intervalMs);
    getLogger().info('WorkerHealthMonitor started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    getLogger().info('WorkerHealthMonitor stopped');
  }

  async runChecks(): Promise<void> {
    const checks = await this.executor.runHealthChecks();
    const stats = this.registry.stats();

    const unhealthy = checks.filter((c) => !c.healthy);
    if (unhealthy.length > 0) {
      getLogger().warn('Unhealthy workers detected', {
        count: unhealthy.length,
        workerIds: unhealthy.map((c) => c.workerId),
      });
    }

    getLogger().debug('Worker health check complete', {
      total: checks.length,
      healthy: checks.length - unhealthy.length,
      unhealthy: unhealthy.length,
      stats,
    });
  }
}
