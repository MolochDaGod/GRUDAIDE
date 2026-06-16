import { Webhooks } from '@octokit/webhooks';
import { DeploymentManager } from '../deployment/manager';
import { TaskQueue } from '../queue/task-queue';
import { handlePush, handlePullRequest, handleIssues, handleDeployment } from './handlers';
import { getLogger, getErrorMessage } from '../utils';

export interface WebhookRouterOptions {
  secret: string;
  queue: TaskQueue;
  deploymentManager: DeploymentManager;
}

/**
 * WebhookRouter – registers handlers for all supported GitHub webhook events
 * and routes them to the appropriate processing logic.
 */
export class WebhookRouter {
  readonly webhooks: Webhooks;
  private readonly queue: TaskQueue;
  private readonly deploymentManager: DeploymentManager;

  constructor(options: WebhookRouterOptions) {
    this.queue = options.queue;
    this.deploymentManager = options.deploymentManager;
    this.webhooks = new Webhooks({ secret: options.secret });

    this.registerHandlers();
  }

  private registerHandlers(): void {
    const logger = getLogger();

    this.webhooks.on('push', ({ payload }) => {
      try {
        handlePush(payload, this.queue);
      } catch (error) {
        logger.error('Error handling push event', { error: getErrorMessage(error) });
      }
    });

    this.webhooks.on('pull_request', ({ payload }) => {
      try {
        handlePullRequest(payload, this.queue);
      } catch (error) {
        logger.error('Error handling pull_request event', { error: getErrorMessage(error) });
      }
    });

    this.webhooks.on('issues', ({ payload }) => {
      try {
        handleIssues(payload, this.queue);
      } catch (error) {
        logger.error('Error handling issues event', { error: getErrorMessage(error) });
      }
    });

    this.webhooks.on('deployment', async ({ payload }) => {
      try {
        await handleDeployment(payload, this.deploymentManager);
      } catch (error) {
        logger.error('Error handling deployment event', { error: getErrorMessage(error) });
      }
    });

    this.webhooks.onError((error) => {
      logger.error('Webhook processing error', { error: error.message });
    });
  }
}
