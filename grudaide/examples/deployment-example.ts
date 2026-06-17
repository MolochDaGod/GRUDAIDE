/**
 * Example: Deployment Worker
 *
 * Demonstrates how to use the DeploymentManager to deploy
 * a Grudge Studio npm package to different environments.
 */
import { DeploymentManager } from '../src/deployment/manager';
import { DeploymentConfig } from '../src/deployment/types';

async function runDeployment(): Promise<void> {
  const manager = new DeploymentManager({
    maxConcurrent: 3,
    defaultTimeoutMs: 600000,
  });

  // Register hooks for GitHub status updates
  manager.onPreDeploy(async (record) => {
    console.log(`[PRE-DEPLOY] Starting deployment ${record.id} to ${record.config.target.environment}`);
    // In production: update GitHub deployment status to 'in_progress'
  });

  manager.onPostDeploy(async (record) => {
    console.log(`[POST-DEPLOY] Deployment ${record.id} finished with status: ${record.status}`);
    // In production: update GitHub deployment status, send Slack notification
  });

  const config: DeploymentConfig = {
    id: 'deploy-example-001',
    owner: 'grudge-studio',
    repo: 'my-service',
    target: {
      environment: 'staging',
      ref: 'main',
      sha: 'abc123def456',
      description: 'Deploy latest main to staging',
    },
    packages: [
      {
        name: '@grudge-studio/my-service',
        version: '2.1.0',
        registry: 'https://registry.npmjs.org',
      },
    ],
    preDeployCommands: [
      'npm ci',
      'npm run build',
      'npm test',
    ],
    postDeployCommands: [
      'npm run smoke-test',
    ],
    rollbackOnFailure: true,
    timeoutMs: 300000,
    requiredChecks: ['ci', 'security-scan'],
  };

  try {
    const record = await manager.deploy(config, 'ci-bot');
    console.log('Deployment successful:', {
      id: record.id,
      status: record.status,
      duration: record.completedAt
        ? record.completedAt.getTime() - record.createdAt.getTime()
        : 0,
      logs: record.logs.length,
    });
  } catch (error) {
    console.error('Deployment failed:', error);

    // Manual rollback example
    const records = manager.listRecords({ status: 'failure' });
    for (const failed of records) {
      console.log(`Rolling back failed deployment: ${failed.id}`);
      await manager.rollback(failed.id, 'manual');
    }
  }

  // Print stats
  console.log('Deployment stats:', manager.stats());
}

if (require.main === module) {
  runDeployment().catch(console.error);
}
