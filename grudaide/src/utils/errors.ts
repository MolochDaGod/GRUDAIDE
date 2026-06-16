import { getLogger } from './logger';

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  retryOn?: (error: unknown) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
};

/**
 * Execute a function with exponential backoff retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  operationName = 'operation',
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const logger = getLogger();
  let lastError: unknown;
  let delayMs = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const shouldRetry = opts.retryOn ? opts.retryOn(error) : true;

      if (!shouldRetry || attempt === opts.maxAttempts) {
        logger.error(`${operationName} failed after ${attempt} attempt(s)`, {
          error: error instanceof Error ? error.message : String(error),
          attempt,
        });
        throw error;
      }

      logger.warn(`${operationName} failed on attempt ${attempt}/${opts.maxAttempts}, retrying in ${delayMs}ms`, {
        error: error instanceof Error ? error.message : String(error),
        attempt,
        nextDelayMs: delayMs,
      });

      await sleep(delayMs);
      delayMs = Math.min(delayMs * opts.backoffFactor, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with a timeout, throwing if it exceeds the limit.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operationName = 'operation',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new GrudaideTimeoutError(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Base error class for GRUDAIDE errors.
 */
export class GrudaideError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GrudaideError';
  }
}

export class GrudaideTimeoutError extends GrudaideError {
  constructor(message: string) {
    super(message, 'TIMEOUT');
    this.name = 'GrudaideTimeoutError';
  }
}

export class GrudaideWorkerError extends GrudaideError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'WORKER_ERROR', context);
    this.name = 'GrudaideWorkerError';
  }
}

export class GrudaideDeploymentError extends GrudaideError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DEPLOYMENT_ERROR', context);
    this.name = 'GrudaideDeploymentError';
  }
}

export class GrudaideAuthError extends GrudaideError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
    this.name = 'GrudaideAuthError';
  }
}

export class GrudaideNotFoundError extends GrudaideError {
  constructor(message: string) {
    super(message, 'NOT_FOUND');
    this.name = 'GrudaideNotFoundError';
  }
}

export class GrudaideValidationError extends GrudaideError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'GrudaideValidationError';
  }
}

/**
 * Safely extract an error message from an unknown error.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
