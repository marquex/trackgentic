import { describe, test, expect } from "bun:test";
import { generateId, generateCommentId } from "../../src/core/id";

describe("generateId", () => {
  test("generates IDs that are exactly 10 characters", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateId();
      expect(id.length).toBe(10);
    }
  });

  test("generates IDs containing only base36 characters", () => {
    const base36Regex = /^[0-9a-z]+$/;
    for (let i = 0; i < 100; i++) {
      const id = generateId();
      expect(base36Regex.test(id)).toBe(true);
    }
  });

  test("generates unique IDs (100 samples, no duplicates)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});

describe("generateCommentId", () => {
  test("generates IDs that are exactly 10 characters", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateCommentId();
      expect(id.length).toBe(10);
    }
  });

  test("generates IDs containing only base36 characters", () => {
    const base36Regex = /^[0-9a-z]+$/;
    for (let i = 0; i < 100; i++) {
      const id = generateCommentId();
      expect(base36Regex.test(id)).toBe(true);
    }
  });

  test("generates unique IDs (100 samples, no duplicates)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCommentId());
    }
    expect(ids.size).toBe(100);
  });
});
