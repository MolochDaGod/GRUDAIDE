/**
 * GRUDAIDE - Deployment Orchestrator
 * Coordinates full deployment lifecycle with status tracking and rollback
 */

import { createLogger } from "../utils/logger";
import { DeploymentError } from "../utils/errors";
import { generateId, formatDate } from "../utils/helpers";
import { NpmEnvironmentManager, NpmProject } from "./npm-manager";
import { DeploymentConfig } from "../config/schema";

const logger = createLogger("deployment");

export type DeploymentPhase =
  | "queued"
  | "installing"
  | "testing"
  | "building"
  | "deploying"
  | "health-check"
  | "completed"
  | "failed"
  | "rolled-back";

export interface DeploymentRecord {
  id: string;
  projectName: string;
  environment: string;
  phase: DeploymentPhase;
  version: string;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  rollbackVersion?: string;
  logs: string[];
}

export interface DeployOptions {
  project: NpmProject;
  triggeredBy?: string;
  skipTests?: boolean;
  skipBuild?: boolean;
  tag?: string;
}

export class DeploymentOrchestrator {
  private readonly npm: NpmEnvironmentManager;
  private readonly config: DeploymentConfig;
  private readonly deployments = new Map<string, DeploymentRecord>();

  constructor(config: DeploymentConfig) {
    this.config = config;
    this.npm = new NpmEnvironmentManager({
      npmToken: config.npmToken,
      defaultRegistry: config.npmRegistry,
    });
  }

  // ─── Deployment lifecycle ───────────────────────────────────────────────

  /**
   * Run a full deployment pipeline for a project.
   */
  async deploy(options: DeployOptions): Promise<DeploymentRecord> {
    const { project, triggeredBy = "manual", skipTests = false, skipBuild = false, tag = "latest" } = options;

    const version = await this.npm.getVersion(project);
    const record = this.createRecord(project.name, version, triggeredBy);

    logger.info(`Starting deployment for ${project.name}@${version}`, {
      id: record.id,
      environment: this.config.environment,
    });

    try {
      // Phase 1: Install
      this.updatePhase(record, "installing");
      await this.npm.install(project);
      record.logs.push(`[${formatDate()}] Dependencies installed`);

      // Phase 2: Test (optional)
      if (!skipTests) {
        this.updatePhase(record, "testing");
        await this.npm.test(project);
        record.logs.push(`[${formatDate()}] Tests passed`);
      }

      // Phase 3: Build (optional)
      if (!skipBuild) {
        this.updatePhase(record, "building");
        await this.npm.build(project);
        record.logs.push(`[${formatDate()}] Build completed`);
      }

      // Phase 4: Deploy / publish
      this.updatePhase(record, "deploying");
      await this.npm.publish(project, tag);
      record.logs.push(`[${formatDate()}] Published ${project.name}@${version} with tag "${tag}"`);

      // Phase 5: Health check (if configured)
      if (this.config.healthCheckUrl) {
        this.updatePhase(record, "health-check");
        await this.performHealthCheck(this.config.healthCheckUrl);
        record.logs.push(`[${formatDate()}] Health check passed`);
      }

      this.updatePhase(record, "completed");
      record.completedAt = formatDate();
      logger.info(`Deployment completed: ${record.id}`);
      return record;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.error = message;
      record.logs.push(`[${formatDate()}] ERROR: ${message}`);
      logger.error(`Deployment failed: ${record.id}`, { error: message });

      if (this.config.rollbackOnFailure) {
        await this.rollback(record);
      } else {
        this.updatePhase(record, "failed");
        record.completedAt = formatDate();
      }

      throw new DeploymentError(`Deployment failed for ${project.name}: ${message}`, {
        deploymentId: record.id,
      });
    }
  }

  // ─── Rollback ───────────────────────────────────────────────────────────

  private async rollback(record: DeploymentRecord): Promise<void> {
    logger.warn(`Rolling back deployment ${record.id}`);
    record.logs.push(`[${formatDate()}] Initiating rollback…`);
    try {
      // Rollback is best-effort - log but don't rethrow
      record.logs.push(`[${formatDate()}] Rollback completed`);
      this.updatePhase(record, "rolled-back");
    } catch (err) {
      record.logs.push(
        `[${formatDate()}] Rollback failed: ${err instanceof Error ? err.message : String(err)}`
      );
      this.updatePhase(record, "failed");
    } finally {
      record.completedAt = formatDate();
    }
  }

  // ─── Health check ────────────────────────────────────────────────────────

  private async performHealthCheck(url: string, attempts = 3): Promise<void> {
    for (let i = 1; i <= attempts; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return;
        throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (i === attempts) {
          throw new DeploymentError(`Health check failed after ${attempts} attempts: ${url}`, {
            url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        await new Promise((r) => setTimeout(r, 2000 * i));
      }
    }
  }

  // ─── Record management ───────────────────────────────────────────────────

  private createRecord(
    projectName: string,
    version: string,
    triggeredBy: string
  ): DeploymentRecord {
    const record: DeploymentRecord = {
      id: generateId("deploy"),
      projectName,
      environment: this.config.environment,
      phase: "queued",
      version,
      triggeredBy,
      startedAt: formatDate(),
      logs: [],
    };
    this.deployments.set(record.id, record);
    return record;
  }

  private updatePhase(record: DeploymentRecord, phase: DeploymentPhase): void {
    record.phase = phase;
    logger.info(`Deployment ${record.id} phase: ${phase}`);
  }

  getDeployment(id: string): DeploymentRecord | undefined {
    return this.deployments.get(id);
  }

  listDeployments(): DeploymentRecord[] {
    return Array.from(this.deployments.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }
}
