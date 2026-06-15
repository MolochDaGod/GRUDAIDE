/**
 * GRUDAIDE - Error Handling Utilities
 * Typed error classes and retry helpers
 */

import { createLogger } from "./logger";

const logger = createLogger("errors");

// ─── Error classes ─────────────────────────────────────────────────────────

export class GrudaideError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "GrudaideError";
    this.code = code;
    this.context = context;
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GrudaideError);
    }
  }
}

export class WorkerError extends GrudaideError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "WORKER_ERROR", context);
    this.name = "WorkerError";
  }
}

export class DeploymentError extends GrudaideError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "DEPLOYMENT_ERROR", context);
    this.name = "DeploymentError";
  }
}

export class ConfigurationError extends GrudaideError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFIGURATION_ERROR", context);
    this.name = "ConfigurationError";
  }
}

export class StorageError extends GrudaideError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "STORAGE_ERROR", context);
    this.name = "StorageError";
  }
}

export class WebhookError extends GrudaideError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "WEBHOOK_ERROR", context);
    this.name = "WebhookError";
  }
}

// ─── Retry logic ──────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts (including initial) */
  attempts: number;
  /** Initial delay in ms (doubles on each retry) */
  delay: number;
  /** Maximum delay cap in ms */
  maxDelay?: number;
  /** Optional predicate: return true if error should be retried */
  retryOn?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with exponential back-off retries.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  context?: string
): Promise<T> {
  const { attempts, delay, maxDelay = 30_000, retryOn } = options;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === attempts;
      const shouldRetry = retryOn ? retryOn(err) : true;

      if (isLast || !shouldRetry) {
        logger.error(`[${context ?? "withRetry"}] All ${attempts} attempts failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      const backoff = Math.min(delay * Math.pow(2, attempt - 1), maxDelay);
      logger.warn(`[${context ?? "withRetry"}] Attempt ${attempt}/${attempts} failed, retrying in ${backoff}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(backoff);
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new GrudaideError("withRetry exhausted all attempts", "RETRY_EXHAUSTED");
}

/**
 * Safely execute a function, returning null on error instead of throwing.
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    logger.error(`[${context ?? "safeExecute"}] Error caught and suppressed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Type guard for GrudaideError
 */
export function isGrudaideError(err: unknown): err is GrudaideError {
  return err instanceof GrudaideError;
}
