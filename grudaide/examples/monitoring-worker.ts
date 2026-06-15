/**
 * GRUDAIDE - Example: Monitoring Worker
 * Tracks repository health and sends alerts on anomalies
 */

import { BaseWorker } from "../../src/workers/base";
import { WorkerContext } from "../../src/workers/types";
import { WorkerConfig } from "../../src/config/schema";

interface IssuePayload {
  action?: string;
  issue?: {
    number?: number;
    title?: string;
    labels?: Array<{ name: string }>;
  };
}

export class MonitoringWorker extends BaseWorker {
  private issueCount = 0;

  constructor() {
    const config: WorkerConfig = {
      id: "monitoring-worker",
      name: "Monitoring Worker",
      type: "monitoring",
      enabled: true,
      concurrency: 10,
      retryLimit: 1,
      retryDelay: 2000,
      timeout: 30_000,
      triggers: ["issues", "pull_request", "workflow_run"],
    };
    super(config);
  }

  async execute(context: WorkerContext): Promise<unknown> {
    const { task } = context;
    const payload = task.payload as IssuePayload;

    if (task.trigger === "issues" && payload.action === "opened") {
      this.issueCount++;
      this.logger.info("New issue opened", {
        issueNumber: payload.issue?.number,
        title: payload.issue?.title,
        totalTracked: this.issueCount,
      });
    }

    // In a real worker you might:
    // - Check CI status and alert on repeated failures
    // - Track metrics over time using StateManager
    // - Send notifications via Slack/Discord

    return { processed: true, trigger: task.trigger };
  }
}
