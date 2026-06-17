import { Octokit } from '@octokit/rest';
import { getLogger, getErrorMessage, withRetry } from '../utils';

export interface DataRecord {
  id: string;
  type: string;
  data: Record<string, unknown>;
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
  issueNumber?: number;
}

export interface IssueStorageOptions {
  owner: string;
  repo: string;
  octokit: Octokit;
  labelPrefix?: string;
}

const DATA_MARKER = '<!-- grudaide-data -->';
const DATA_END_MARKER = '<!-- /grudaide-data -->';

/**
 * Uses GitHub Issues as a structured data storage backend.
 * Each record is stored as a JSON block inside an issue body.
 */
export class GitHubIssueStorage {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly labelPrefix: string;

  constructor(options: IssueStorageOptions) {
    this.octokit = options.octokit;
    this.owner = options.owner;
    this.repo = options.repo;
    this.labelPrefix = options.labelPrefix ?? 'grudaide';
  }

  /**
   * Create a new data record as a GitHub Issue.
   */
  async create(
    type: string,
    data: Record<string, unknown>,
    title: string,
    labels: string[] = [],
  ): Promise<DataRecord> {
    const allLabels = [`${this.labelPrefix}:${type}`, ...labels];

    // Ensure labels exist
    await this.ensureLabels(allLabels);

    const record: DataRecord = {
      id: `${type}-${Date.now()}`,
      type,
      data,
      labels: allLabels,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const body = this.serializeRecord(record);

    const response = await withRetry(
      () =>
        this.octokit.issues.create({
          owner: this.owner,
          repo: this.repo,
          title: `[GRUDAIDE:${type.toUpperCase()}] ${title}`,
          body,
          labels: allLabels,
        }),
      { maxAttempts: 3 },
      `Create issue for ${type}`,
    );

    record.issueNumber = response.data.number;
    record.id = String(response.data.number);

    getLogger().info('Data record created', {
      type,
      issueNumber: record.issueNumber,
      owner: this.owner,
      repo: this.repo,
    });

    return record;
  }

  /**
   * Update an existing data record by issue number.
   */
  async update(
    issueNumber: number,
    data: Partial<Record<string, unknown>>,
  ): Promise<DataRecord> {
    const existing = await this.get(issueNumber);
    const updated: DataRecord = {
      ...existing,
      data: { ...existing.data, ...data },
      updatedAt: new Date(),
    };

    const body = this.serializeRecord(updated);

    await withRetry(
      () =>
        this.octokit.issues.update({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          body,
        }),
      { maxAttempts: 3 },
      `Update issue ${issueNumber}`,
    );

    return updated;
  }

  /**
   * Retrieve a data record by issue number.
   */
  async get(issueNumber: number): Promise<DataRecord> {
    const response = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    const record = this.deserializeRecord(response.data.body ?? '');
    if (!record) {
      throw new Error(`Issue #${issueNumber} does not contain a valid GRUDAIDE data block`);
    }

    record.issueNumber = issueNumber;
    record.labels = response.data.labels
      .map((l) => (typeof l === 'string' ? l : l.name ?? ''))
      .filter(Boolean);

    return record;
  }

  /**
   * List all data records of a given type.
   */
  async list(type: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<DataRecord[]> {
    const response = await this.octokit.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      labels: `${this.labelPrefix}:${type}`,
      state,
      per_page: 100,
    });

    const records: DataRecord[] = [];
    for (const issue of response.data) {
      const record = this.deserializeRecord(issue.body ?? '');
      if (record) {
        record.issueNumber = issue.number;
        records.push(record);
      }
    }
    return records;
  }

  /**
   * Close (soft-delete) a data record.
   */
  async close(issueNumber: number): Promise<void> {
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: 'closed',
    });
    getLogger().info('Data record closed', { issueNumber });
  }

  private serializeRecord(record: DataRecord): string {
    const json = JSON.stringify({ ...record, issueNumber: undefined }, null, 2);
    return `${DATA_MARKER}\n\`\`\`json\n${json}\n\`\`\`\n${DATA_END_MARKER}`;
  }

  private deserializeRecord(body: string): DataRecord | null {
    const start = body.indexOf(DATA_MARKER);
    const end = body.indexOf(DATA_END_MARKER);
    if (start === -1 || end === -1) return null;

    const block = body.slice(start + DATA_MARKER.length, end);
    const jsonMatch = block.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      return {
        id: String(parsed['id'] ?? ''),
        type: String(parsed['type'] ?? ''),
        data: (parsed['data'] ?? {}) as Record<string, unknown>,
        labels: (parsed['labels'] ?? []) as string[],
        createdAt: new Date(String(parsed['createdAt'])),
        updatedAt: new Date(String(parsed['updatedAt'])),
      };
    } catch (error) {
      getLogger().warn('Failed to deserialize data record', { error: getErrorMessage(error) });
      return null;
    }
  }

  private async ensureLabels(labels: string[]): Promise<void> {
    for (const label of labels) {
      try {
        await this.octokit.issues.getLabel({
          owner: this.owner,
          repo: this.repo,
          name: label,
        });
      } catch {
        // Label doesn't exist – create it
        try {
          await this.octokit.issues.createLabel({
            owner: this.owner,
            repo: this.repo,
            name: label,
            color: 'e4e669',
            description: 'GRUDAIDE managed label',
          });
        } catch (createError) {
          // Race condition – label created by another request; ignore
          getLogger().debug('Label already exists or creation failed', {
            label,
            error: getErrorMessage(createError),
          });
        }
      }
    }
  }
}
