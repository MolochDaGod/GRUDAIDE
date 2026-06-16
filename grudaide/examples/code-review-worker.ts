/**
 * Example: Code Review AI Worker
 *
 * Demonstrates how to implement the AIWorker interface for
 * automated code review on pull requests.
 */
import {
  AIWorker,
  WorkerMetadata,
  WorkerConfig,
  WorkerHealthCheck,
  Task,
} from '../src/workers/types';

export class CodeReviewWorker implements AIWorker {
  readonly id = 'code-review-worker-v1';
  private initialized = false;
  private config: WorkerConfig = {};

  readonly metadata: WorkerMetadata = {
    id: this.id,
    name: 'Code Review Worker',
    version: '1.0.0',
    description: 'Automated code review using AI to detect bugs, security issues, and style violations',
    capabilities: ['code-review', 'security-scan'],
    repository: 'grudge-studio/grudaide',
    author: 'Grudge Studio',
    tags: ['code-review', 'security', 'quality'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  async initialize(config: WorkerConfig): Promise<void> {
    this.config = config;
    // In production: initialize AI client, load model, warm up caches
    this.initialized = true;
    console.log('CodeReviewWorker initialized', { timeoutMs: config.timeoutMs });
  }

  async execute(task: Task): Promise<Record<string, unknown>> {
    if (!this.initialized) {
      throw new Error('Worker not initialized. Call initialize() first.');
    }

    const { pr, repo, head, base } = task.payload as {
      pr: number;
      repo: string;
      head: string;
      base: string;
    };

    console.log(`CodeReviewWorker: reviewing PR #${pr} in ${repo}`);

    // In production: call AI API to analyze diff, check for issues
    const findings = await this.analyzeCode({ pr, repo, head, base });

    return {
      pr,
      repo,
      status: 'reviewed',
      findings,
      reviewedAt: new Date().toISOString(),
    };
  }

  private async analyzeCode(context: {
    pr: number;
    repo: string;
    head: string;
    base: string;
  }): Promise<Array<{ severity: string; file: string; line: number; message: string }>> {
    // Simulate AI analysis
    // In production: fetch diff from GitHub, analyze with AI model
    await new Promise((r) => setTimeout(r, 100));

    return [
      {
        severity: 'info',
        file: 'src/index.ts',
        line: 1,
        message: `Reviewed commit ${context.head.slice(0, 7)} – looks good!`,
      },
    ];
  }

  async healthCheck(): Promise<WorkerHealthCheck> {
    return {
      workerId: this.id,
      healthy: this.initialized,
      checkedAt: new Date(),
      details: { initialized: this.initialized },
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    console.log('CodeReviewWorker shut down');
  }
}

// Example usage
async function runExample(): Promise<void> {
  // In a real deployment, workers are registered via the WorkerRegistry
  // and dispatched by the WorkerExecutor. This example shows standalone use.
  const worker = new CodeReviewWorker();

  await worker.initialize({ timeoutMs: 30000, maxRetries: 2 });

  const result = await worker.execute({
    id: 'task-001',
    type: 'code-review',
    priority: 'normal',
    status: 'running',
    payload: {
      pr: 42,
      repo: 'grudge-studio/my-app',
      head: 'abc1234def5678',
      base: 'main',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: 1,
    maxAttempts: 3,
    timeoutMs: 30000,
  });

  console.log('Review result:', result);

  const health = await worker.healthCheck();
  console.log('Health:', health);

  await worker.shutdown();
}

// Run if executed directly
if (require.main === module) {
  runExample().catch(console.error);
}
