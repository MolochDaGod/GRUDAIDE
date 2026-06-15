/**
 * GRUDAIDE - GitHub Issues Data Layer
 * Use GitHub Issues as a structured data store
 */

import { Octokit } from "@octokit/rest";
import { createLogger } from "../utils/logger";
import { StorageError } from "../utils/errors";
import { StorageConfig } from "../config/schema";

const logger = createLogger("storage");

export interface DataRecord<T = unknown> {
  key: string;
  value: T;
  version: number;
  createdAt: string;
  updatedAt: string;
  issueNumber?: number;
}

export interface StorageWriteOptions {
  /** If true, don't overwrite an existing record with the same key */
  createOnly?: boolean;
}

const DATA_FENCE_START = "<!-- grudaide-data:start -->";
const DATA_FENCE_END = "<!-- grudaide-data:end -->";

function encodeBody<T>(record: DataRecord<T>): string {
  return `${DATA_FENCE_START}\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n${DATA_FENCE_END}`;
}

function decodeBody<T>(body: string): DataRecord<T> | null {
  const start = body.indexOf(DATA_FENCE_START);
  const end = body.indexOf(DATA_FENCE_END);
  if (start === -1 || end === -1) return null;
  const inner = body.slice(start + DATA_FENCE_START.length, end);
  const match = inner.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as DataRecord<T>;
  } catch {
    return null;
  }
}

export class GitHubStorage {
  private readonly octokit: Octokit;
  private readonly config: StorageConfig;

  constructor(octokit: Octokit, config: StorageConfig) {
    this.octokit = octokit;
    this.config = config;
  }

  // ─── Ensure labels exist ─────────────────────────────────────────────────

  private async ensureLabel(name: string, color = "0075ca"): Promise<void> {
    const { owner, repo } = this.config;
    try {
      await this.octokit.issues.getLabel({ owner, repo, name });
    } catch {
      try {
        await this.octokit.issues.createLabel({ owner, repo, name, color });
      } catch {
        // May already exist – ignore
      }
    }
  }

  // ─── CRUD operations ─────────────────────────────────────────────────────

  /**
   * Read a data record by key.
   */
  async get<T = unknown>(key: string): Promise<DataRecord<T> | null> {
    const { owner, repo } = this.config;
    const title = `${this.config.dataPrefix}${key}`;

    const { data: issues } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      labels: this.config.issueDataLabel,
      state: "open",
      per_page: 100,
    });

    const issue = issues.find((i) => i.title === title);
    if (!issue || !issue.body) return null;

    const record = decodeBody<T>(issue.body);
    if (!record) return null;
    record.issueNumber = issue.number;
    return record;
  }

  /**
   * Write (upsert) a data record. Creates a new issue or updates an existing one.
   */
  async set<T = unknown>(
    key: string,
    value: T,
    options: StorageWriteOptions = {}
  ): Promise<DataRecord<T>> {
    const { owner, repo } = this.config;
    const title = `${this.config.dataPrefix}${key}`;

    await this.ensureLabel(this.config.issueDataLabel);

    const existing = await this.get<T>(key);

    if (existing && options.createOnly) {
      throw new StorageError(`Record already exists for key: ${key}`, { key });
    }

    const now = new Date().toISOString();

    if (existing?.issueNumber) {
      // Update
      const record: DataRecord<T> = {
        ...existing,
        value,
        version: existing.version + 1,
        updatedAt: now,
      };
      const body = encodeBody(record);
      await this.octokit.issues.update({
        owner,
        repo,
        issue_number: existing.issueNumber,
        body,
      });
      record.issueNumber = existing.issueNumber;
      logger.debug(`Updated storage record: ${key} (v${record.version})`);
      return record;
    }

    // Create
    const record: DataRecord<T> = {
      key,
      value,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const body = encodeBody(record);
    const { data: issue } = await this.octokit.issues.create({
      owner,
      repo,
      title,
      body,
      labels: [this.config.issueDataLabel],
    });
    record.issueNumber = issue.number;
    logger.info(`Created storage record: ${key} (issue #${issue.number})`);
    return record;
  }

  /**
   * Delete a data record by closing the issue.
   */
  async delete(key: string): Promise<boolean> {
    const { owner, repo } = this.config;
    const existing = await this.get(key);
    if (!existing?.issueNumber) return false;

    await this.octokit.issues.update({
      owner,
      repo,
      issue_number: existing.issueNumber,
      state: "closed",
    });
    logger.info(`Deleted storage record: ${key} (issue #${existing.issueNumber})`);
    return true;
  }

  /**
   * List all keys in the data store.
   */
  async listKeys(): Promise<string[]> {
    const { owner, repo } = this.config;
    const { data: issues } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      labels: this.config.issueDataLabel,
      state: "open",
      per_page: 100,
    });

    const prefix = this.config.dataPrefix;
    return issues
      .filter((i) => i.title.startsWith(prefix))
      .map((i) => i.title.slice(prefix.length));
  }
}
