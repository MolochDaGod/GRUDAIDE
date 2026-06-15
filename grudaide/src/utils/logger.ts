/**
 * GRUDAIDE - Logger Utility
 * Structured logging using Winston
 */

import * as winston from "winston";

const { combine, timestamp, json, colorize, printf } = winston.format;

const textFormat = printf(({ level, message, label, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${ts} [${label ?? "grudaide"}] ${level}: ${message}${metaStr}`;
});

/**
 * Create a named logger instance
 */
export function createLogger(
  label: string,
  options?: { level?: string; format?: "json" | "text" }
): winston.Logger {
  const level = options?.level ?? process.env.LOG_LEVEL ?? "info";
  const format = options?.format ?? (process.env.LOG_FORMAT as "json" | "text") ?? "json";

  const formats: winston.Logform.Format[] = [
    timestamp({ format: "ISO" }),
    winston.format.label({ label }),
  ];

  if (format === "text") {
    formats.push(colorize(), textFormat);
  } else {
    formats.push(json());
  }

  return winston.createLogger({
    level,
    format: combine(...formats),
    transports: [new winston.transports.Console()],
    defaultMeta: { service: "grudaide", component: label },
  });
}

/** Root application logger */
export const logger = createLogger("app");
