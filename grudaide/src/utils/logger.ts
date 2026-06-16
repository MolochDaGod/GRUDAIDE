import { createLogger, format, transports, Logger } from 'winston';
import { GrudaideConfig } from '../config';

let _logger: Logger | null = null;

/**
 * Get the singleton logger instance.
 */
export function getLogger(): Logger {
  if (!_logger) {
    _logger = createLogger({
      level: 'info',
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        format.errors({ stack: true }),
        format.json(),
      ),
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
              return `${timestamp} [${level}] ${message}${metaStr}`;
            }),
          ),
        }),
      ],
    });
  }
  return _logger;
}

/**
 * Initialize logger with config.
 */
export function initLogger(config: Pick<GrudaideConfig, 'logLevel'>): Logger {
  _logger = createLogger({
    level: config.logLevel,
    format: format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      format.errors({ stack: true }),
      format.json(),
    ),
    transports: [
      new transports.Console({
        format: format.combine(
          format.colorize(),
          format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}] ${message}${metaStr}`;
          }),
        ),
      }),
    ],
  });
  return _logger;
}

/**
 * Reset logger (for testing).
 */
export function resetLogger(): void {
  _logger = null;
}
