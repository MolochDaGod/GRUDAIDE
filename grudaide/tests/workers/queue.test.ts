/**
 * GRUDAIDE - Task Queue Tests
 */

import { TaskQueue } from "../../src/workers/queue";

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue(5);
  });

  afterEach(() => {
    queue.clear();
  });

  it("enqueues a task and returns an id", () => {
    const id = queue.enqueue({
      workerId: "w1",
      trigger: "push",
      payload: { ref: "main" },
    });
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^task-/);
  });

  it("retrieves a task by id", async () => {
    const id = queue.enqueue({ workerId: "w1", trigger: "push" });
    await queue.drain();
    const task = queue.get(id);
    expect(task).toBeDefined();
    expect(task?.workerId).toBe("w1");
  });

  it("cancels a pending task", async () => {
    // Use a queue with concurrency 0 to prevent immediate pickup
    const q = new TaskQueue(0);
    const id = q.enqueue({ workerId: "w1", trigger: "push" });
    const cancelled = q.cancel(id);
    expect(cancelled).toBe(true);
    expect(q.get(id)?.status).toBe("cancelled");
    q.clear();
  });

  it("completes a task", async () => {
    const id = queue.enqueue({ workerId: "w1", trigger: "push" });
    await queue.drain();
    queue.complete(id, { ok: true }, "completed");
    expect(queue.get(id)?.status).toBe("completed");
    expect(queue.get(id)?.result).toEqual({ ok: true });
  });

  it("marks a task as failed", async () => {
    const id = queue.enqueue({ workerId: "w1", trigger: "push" });
    await queue.drain();
    queue.complete(id, new Error("oops"), "failed");
    expect(queue.get(id)?.status).toBe("failed");
    expect(queue.get(id)?.error).toBe("oops");
  });

  it("lists tasks filtered by status", async () => {
    const id = queue.enqueue({ workerId: "w1", trigger: "push" });
    await queue.drain();
    queue.complete(id, {}, "completed");
    const completed = queue.list("completed");
    expect(completed.length).toBeGreaterThanOrEqual(1);
  });

  it("clears all tasks", async () => {
    queue.enqueue({ workerId: "w1", trigger: "push" });
    await queue.drain();
    queue.clear();
    expect(queue.list()).toHaveLength(0);
  });
});
