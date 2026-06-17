import { DeploymentManager } from '../../src/deployment/manager';
import { DeploymentConfig } from '../../src/deployment/types';
import { GrudaideNotFoundError } from '../../src/utils/errors';

function makeConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    id: 'deploy-1',
    owner: 'grudge-studio',
    repo: 'test-app',
    target: {
      environment: 'staging',
      ref: 'main',
      sha: 'abc123',
    },
    rollbackOnFailure: false,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe('DeploymentManager', () => {
  let manager: DeploymentManager;

  beforeEach(() => {
    manager = new DeploymentManager({ maxConcurrent: 3, defaultTimeoutMs: 10000 });
  });

  describe('deploy()', () => {
    it('creates a deployment record with success status', async () => {
      const record = await manager.deploy(makeConfig(), 'user-1');
      expect(record.status).toBe('success');
      expect(record.config.repo).toBe('test-app');
      expect(record.triggeredBy).toBe('user-1');
      expect(record.completedAt).toBeDefined();
      expect(record.logs.length).toBeGreaterThan(0);
    });

    it('stores the record and makes it retrievable', async () => {
      const record = await manager.deploy(makeConfig(), 'user-1');
      const fetched = manager.getRecord(record.id);
      expect(fetched.id).toBe(record.id);
    });

    it('calls pre-deploy and post-deploy hooks', async () => {
      const calls: string[] = [];
      manager.onPreDeploy(async () => { calls.push('pre'); });
      manager.onPostDeploy(async () => { calls.push('post'); });

      await manager.deploy(makeConfig(), 'user-1');
      expect(calls).toEqual(['pre', 'post']);
    });

    it('post-deploy hook is called even on pre-deploy failure', async () => {
      const calls: string[] = [];
      manager.onPreDeploy(async () => { calls.push('pre'); throw new Error('pre failed'); });
      manager.onPostDeploy(async () => { calls.push('post'); });

      await expect(manager.deploy(makeConfig(), 'user-1')).rejects.toThrow();
      expect(calls).toContain('post');
    });

    it('rejects when maxConcurrent limit is reached', async () => {
      const tightManager = new DeploymentManager({ maxConcurrent: 1, defaultTimeoutMs: 10000 });

      // Block the first deployment
      let resolveFirst!: () => void;
      tightManager.onPreDeploy(
        () =>
          new Promise<void>((res) => {
            resolveFirst = res;
          }),
      );

      const firstDeploy = tightManager.deploy(makeConfig({ id: 'd1' }), 'user-1');

      // Give the first deploy time to start
      await new Promise((res) => setTimeout(res, 20));

      await expect(
        tightManager.deploy(makeConfig({ id: 'd2' }), 'user-2'),
      ).rejects.toThrow('Maximum concurrent deployments');

      resolveFirst();
      await firstDeploy.catch(() => null);
    });
  });

  describe('rollback()', () => {
    it('rolls back a deployment and updates the original record', async () => {
      const original = await manager.deploy(makeConfig(), 'user-1');
      // Manually set to failure to simulate a failing deployment
      const rec = manager.getRecord(original.id);
      (rec as { status: string }).status = 'failure';

      const rollback = await manager.rollback(original.id, 'manual');
      expect(rollback.status).toBe('rolled_back');
      expect(rollback.rollbackDeploymentId).toBe(original.id);

      const updatedOriginal = manager.getRecord(original.id);
      expect(updatedOriginal.status).toBe('rolled_back');
    });

    it('throws GrudaideNotFoundError for unknown deployment', async () => {
      await expect(manager.rollback('ghost', 'manual')).rejects.toThrow(GrudaideNotFoundError);
    });
  });

  describe('listRecords()', () => {
    it('returns all records when no filter applied', async () => {
      await manager.deploy(makeConfig({ id: 'd1', repo: 'app-a' }), 'user-1');
      await manager.deploy(makeConfig({ id: 'd2', repo: 'app-b' }), 'user-2');
      expect(manager.listRecords()).toHaveLength(2);
    });

    it('filters by repo', async () => {
      await manager.deploy(makeConfig({ id: 'd1', repo: 'app-a' }), 'user-1');
      await manager.deploy(makeConfig({ id: 'd2', repo: 'app-b' }), 'user-2');
      expect(manager.listRecords({ repo: 'app-a' })).toHaveLength(1);
    });

    it('filters by status', async () => {
      await manager.deploy(makeConfig({ id: 'd1' }), 'user-1');
      expect(manager.listRecords({ status: 'success' })).toHaveLength(1);
      expect(manager.listRecords({ status: 'failure' })).toHaveLength(0);
    });
  });

  describe('stats()', () => {
    it('returns deployment counts', async () => {
      await manager.deploy(makeConfig(), 'user-1');
      const stats = manager.stats();
      expect(stats.total).toBe(1);
      expect(stats.byStatus['success']).toBe(1);
      expect(stats.active).toBe(0);
    });
  });

  describe('getRecord()', () => {
    it('throws GrudaideNotFoundError for unknown id', () => {
      expect(() => manager.getRecord('ghost')).toThrow(GrudaideNotFoundError);
    });
  });
});
