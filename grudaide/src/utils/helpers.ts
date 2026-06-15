/**
 * GRUDAIDE - General Utility Helpers
 */

import { v4 as uuidv4 } from "uuid";

/**
 * Generate a unique ID with an optional prefix.
 */
export function generateId(prefix?: string): string {
  const id = uuidv4();
  return prefix ? `${prefix}-${id}` : id;
}

/**
 * Pause execution for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format an ISO date string for display.
 */
export function formatDate(date?: Date | string): string {
  const d = date ? new Date(date) : new Date();
  return d.toISOString();
}

/**
 * Chunk an array into batches of `size`.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Pick specified keys from an object.
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

/**
 * Omit specified keys from an object.
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj } as Omit<T, K>;
  for (const key of keys) {
    delete (result as Record<string, unknown>)[key as string];
  }
  return result;
}

/**
 * Truncate a string to maxLength, appending `…` if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

/**
 * Deep-clone a JSON-serialisable value.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Return a safe string from any unknown error.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Check whether a value is a plain object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
