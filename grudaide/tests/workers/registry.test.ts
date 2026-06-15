/**
 * GRUDAIDE - Worker Registry Tests
 */

import { WorkerRegistry, resetRegistry } from "../../src/workers/registry";
import { BaseWorker } from "../../src/workers/base";
import { WorkerConfig } from "../../src/config/schema";
import { WorkerContext } from "../../src/workers/types";

class EchoWorker extends BaseWorker {
  constructor(id = "echo-worker") {
    const config: WorkerConfig = {
      id,
      name: "Echo Worker",
      type: "custom",
      enabled: true,
      concurrency: 2,
      retryLimit: 0,
      retryDelay: 100,
      timeout: 5000,
      triggers: ["push"],
    };
    super(config);
  }

  async execute(context: WorkerContext): Promise<unknown> {
    return { echo: context.task.payload };
  }
}

class FailingWorker extends BaseWorker {
  constructor() {
    const config: WorkerConfig = {
      id: "failing-worker",
      name: "Failing Worker",
      type: "custom",
      enabled: true,
      concurrency: 1,
      retryLimit: 0,
      retryDelay: 100,
      timeout: 5000,
      triggers: ["push"],
    };
    super(config);
  }

  async execute(_context: WorkerContext): Promise<unknown> {
    throw new Error("Intentional failure");
  }
}

describe("WorkerRegistry", () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    resetRegistry();
    registry = new WorkerRegistry(5);
  });

  afterEach(async () => {
    await registry.stopAll();
  });

  it("registers and retrieves a worker", () => {
    const worker = new EchoWorker();
    registry.register(worker);
    expect(registry.get("echo-worker")).toBe(worker);
  });

  it("throws when registering duplicate worker id", () => {
    registry.register(new EchoWorker());
    expect(() => registry.register(new EchoWorker())).toThrow(/already registered/i);
  });

  it("lists workers by type", () => {
    registry.register(new EchoWorker("w1"));
    registry.register(new EchoWorker("w2"));
    const all = registry.list("custom");
    expect(all).toHaveLength(2);
  });

  it("dispatches a task to a worker", async () => {
    const worker = new EchoWorker();
    registry.register(worker);
    await registry.initializeAll();

    const result = await registry.dispatch("echo-worker", {
      trigger: "push",
      payload: { ref: "refs/heads/main" },
    });

    expect(result).toEqual({ echo: { ref: "refs/heads/main" } });
  });

  it("returns health report for all workers", () => {
    registry.register(new EchoWorker("w1"));
    registry.register(new EchoWorker("w2"));
    const health = registry.healthReport();
    expect(health).toHaveLength(2);
    expect(health[0]).toHaveProperty("workerId");
    expect(health[0]).toHaveProperty("status");
  });

  it("throws when dispatching to unknown worker", async () => {
    await expect(
      registry.dispatch("nonexistent", { trigger: "push" })
    ).rejects.toThrow(/not found/i);
  });

  it("unregisters a worker", async () => {
    const worker = new EchoWorker();
    registry.register(worker);
    await registry.unregister("echo-worker");
    expect(registry.get("echo-worker")).toBeUndefined();
  });

  it("broadcasts trigger to matching workers", async () => {
    const w1 = new EchoWorker("w1");
    const w2 = new EchoWorker("w2");
    registry.register(w1);
    registry.register(w2);
    await registry.initializeAll();

    // Should not throw even when workers return results
    await expect(
      registry.broadcast("push", { ref: "refs/heads/main" })
    ).resolves.toBeUndefined();
  });
});
