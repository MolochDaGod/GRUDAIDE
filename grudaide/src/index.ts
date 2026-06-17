/**
 * GRUDAIDE – AI Worker Deployment Platform for Grudge Studio
 *
 * Main entry point. Loads configuration and starts the server.
 */
import { loadConfig } from './config';
import { startServer } from './app';

async function main(): Promise<void> {
  const config = loadConfig();
  await startServer(config);
}

main().catch((err) => {
  console.error('Failed to start GRUDAIDE:', err);
  process.exit(1);
});

// Re-export public API
export { createApp, createServices, startServer, AppServices } from './app';
export { loadConfig, loadTestConfig, GrudaideConfig } from './config';
export * from './workers';
export * from './deployment';
export * from './queue';
export * from './data';
export * from './webhooks';
export * from './utils';
