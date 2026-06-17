import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { DeploymentManager } from '../deployment/manager';
import { TaskQueue } from '../queue/task-queue';
import { getLogger } from '../utils';

/**
 * Handle push events – triggers CI or deployment workers.
 */
export function handlePush(
  event: EmitterWebhookEvent<'push'>['payload'],
  queue: TaskQueue,
): void {
  const logger = getLogger();
  const { ref, repository, commits, pusher } = event;

  logger.info('Push event received', {
    ref,
    repo: repository.full_name,
    commits: commits.length,
    pusher: pusher.name,
  });

  // Enqueue a task for each push to a main branch
  const isMainBranch = ref === 'refs/heads/main' || ref === 'refs/heads/master';
  if (isMainBranch && commits.length > 0) {
    queue.enqueue({
      type: 'ci',
      priority: 'high',
      payload: {
        event: 'push',
        ref,
        repo: repository.full_name,
        sha: commits[0]?.id ?? '',
        commits: commits.map((c) => ({ id: c.id, message: c.message })),
        pusher: pusher.name,
      },
      metadata: { source: 'push-webhook' },
    });

    logger.info('CI task enqueued for push to main branch', { ref, repo: repository.full_name });
  }
}

/**
 * Handle pull_request events – triggers review workers.
 */
export function handlePullRequest(
  event: EmitterWebhookEvent<'pull_request'>['payload'],
  queue: TaskQueue,
): void {
  const logger = getLogger();
  const { action, pull_request: pr, repository } = event;

  logger.info('Pull request event', {
    action,
    pr: pr.number,
    repo: repository.full_name,
    title: pr.title,
  });

  if (action === 'opened' || action === 'synchronize') {
    queue.enqueue({
      type: 'code-review',
      priority: 'normal',
      payload: {
        event: 'pull_request',
        action,
        pr: pr.number,
        title: pr.title,
        head: pr.head.sha,
        base: pr.base.sha,
        repo: repository.full_name,
        author: pr.user?.login ?? 'unknown',
      },
      metadata: { source: 'pr-webhook' },
    });

    logger.info('Code-review task enqueued', { pr: pr.number, repo: repository.full_name });
  }
}

/**
 * Handle issues events – stores data or triggers analysis workers.
 */
export function handleIssues(
  event: EmitterWebhookEvent<'issues'>['payload'],
  queue: TaskQueue,
): void {
  const logger = getLogger();
  const { action, issue, repository } = event;

  logger.info('Issues event', {
    action,
    issue: issue.number,
    repo: repository.full_name,
    title: issue.title,
  });

  if (action === 'opened') {
    queue.enqueue({
      type: 'data-analysis',
      priority: 'low',
      payload: {
        event: 'issues',
        action,
        issue: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        labels: (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name ?? '')),
        repo: repository.full_name,
        author: issue.user?.login ?? 'unknown',
      },
      metadata: { source: 'issues-webhook' },
    });
  }
}

/**
 * Handle deployment events – dispatches deployment workers.
 */
export async function handleDeployment(
  event: EmitterWebhookEvent<'deployment'>['payload'],
  deploymentManager: DeploymentManager,
): Promise<void> {
  const logger = getLogger();
  const { deployment, repository } = event;

  logger.info('Deployment event received', {
    id: deployment.id,
    env: deployment.environment,
    ref: deployment.ref,
    repo: repository.full_name,
    creator: deployment.creator?.login ?? 'unknown',
  });

  await deploymentManager.deploy(
    {
      id: String(deployment.id),
      owner: repository.owner.login,
      repo: repository.name,
      target: {
        environment: deployment.environment as 'development' | 'staging' | 'production',
        ref: deployment.ref,
        sha: deployment.sha,
        description: deployment.description ?? undefined,
      },
      rollbackOnFailure: true,
      timeoutMs: 600000,
    },
    deployment.creator?.login ?? 'github-webhook',
  );
}
