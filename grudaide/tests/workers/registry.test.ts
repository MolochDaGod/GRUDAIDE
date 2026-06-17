import { WorkerRegistry } from '../../src/workers/registry';
import { WorkerMetadata, WorkerConfig, WorkerCapability } from '../../src/workers/types';
import {
  GrudaideNotFoundError,
  GrudaideValidationError,
  GrudaideWorkerError,
} from '../../src/utils/errors';

function makeMetadata(overrides: Partial<WorkerMetadata> = {}): WorkerMetadata {
  const now = new Date();
  return {
    id: 'worker-1',
    name: 'Test Worker',
    version: '1.0.0',
    description: 'A test worker',
    capabilities: ['code-review' as WorkerCapability],
    tags: ['test'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('WorkerRegistry', () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = new WorkerRegistry();
  });

  describe('register()', () => {
    it('registers a valid worker and returns its id', () => {
      const metadata = makeMetadata();
      const id = registry.register(metadata, {});
      expect(id).toBe('worker-1');
      expect(registry.size).toBe(1);
    });

    it('sets default status to "registered"', () => {
      registry.register(makeMetadata(), {});
      const reg = registry.get('worker-1');
      expect(reg.state.status).toBe('registered');
    });

    it('applies default config values', () => {
      registry.register(makeMetadata(), {});
      const reg = registry.get('worker-1');
      expect(reg.config.maxRetries).toBe(3);
      expect(reg.config.autoRestart).toBe(true);
    });

    it('merges user-supplied config over defaults', () => {
      registry.register(makeMetadata(), { maxRetries: 5, autoRestart: false });
      const reg = registry.get('worker-1');
      expect(reg.config.maxRetries).toBe(5);
      expect(reg.config.autoRestart).toBe(false);
    });

    it('throws GrudaideValidationError for missing id', () => {
      expect(() => registry.register(makeMetadata({ id: '' }))).toThrow(GrudaideValidationError);
    });

    it('throws GrudaideValidationError for missing name', () => {
      expect(() => registry.register(makeMetadata({ name: '' }))).toThrow(GrudaideValidationError);
    });

    it('throws GrudaideValidationError for missing version', () => {
      expect(() => registry.register(makeMetadata({ version: '' }))).toThrow(
        GrudaideValidationError,
      );
    });

    it('throws GrudaideValidationError for empty capabilities', () => {
      expect(() => registry.register(makeMetadata({ capabilities: [] }))).toThrow(
        GrudaideValidationError,
      );
    });

    it('overwrites existing worker registration', () => {
      registry.register(makeMetadata({ version: '1.0.0' }));
      registry.register(makeMetadata({ version: '2.0.0' }));
      expect(registry.get('worker-1').metadata.version).toBe('2.0.0');
      expect(registry.size).toBe(1);
    });

    it('enforces maxWorkers limit', () => {
      const small = new WorkerRegistry({ maxWorkers: 2 });
      small.register(makeMetadata({ id: 'w1' }));
      small.register(makeMetadata({ id: 'w2' }));
      expect(() => small.register(makeMetadata({ id: 'w3' }))).toThrow(GrudaideValidationError);
    });
  });

  describe('get()', () => {
    it('throws GrudaideNotFoundError for unknown worker', () => {
      expect(() => registry.get('ghost')).toThrow(GrudaideNotFoundError);
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      registry.register(makeMetadata({ id: 'w1', capabilities: ['code-review'] }));
      registry.register(makeMetadata({ id: 'w2', capabilities: ['deployment'] }));
      registry.register(makeMetadata({ id: 'w3', capabilities: ['code-review', 'testing'] }));
    });

    it('lists all workers when no filter given', () => {
      expect(registry.list()).toHaveLength(3);
    });

    it('filters by capability', () => {
      const reviewers = registry.list('code-review');
      expect(reviewers).toHaveLength(2);
      expect(reviewers.map((r) => r.metadata.id)).toContain('w1');
      expect(reviewers.map((r) => r.metadata.id)).toContain('w3');
    });

    it('returns empty array for capability with no workers', () => {
      expect(registry.list('monitoring')).toHaveLength(0);
    });
  });

  describe('setStatus()', () => {
    beforeEach(() => {
      registry.register(makeMetadata());
    });

    it('allows valid status transitions', () => {
      registry.setStatus('worker-1', 'initializing');
      expect(registry.get('worker-1').state.status).toBe('initializing');
      registry.setStatus('worker-1', 'idle');
      expect(registry.get('worker-1').state.status).toBe('idle');
    });

    it('throws GrudaideWorkerError for invalid transition', () => {
      expect(() => registry.setStatus('worker-1', 'running')).toThrow(GrudaideWorkerError);
    });

    it('stores errorMessage on error status', () => {
      registry.setStatus('worker-1', 'initializing');
      registry.setStatus('worker-1', 'error', 'boom');
      expect(registry.get('worker-1').state.errorMessage).toBe('boom');
    });

    it('throws GrudaideNotFoundError for unknown worker', () => {
      expect(() => registry.setStatus('ghost', 'idle')).toThrow(GrudaideNotFoundError);
    });
  });

  describe('updateState()', () => {
    it('merges state updates', () => {
      registry.register(makeMetadata());
      registry.updateState('worker-1', { tasksCompleted: 5 });
      expect(registry.get('worker-1').state.tasksCompleted).toBe(5);
    });

    it('throws GrudaideNotFoundError for unknown worker', () => {
      expect(() => registry.updateState('ghost', {})).toThrow(GrudaideNotFoundError);
    });
  });

  describe('heartbeat()', () => {
    it('sets lastHeartbeat', () => {
      registry.register(makeMetadata());
      const before = Date.now();
      registry.heartbeat('worker-1');
      const hb = registry.get('worker-1').state.lastHeartbeat;
      expect(hb).toBeDefined();
      expect(hb!.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('deregister()', () => {
    it('removes the worker', () => {
      registry.register(makeMetadata());
      registry.deregister('worker-1');
      expect(registry.size).toBe(0);
    });

    it('throws GrudaideNotFoundError for unknown worker', () => {
      expect(() => registry.deregister('ghost')).toThrow(GrudaideNotFoundError);
    });
  });

  describe('stats()', () => {
    it('counts workers by status', () => {
      registry.register(makeMetadata({ id: 'w1' }));
      registry.register(makeMetadata({ id: 'w2' }));
      registry.setStatus('w2', 'initializing');
      const stats = registry.stats();
      expect(stats.registered).toBe(1);
      expect(stats.initializing).toBe(1);
    });
  });
});
