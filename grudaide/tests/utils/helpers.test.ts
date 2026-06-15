/**
 * GRUDAIDE - Utility Helper Tests
 */

import {
  generateId,
  chunk,
  pick,
  omit,
  truncate,
  deepClone,
  errorMessage,
  isPlainObject,
} from "../../src/utils/helpers";

describe("generateId", () => {
  it("generates a uuid string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("prefixes the id", () => {
    const id = generateId("task");
    expect(id).toMatch(/^task-/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("chunk", () => {
  it("chunks an array into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("returns single chunk when size >= length", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });
});

describe("pick", () => {
  it("picks specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });
});

describe("omit", () => {
  it("omits specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["b"])).toEqual({ a: 1, c: 3 });
  });
});

describe("truncate", () => {
  it("truncates long strings", () => {
    const result = truncate("hello world", 5);
    expect(result).toHaveLength(5);
    expect(result).toMatch(/…$/);
  });

  it("returns original string if within limit", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
});

describe("deepClone", () => {
  it("creates an independent copy", () => {
    const original = { a: { b: 1 } };
    const clone = deepClone(original);
    clone.a.b = 99;
    expect(original.a.b).toBe(1);
  });
});

describe("errorMessage", () => {
  it("extracts message from Error", () => {
    expect(errorMessage(new Error("oops"))).toBe("oops");
  });

  it("converts non-error to string", () => {
    expect(errorMessage("raw string")).toBe("raw string");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("isPlainObject", () => {
  it("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("returns false for non-plain objects", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });
});
