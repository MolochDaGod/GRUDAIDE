/**
 * GRUDAIDE - GitHub App & AI Worker Management Platform
 * Core configuration types and schema validation
 */

import { z } from "zod";

// GitHub App configuration schema
export const GithubAppConfigSchema = z.object({
  appId: z.string().min(1, "GitHub App ID is required"),
  privateKey: z.string().min(1, "GitHub App private key is required"),
  webhookSecret: z.string().min(1, "Webhook secret is required"),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  installationId: z.string().optional(),
});

// Worker configuration schema
export const WorkerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["deployment", "monitoring", "automation", "data-sync", "custom"]),
  enabled: z.boolean().default(true),
  concurrency: z.number().int().min(1).max(50).default(5),
  retryLimit: z.number().int().min(0).max(10).default(3),
  retryDelay: z.number().int().min(100).max(60000).default(1000),
  timeout: z.number().int().min(1000).max(3600000).default(30000),
  triggers: z.array(
    z.enum([
      "push",
      "pull_request",
      "issues",
      "issue_comment",
      "deployment",
      "deployment_status",
      "workflow_run",
      "schedule",
      "manual",
    ])
  ).default([]),
  metadata: z.record(z.unknown()).optional(),
});

// Deployment configuration schema
export const DeploymentConfigSchema = z.object({
  environment: z.enum(["development", "staging", "production"]).default("development"),
  npmRegistry: z.string().url().optional(),
  npmToken: z.string().optional(),
  buildCommand: z.string().default("npm run build"),
  testCommand: z.string().default("npm test"),
  startCommand: z.string().default("npm start"),
  healthCheckUrl: z.string().url().optional(),
  healthCheckInterval: z.number().int().min(1000).default(30000),
  rollbackOnFailure: z.boolean().default(true),
  projects: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      registry: z.string().optional(),
    })
  ).default([]),
});

// Storage configuration schema
export const StorageConfigSchema = z.object({
  issueDataLabel: z.string().default("grudaide:data"),
  stateLabel: z.string().default("grudaide:state"),
  projectId: z.string().optional(),
  dataPrefix: z.string().default("grudaide/"),
  owner: z.string().min(1),
  repo: z.string().min(1),
});

// Logging configuration schema
export const LoggingConfigSchema = z.object({
  level: z.enum(["error", "warn", "info", "debug", "verbose"]).default("info"),
  format: z.enum(["json", "text"]).default("json"),
  enableFileLogging: z.boolean().default(false),
  logDir: z.string().default("./logs"),
});

// Server configuration schema
export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default("0.0.0.0"),
  webhookPath: z.string().default("/webhooks"),
  healthPath: z.string().default("/health"),
});

// Root application configuration schema
export const AppConfigSchema = z.object({
  github: GithubAppConfigSchema,
  server: ServerConfigSchema.default({}),
  deployment: DeploymentConfigSchema.partial().optional(),
  storage: StorageConfigSchema.partial().optional(),
  logging: LoggingConfigSchema.default({}),
  workers: z.array(WorkerConfigSchema).default([]),
});

// Infer TypeScript types from schemas
export type GithubAppConfig = z.infer<typeof GithubAppConfigSchema>;
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;
export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

// Worker trigger event types
export type WorkerTrigger = WorkerConfig["triggers"][number];

// Deployment environment type
export type DeploymentEnvironment = DeploymentConfig["environment"];

// Worker type enum
export type WorkerType = WorkerConfig["type"];
