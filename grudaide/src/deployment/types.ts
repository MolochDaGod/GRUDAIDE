/**
 * Deployment type definitions.
 */

export type DeploymentStatus =
  | 'pending'
  | 'in_progress'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'rolled_back';

export type DeploymentEnvironment = 'development' | 'staging' | 'production';

export type RollbackReason = 'manual' | 'health_check_failed' | 'test_failure' | 'timeout';

export interface DeploymentTarget {
  environment: DeploymentEnvironment;
  ref: string;
  sha?: string;
  description?: string;
}

export interface NpmPackageSpec {
  name: string;
  version: string;
  registry?: string;
  scope?: string;
}

export interface DeploymentConfig {
  id: string;
  owner: string;
  repo: string;
  target: DeploymentTarget;
  packages?: NpmPackageSpec[];
  preDeployCommands?: string[];
  postDeployCommands?: string[];
  healthCheckUrl?: string;
  rollbackOnFailure: boolean;
  timeoutMs: number;
  requiredChecks?: string[];
}

export interface DeploymentRecord {
  id: string;
  config: DeploymentConfig;
  status: DeploymentStatus;
  triggeredBy: string;
  githubDeploymentId?: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  logs: DeploymentLogEntry[];
  rollbackDeploymentId?: string;
}

export interface DeploymentLogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}
