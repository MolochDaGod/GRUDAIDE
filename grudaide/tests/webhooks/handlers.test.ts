import { handlePush, handlePullRequest, handleIssues } from '../../src/webhooks/handlers';
import { TaskQueue } from '../../src/queue/task-queue';

// Minimal webhook payload factories
function makePushPayload(overrides: Record<string, unknown> = {}): Parameters<typeof handlePush>[0] {
  return {
    ref: 'refs/heads/main',
    repository: { full_name: 'grudge/test', owner: { login: 'grudge' }, name: 'test' },
    commits: [{ id: 'sha1', message: 'chore: update', url: '' }],
    pusher: { name: 'dev', email: 'dev@grudge.studio' },
    ...overrides,
  } as Parameters<typeof handlePush>[0];
}

function makePRPayload(
  action: string,
  overrides: Record<string, unknown> = {},
): Parameters<typeof handlePullRequest>[0] {
  return {
    action,
    pull_request: {
      number: 42,
      title: 'feat: add workers',
      head: { sha: 'headsha' },
      base: { sha: 'basesha' },
      user: { login: 'dev' },
    },
    repository: { full_name: 'grudge/test', owner: { login: 'grudge' }, name: 'test' },
    ...overrides,
  } as Parameters<typeof handlePullRequest>[0];
}

function makeIssuesPayload(
  action: string,
): Parameters<typeof handleIssues>[0] {
  return {
    action,
    issue: {
      number: 10,
      title: 'Bug: deploy fails',
      body: 'details here',
      labels: [{ id: 1, name: 'bug', url: '' }],
      user: { login: 'reporter' },
    },
    repository: { full_name: 'grudge/test', owner: { login: 'grudge' }, name: 'test' },
  } as Parameters<typeof handleIssues>[0];
}

describe('Webhook Handlers', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue(100);
  });

  describe('handlePush()', () => {
    it('enqueues a CI task for pushes to main', () => {
      handlePush(makePushPayload({ ref: 'refs/heads/main' }), queue);
      expect(queue.pendingCount).toBe(1);
      const task = queue.dequeue()!;
      expect(task.type).toBe('ci');
      expect(task.priority).toBe('high');
      expect(task.payload['repo']).toBe('grudge/test');
    });

    it('enqueues a CI task for pushes to master', () => {
      handlePush(makePushPayload({ ref: 'refs/heads/master' }), queue);
      expect(queue.pendingCount).toBe(1);
    });

    it('does NOT enqueue for non-main branch pushes', () => {
      handlePush(makePushPayload({ ref: 'refs/heads/feature/xyz' }), queue);
      expect(queue.pendingCount).toBe(0);
    });

    it('does NOT enqueue when there are no commits', () => {
      handlePush(makePushPayload({ ref: 'refs/heads/main', commits: [] }), queue);
      expect(queue.pendingCount).toBe(0);
    });
  });

  describe('handlePullRequest()', () => {
    it('enqueues a code-review task on PR opened', () => {
      handlePullRequest(makePRPayload('opened'), queue);
      expect(queue.pendingCount).toBe(1);
      const task = queue.dequeue()!;
      expect(task.type).toBe('code-review');
      expect(task.payload['pr']).toBe(42);
      expect(task.payload['action']).toBe('opened');
    });

    it('enqueues a code-review task on PR synchronize', () => {
      handlePullRequest(makePRPayload('synchronize'), queue);
      expect(queue.pendingCount).toBe(1);
    });

    it('does NOT enqueue for unrelated PR actions', () => {
      handlePullRequest(makePRPayload('closed'), queue);
      handlePullRequest(makePRPayload('labeled'), queue);
      expect(queue.pendingCount).toBe(0);
    });
  });

  describe('handleIssues()', () => {
    it('enqueues a data-analysis task on issue opened', () => {
      handleIssues(makeIssuesPayload('opened'), queue);
      expect(queue.pendingCount).toBe(1);
      const task = queue.dequeue()!;
      expect(task.type).toBe('data-analysis');
      expect(task.priority).toBe('low');
      expect(task.payload['issue']).toBe(10);
    });

    it('does NOT enqueue for issue closed', () => {
      handleIssues(makeIssuesPayload('closed'), queue);
      expect(queue.pendingCount).toBe(0);
    });
  });
});
