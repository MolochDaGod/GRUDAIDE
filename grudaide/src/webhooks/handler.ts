/**
 * GRUDAIDE - GitHub Webhook Handler
 * Verifies and dispatches incoming GitHub webhook events
 */

import * as crypto from "crypto";
import { IncomingMessage, ServerResponse } from "http";
import { createLogger } from "../utils/logger";
import { WebhookError } from "../utils/errors";
import { WorkerRegistry } from "../workers/registry";

const logger = createLogger("webhooks");

// Map GitHub event names to worker triggers
const EVENT_TRIGGER_MAP: Record<string, string> = {
  push: "push",
  pull_request: "pull_request",
  issues: "issues",
  issue_comment: "issue_comment",
  deployment: "deployment",
  deployment_status: "deployment_status",
  workflow_run: "workflow_run",
};

export interface WebhookHandlerOptions {
  secret: string;
  registry: WorkerRegistry;
}

/**
 * Verify a GitHub webhook signature (SHA-256 HMAC).
 */
export function verifySignature(
  payload: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const [algo, hex] = signature.split("=");
  if (algo !== "sha256" || !hex) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(hex, "hex");

  // Lengths must match for timingSafeEqual; reject immediately if they differ
  if (expectedBuf.length !== actualBuf.length) return false;

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Parse raw request body into a Buffer.
 */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Express-compatible webhook middleware factory.
 *
 * Usage:
 *   app.post('/webhooks', createWebhookHandler({ secret, registry }));
 */
export function createWebhookHandler(options: WebhookHandlerOptions) {
  const { secret, registry } = options;

  return async function webhookHandler(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await readBody(req);
    const headers = req.headers;
    const signature = Array.isArray(headers["x-hub-signature-256"])
      ? headers["x-hub-signature-256"][0]
      : headers["x-hub-signature-256"];
    const eventName = Array.isArray(headers["x-github-event"])
      ? headers["x-github-event"][0]
      : headers["x-github-event"];
    const deliveryId = Array.isArray(headers["x-github-delivery"])
      ? headers["x-github-delivery"][0]
      : headers["x-github-delivery"];

    // 1. Verify signature
    if (!verifySignature(body, signature, secret)) {
      logger.warn("Webhook signature verification failed", { deliveryId });
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid signature" }));
      return;
    }

    // 2. Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body.toString("utf-8"));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON payload" }));
      return;
    }

    logger.info(`Received webhook event: ${eventName}`, { deliveryId });

    // 3. Acknowledge immediately
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true, deliveryId }));

    // 4. Broadcast to workers asynchronously
    const trigger = EVENT_TRIGGER_MAP[eventName ?? ""] as
      | Parameters<typeof registry.broadcast>[0]
      | undefined;

    if (trigger) {
      registry
        .broadcast(trigger, { event: eventName, deliveryId, ...payload })
        .catch((err: unknown) => {
          logger.error(`Error broadcasting event ${eventName}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    } else {
      logger.debug(`No registered trigger mapping for event: ${eventName}`);
    }
  };
}
