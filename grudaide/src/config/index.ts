/**
 * Configuration management for GRUDAIDE.
 * All config is read from environment variables with sensible defaults.
 */

export interface GrudaideConfig {
  /** GitHub App ID */
  appId: string;
  /** GitHub App private key (PEM) */
  privateKey: string;
  /** GitHub App webhook secret */
  webhookSecret: string;
  /** GitHub App client ID */
  clientId: string;
  /** GitHub App client secret */
  clientSecret: string;
  /** Port for the HTTP server */
  port: number;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Worker execution timeout in milliseconds */
  workerTimeoutMs: number;
  /** Maximum concurrent workers */
  maxConcurrentWorkers: number;
  /** Deployment environment */
  environment: 'development' | 'staging' | 'production';
  /** Grudge Studio npm registry URL */
  npmRegistry: string;
  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number;
  /** Task queue max size */
  taskQueueMaxSize: number;
  /** Whether to enable auto-recovery for failed workers */
  autoRecovery: boolean;
}

/**
 * Load configuration from environment variables.
 * Throws if required variables are missing.
 */
export function loadConfig(): GrudaideConfig {
  const required = ['GITHUB_APP_ID', 'GITHUB_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Set them in your .env file or environment.',
    );
  }

  return {
    appId: process.env['GITHUB_APP_ID']!,
    privateKey: process.env['GITHUB_PRIVATE_KEY']!.replace(/\\n/g, '\n'),
    webhookSecret: process.env['GITHUB_WEBHOOK_SECRET']!,
    clientId: process.env['GITHUB_CLIENT_ID'] ?? '',
    clientSecret: process.env['GITHUB_CLIENT_SECRET'] ?? '',
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    logLevel: (process.env['LOG_LEVEL'] as GrudaideConfig['logLevel']) ?? 'info',
    workerTimeoutMs: parseInt(process.env['WORKER_TIMEOUT_MS'] ?? '300000', 10),
    maxConcurrentWorkers: parseInt(process.env['MAX_CONCURRENT_WORKERS'] ?? '10', 10),
    environment:
      (process.env['NODE_ENV'] as GrudaideConfig['environment']) ?? 'development',
    npmRegistry: process.env['NPM_REGISTRY'] ?? 'https://registry.npmjs.org',
    healthCheckIntervalMs: parseInt(
      process.env['HEALTH_CHECK_INTERVAL_MS'] ?? '30000',
      10,
    ),
    taskQueueMaxSize: parseInt(process.env['TASK_QUEUE_MAX_SIZE'] ?? '1000', 10),
    autoRecovery: process.env['AUTO_RECOVERY'] !== 'false',
  };
}

/**
 * Load config for testing, with all required fields having defaults.
 */
export function loadTestConfig(overrides: Partial<GrudaideConfig> = {}): GrudaideConfig {
  return {
    appId: 'test-app-id',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
    webhookSecret: 'test-webhook-secret',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    port: 3000,
    logLevel: 'error',
    workerTimeoutMs: 5000,
    maxConcurrentWorkers: 2,
    environment: 'development',
    npmRegistry: 'https://registry.npmjs.org',
    healthCheckIntervalMs: 1000,
    taskQueueMaxSize: 100,
    autoRecovery: false,
    ...overrides,
  };
}
