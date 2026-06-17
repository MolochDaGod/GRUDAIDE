import { TaskQueue } from '../../src/queue/task-queue';
import { GrudaideNotFoundError, GrudaideValidationError } from '../../src/utils/errors';

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue(100);
  });

  describe('enqueue()', () => {
    it('adds a task and returns a Task object', () => {
      const task = queue.enqueue({ type: 'ci', payload: { repo: 'test' } });
      expect(task.id).toBeDefined();
      expect(task.type).toBe('ci');
      expect(task.status).toBe('queued');
      expect(task.priority).toBe('normal');
      expect(queue.pendingCount).toBe(1);
    });

    it('uses supplied priority', () => {
      const task = queue.enqueue({ type: 'ci', payload: {}, priority: 'critical' });
      expect(task.priority).toBe('critical');
    });

    it('assigns defaults for maxAttempts and timeoutMs', () => {
      const task = queue.enqueue({ type: 'ci', payload: {} });
      expect(task.maxAttempts).toBe(3);
      expect(task.timeoutMs).toBe(300000);
    });

    it('orders pending tasks by priority (critical first)', () => {
      queue.enqueue({ type: 'a', payload: {}, priority: 'low' });
      queue.enqueue({ type: 'b', payload: {}, priority: 'critical' });
      queue.enqueue({ type: 'c', payload: {}, priority: 'normal' });

      const first = queue.dequeue()!;
      expect(first.type).toBe('b');
      const second = queue.dequeue()!;
      expect(second.type).toBe('c');
    });

    it('throws GrudaideValidationError when queue is full', () => {
      const small = new TaskQueue(2);
      small.enqueue({ type: 'a', payload: {} });
      small.enqueue({ type: 'b', payload: {} });
      expect(() => small.enqueue({ type: 'c', payload: {} })).toThrow(GrudaideValidationError);
    });
  });

  describe('dequeue()', () => {
    it('returns undefined when queue is empty', () => {
      expect(queue.dequeue()).toBeUndefined();
    });

    it('moves task from pending to active', () => {
      queue.enqueue({ type: 'ci', payload: {} });
      const task = queue.dequeue()!;
      expect(task.status).toBe('assigned');
      expect(queue.pendingCount).toBe(0);
      expect(queue.activeCount).toBe(1);
    });
  });

  describe('markRunning()', () => {
    it('marks task as running and records workerId', () => {
      const task = queue.enqueue({ type: 'ci', payload: {} });
      queue.dequeue();
      queue.markRunning(task.id, 'worker-1');
      const active = queue.listActive();
      expect(active[0]?.status).toBe('running');
      expect(active[0]?.workerId).toBe('worker-1');
      expect(active[0]?.attempts).toBe(1);
    });

    it('throws GrudaideNotFoundError for unknown taskId', () => {
      expect(() => queue.markRunning('ghost', 'worker-1')).toThrow(GrudaideNotFoundError);
    });
  });

  describe('complete()', () => {
    it('marks task as completed and moves to completed pool', () => {
      const task = queue.enqueue({ type: 'ci', payload: {} });
      queue.dequeue();
      queue.markRunning(task.id, 'w1');
      queue.complete(task.id, { ok: true });

      const found = queue.getTask(task.id);
      expect(found?.status).toBe('completed');
      expect(found?.result).toEqual({ ok: true });
      expect(queue.activeCount).toBe(0);
    });
  });

  describe('fail()', () => {
    it('re-queues task when retries remain', () => {
      const task = queue.enqueue({ type: 'ci', payload: {}, maxAttempts: 3 });
      queue.dequeue();
      queue.markRunning(task.id, 'w1');
      const requeued = queue.fail(task.id, 'timeout');

      expect(requeued).toBe(true);
      expect(queue.pendingCount).toBe(1);
      expect(queue.activeCount).toBe(0);
    });

    it('permanently fails task when max retries exceeded', () => {
      const task = queue.enqueue({ type: 'ci', payload: {}, maxAttempts: 1 });
      queue.dequeue();
      queue.markRunning(task.id, 'w1');
      const requeued = queue.fail(task.id, 'fatal');

      expect(requeued).toBe(false);
      expect(queue.getTask(task.id)?.status).toBe('failed');
    });

    it('throws GrudaideNotFoundError for unknown taskId', () => {
      expect(() => queue.fail('ghost', 'error')).toThrow(GrudaideNotFoundError);
    });
  });

  describe('cancel()', () => {
    it('cancels a pending task', () => {
      const task = queue.enqueue({ type: 'ci', payload: {} });
      queue.cancel(task.id);
      expect(queue.pendingCount).toBe(0);
      expect(queue.getTask(task.id)?.status).toBe('cancelled');
    });

    it('throws GrudaideNotFoundError for non-pending tasks', () => {
      expect(() => queue.cancel('ghost')).toThrow(GrudaideNotFoundError);
    });
  });

  describe('stats()', () => {
    it('returns correct counts', () => {
      queue.enqueue({ type: 'a', payload: {} });
      queue.enqueue({ type: 'b', payload: {} });
      const t = queue.dequeue()!;
      queue.markRunning(t.id, 'w1');
      queue.complete(t.id, {});

      const stats = queue.stats();
      expect(stats.pending).toBe(1);
      expect(stats.active).toBe(0);
      expect(stats.completed).toBe(1);
    });
  });
});
