/**
 * GRUDAIDE - Configuration Manager
 * Loads and validates configuration from environment variables and config files
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import * as yaml from "yaml";
import { AppConfig, AppConfigSchema, WorkerConfig } from "./schema";
import { createLogger } from "../utils/logger";

const logger = createLogger("config");

// Load .env file if present
dotenv.config();

/**
 * Build AppConfig from environment variables
 */
function buildConfigFromEnv(): Partial<AppConfig> {
  const rawWorkers: WorkerConfig[] = [];

  // Parse GRUDAIDE_WORKERS env var if set (JSON array)
  const workersEnv = process.env.GRUDAIDE_WORKERS;
  if (workersEnv) {
    try {
      const parsed = JSON.parse(workersEnv);
      if (Array.isArray(parsed)) rawWorkers.push(...parsed);
    } catch {
      logger.warn("Failed to parse GRUDAIDE_WORKERS env var as JSON");
    }
  }

  const validEnvs = new Set(["development", "staging", "production"]);
  const rawNodeEnv = process.env.NODE_ENV ?? "development";
  const environment = (
    validEnvs.has(rawNodeEnv) ? rawNodeEnv : "development"
  ) as "development" | "staging" | "production";

  // Only include storage if the required fields are present
  const storageOwner = process.env.GITHUB_OWNER ?? "";
  const storageRepo = process.env.GITHUB_REPO ?? "";
  const storageConfig =
    storageOwner && storageRepo
      ? {
          owner: storageOwner,
          repo: storageRepo,
          issueDataLabel: process.env.STORAGE_ISSUE_LABEL ?? "grudaide:data",
          stateLabel: process.env.STORAGE_STATE_LABEL ?? "grudaide:state",
          projectId: process.env.GITHUB_PROJECT_ID,
        }
      : undefined;

  return {
    github: {
      appId: process.env.GITHUB_APP_ID ?? "",
      privateKey: (process.env.GITHUB_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      installationId: process.env.GITHUB_INSTALLATION_ID,
    },
    server: {
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
      host: process.env.HOST ?? "0.0.0.0",
      webhookPath: process.env.WEBHOOK_PATH ?? "/webhooks",
      healthPath: process.env.HEALTH_PATH ?? "/health",
    },
    deployment: {
      environment,
      npmRegistry: process.env.NPM_REGISTRY,
      npmToken: process.env.NPM_TOKEN,
    },
    ...(storageConfig ? { storage: storageConfig } : {}),
    logging: {
      level:
        (process.env.LOG_LEVEL as
          | "error"
          | "warn"
          | "info"
          | "debug"
          | "verbose") ?? "info",
      format: (process.env.LOG_FORMAT as "json" | "text") ?? "json",
      enableFileLogging: process.env.LOG_TO_FILE === "true",
      logDir: process.env.LOG_DIR ?? "./logs",
    },
    workers: rawWorkers,
  };
}

/**
 * Load worker configs from a JSON/YAML config file
 */
function loadConfigFile(configPath: string): Partial<AppConfig> {
  try {
    if (!fs.existsSync(configPath)) return {};
    const ext = path.extname(configPath).toLowerCase();
    const raw = fs.readFileSync(configPath, "utf-8");

    if (ext === ".json") {
      return JSON.parse(raw);
    }

    if (ext === ".yml" || ext === ".yaml") {
      return yaml.parse(raw);
    }

    logger.warn(`Unsupported config file extension: ${ext}`);
    return {};
  } catch (err) {
    logger.warn(`Failed to load config file: ${configPath}`, { error: err });
    return {};
  }
}

/**
 * Deep merge two partial config objects (env overrides file)
 */
function mergeConfigs(
  fileConfig: Partial<AppConfig>,
  envConfig: Partial<AppConfig>
): Partial<AppConfig> {
  const merged: Partial<AppConfig> = { ...fileConfig };

  for (const key of Object.keys(envConfig) as (keyof AppConfig)[]) {
    const envVal = envConfig[key];
    const fileVal = fileConfig[key];

    if (
      envVal !== null &&
      typeof envVal === "object" &&
      !Array.isArray(envVal) &&
      fileVal !== null &&
      typeof fileVal === "object" &&
      !Array.isArray(fileVal)
    ) {
      // Merge nested objects: env fields only override when they carry a
      // non-empty value so that a missing env var doesn't blank out a file value.
      const base = { ...(fileVal as Record<string, unknown>) };
      for (const [k, v] of Object.entries(envVal as Record<string, unknown>)) {
        if (v !== undefined && v !== null && v !== "") {
          base[k] = v;
        }
      }
      (merged as Record<string, unknown>)[key] = base;
    } else if (envVal !== undefined && envVal !== null) {
      (merged as Record<string, unknown>)[key] = envVal;
    }
  }

  return merged;
}

let cachedConfig: AppConfig | null = null;

/**
 * Load, merge, and validate the application configuration.
 * Environment variables take precedence over the config file.
 */
export function loadConfig(configFilePath?: string): AppConfig {
  if (cachedConfig) return cachedConfig;

  const defaultConfigPath =
    configFilePath ??
    process.env.GRUDAIDE_CONFIG ??
    path.resolve(process.cwd(), "grudaide.config.yml");

  const fileConfig = loadConfigFile(defaultConfigPath);
  const envConfig = buildConfigFromEnv();
  const merged = mergeConfigs(fileConfig, envConfig);

  const result = AppConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`GRUDAIDE configuration validation failed:\n${issues}`);
  }

  cachedConfig = result.data;
  logger.info("Configuration loaded and validated successfully");
  return cachedConfig;
}

/**
 * Reset the cached config (useful for testing)
 */
export function resetConfig(): void {
  cachedConfig = null;
}

export { AppConfig };
