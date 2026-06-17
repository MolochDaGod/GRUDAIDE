import {
  withRetry,
  withTimeout,
  GrudaideError,
  GrudaideTimeoutError,
  GrudaideWorkerError,
  GrudaideDeploymentError,
  GrudaideAuthError,
  GrudaideNotFoundError,
  GrudaideValidationError,
  getErrorMessage,
} from '../../src/utils/errors';

describe('withRetry()', () => {
  it('returns the result on first success', async () => {
    const result = await withRetry(() => Promise.resolve('ok'), { maxAttempts: 3 });
    expect(result).toBe('ok');
  });

  it('retries on failure and succeeds eventually', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return Promise.resolve('done');
      },
      { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10 },
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('throws after exhausting all attempts', async () => {
    await expect(
      withRetry(() => Promise.reject(new Error('boom')), {
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 10,
      }),
    ).rejects.toThrow('boom');
  });

  it('respects retryOn predicate', async () => {
    let calls = 0;
    const err = new Error('non-retryable');
    await expect(
      withRetry(
        () => {
          calls++;
          throw err;
        },
        {
          maxAttempts: 5,
          initialDelayMs: 1,
          maxDelayMs: 10,
          retryOn: () => false,
        },
      ),
    ).rejects.toThrow('non-retryable');
    expect(calls).toBe(1);
  });
});

describe('withTimeout()', () => {
  it('resolves when function completes before timeout', async () => {
    const result = await withTimeout(
      () => Promise.resolve('fast'),
      1000,
      'fast-op',
    );
    expect(result).toBe('fast');
  });

  it('rejects with GrudaideTimeoutError when timed out', async () => {
    await expect(
      withTimeout(
        () => new Promise((res) => setTimeout(res, 200)),
        50,
        'slow-op',
      ),
    ).rejects.toThrow(GrudaideTimeoutError);
  });
});

describe('Error classes', () => {
  it('GrudaideError has correct name and code', () => {
    const e = new GrudaideError('msg', 'CODE');
    expect(e.name).toBe('GrudaideError');
    expect(e.code).toBe('CODE');
    expect(e.message).toBe('msg');
    expect(e instanceof Error).toBe(true);
  });

  it('GrudaideWorkerError has code WORKER_ERROR', () => {
    const e = new GrudaideWorkerError('worker failed');
    expect(e.code).toBe('WORKER_ERROR');
    expect(e.name).toBe('GrudaideWorkerError');
  });

  it('GrudaideDeploymentError has code DEPLOYMENT_ERROR', () => {
    const e = new GrudaideDeploymentError('deploy failed');
    expect(e.code).toBe('DEPLOYMENT_ERROR');
  });

  it('GrudaideAuthError has code AUTH_ERROR', () => {
    const e = new GrudaideAuthError('unauthorized');
    expect(e.code).toBe('AUTH_ERROR');
  });

  it('GrudaideNotFoundError has code NOT_FOUND', () => {
    const e = new GrudaideNotFoundError('not found');
    expect(e.code).toBe('NOT_FOUND');
  });

  it('GrudaideValidationError has code VALIDATION_ERROR', () => {
    const e = new GrudaideValidationError('invalid');
    expect(e.code).toBe('VALIDATION_ERROR');
  });

  it('GrudaideTimeoutError has code TIMEOUT', () => {
    const e = new GrudaideTimeoutError('timed out');
    expect(e.code).toBe('TIMEOUT');
  });

  it('stores context', () => {
    const e = new GrudaideValidationError('bad input', { field: 'name' });
    expect(e.context).toEqual({ field: 'name' });
  });
});

describe('getErrorMessage()', () => {
  it('extracts message from Error', () => {
    expect(getErrorMessage(new Error('test msg'))).toBe('test msg');
  });

  it('returns string as-is', () => {
    expect(getErrorMessage('plain error')).toBe('plain error');
  });

  it('converts other types to string', () => {
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
  });
});
