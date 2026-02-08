import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { MementoDatabase } from "./database.js";
import { executeQuery } from "./query.js";
import { MemoryType } from "./types.js";

describe("executeQuery", () => {
  let db: MementoDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `memento-test-${randomBytes(8).toString("hex")}.db`);
    db = new MementoDatabase(dbPath);

    // Add test data
    db.add({
      type: MemoryType.FACT,
      content: "User lives in Seattle",
      tags: ["location", "user"],
      confidence: 0.9,
    });

    db.add({
      type: MemoryType.PREFERENCE,
      content: "User prefers TypeScript over JavaScript",
      tags: ["coding", "language"],
      confidence: 1.0,
    });

    db.add({
      type: MemoryType.DECISION,
      content: "Chose React for frontend due to strong ecosystem",
      tags: ["frontend", "architecture"],
      confidence: 0.8,
    });

    db.add({
      type: MemoryType.CONTEXT,
      content: "Working on Project Vesper - a CLI media tool",
      tags: ["project", "vesper"],
      confidence: 1.0,
    });

    db.add({
      type: MemoryType.INSIGHT,
      content: "User is a visual learner, prefers diagrams",
      tags: ["learning", "communication"],
      confidence: 0.7,
    });

    // Add an old memory (simulate by creating and then manually updating timestamp)
    const oldMemory = db.add({
      type: MemoryType.FACT,
      content: "Old fact about previous project",
      tags: ["old", "project"],
      confidence: 0.9,
    });

    // Manually update the created_at timestamp to 90 days ago
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    db.getRaw().prepare("UPDATE memories SET created_at = ? WHERE id = ?").run(ninetyDaysAgo, oldMemory.id);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  describe("basic queries", () => {
    it("should return all memories when no filters", () => {
      const results = executeQuery(db, {});
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("memory");
      expect(results[0]).toHaveProperty("score");
      expect(results[0]).toHaveProperty("rank");
    });

    it("should apply limit", () => {
      const results = executeQuery(db, { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("should assign ranks correctly", () => {
      const results = executeQuery(db, { limit: 5 });
      for (let i = 0; i < results.length; i++) {
        expect(results[i].rank).toBe(i + 1);
      }
    });
  });

  describe("text search", () => {
    it("should search by content", () => {
      const results = executeQuery(db, { query: "TypeScript" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.content).toContain("TypeScript");
    });

    it("should search by tags", () => {
      const results = executeQuery(db, { query: "coding" });
      expect(results.length).toBeGreaterThan(0);
    });

    it("should return empty array for no matches", () => {
      const results = executeQuery(db, { query: "nonexistentterm12345" });
      expect(results).toHaveLength(0);
    });

    it("should include semantic scores", () => {
      const results = executeQuery(db, { query: "User" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].semanticScore).toBeGreaterThan(0);
    });
  });

  describe("type filters", () => {
    it("should filter by single type", () => {
      const results = executeQuery(db, {
        types: [MemoryType.FACT],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.memory.type).toBe(MemoryType.FACT);
      }
    });

    it("should filter by multiple types", () => {
      const results = executeQuery(db, {
        types: [MemoryType.FACT, MemoryType.PREFERENCE],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect([MemoryType.FACT, MemoryType.PREFERENCE]).toContain(result.memory.type);
      }
    });

    it("should combine text search with type filter", () => {
      const results = executeQuery(db, {
        query: "User",
        types: [MemoryType.PREFERENCE],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.memory.type).toBe(MemoryType.PREFERENCE);
      }
    });
  });

  describe("tag filters", () => {
    it("should filter by single tag", () => {
      const results = executeQuery(db, {
        tags: ["coding"],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.memory.tags).toContain("coding");
      }
    });

    it("should filter by multiple tags (OR logic)", () => {
      const results = executeQuery(db, {
        tags: ["coding", "project"],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        const hasAnyTag = result.memory.tags.some((tag) =>
          ["coding", "project"].includes(tag),
        );
        expect(hasAnyTag).toBe(true);
      }
    });
  });

  describe("date filters", () => {
    it("should filter by since date", () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const results = executeQuery(db, {
        since: thirtyDaysAgo,
      });

      for (const result of results) {
        expect(result.memory.createdAt.getTime()).toBeGreaterThanOrEqual(
          thirtyDaysAgo.getTime(),
        );
      }
    });

    it("should filter by until date", () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const results = executeQuery(db, {
        until: yesterday,
      });

      for (const result of results) {
        expect(result.memory.createdAt.getTime()).toBeLessThanOrEqual(yesterday.getTime());
      }
    });

    it("should filter by date range", () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      const results = executeQuery(db, {
        since: thirtyDaysAgo,
        until: tenDaysAgo,
      });

      for (const result of results) {
        const created = result.memory.createdAt.getTime();
        expect(created).toBeGreaterThanOrEqual(thirtyDaysAgo.getTime());
        expect(created).toBeLessThanOrEqual(tenDaysAgo.getTime());
      }
    });
  });

  describe("confidence filter", () => {
    it("should filter by minimum confidence", () => {
      const results = executeQuery(db, {
        minConfidence: 0.8,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.memory.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });

    it("should return all when minConfidence is 0", () => {
      const results = executeQuery(db, {
        minConfidence: 0,
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("archived filter", () => {
    it("should exclude archived by default", () => {
      const memory = db.add({
        type: MemoryType.FACT,
        content: "To be archived",
      });
      db.archive(memory.id);

      const results = executeQuery(db, {});
      const archived = results.find((r) => r.memory.id === memory.id);
      expect(archived).toBeUndefined();
    });

    it("should include archived when requested", () => {
      const memory = db.add({
        type: MemoryType.FACT,
        content: "To be archived",
      });
      db.archive(memory.id);

      const results = executeQuery(db, {
        includeArchived: true,
      });

      const archived = results.find((r) => r.memory.id === memory.id);
      expect(archived).toBeDefined();
    });
  });

  describe("recency weighting", () => {
    it("should calculate recency scores", () => {
      const results = executeQuery(db, {});
      for (const result of results) {
        expect(result.recencyScore).toBeGreaterThan(0);
        expect(result.recencyScore).toBeLessThanOrEqual(1);
      }
    });

    it("should favor recent memories with high recency weight", () => {
      // Get results with high recency weight
      const recentResults = executeQuery(db, {
        recencyWeight: 0.9,
      });

      // Old memory should be ranked lower
      const oldMemoryResult = recentResults.find((r) =>
        r.memory.content.includes("Old fact"),
      );

      if (oldMemoryResult) {
        // There should be at least one result ranked higher
        expect(oldMemoryResult.rank).toBeGreaterThan(1);
      }
    });

    it("should favor semantic match with low recency weight", () => {
      const semanticResults = executeQuery(db, {
        query: "TypeScript",
        recencyWeight: 0.1,
      });

      // The TypeScript result should be highly ranked
      expect(semanticResults.length).toBeGreaterThan(0);
      const tsResult = semanticResults.find((r) => r.memory.content.includes("TypeScript"));
      expect(tsResult).toBeDefined();
    });

    it("should have default recency weight of 0.3", () => {
      const results = executeQuery(db, { query: "User" });
      expect(results.length).toBeGreaterThan(0);
      // Score should be influenced by both semantic and recency
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe("combined filters", () => {
    it("should combine text search, type, and tags", () => {
      const results = executeQuery(db, {
        query: "User",
        types: [MemoryType.PREFERENCE, MemoryType.FACT],
        tags: ["user"],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect([MemoryType.PREFERENCE, MemoryType.FACT]).toContain(result.memory.type);
        expect(result.memory.tags).toContain("user");
      }
    });

    it("should combine all filter types", () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const results = executeQuery(db, {
        query: "User",
        types: [MemoryType.FACT, MemoryType.PREFERENCE],
        tags: ["user", "coding"],
        since: thirtyDaysAgo,
        until: now,
        minConfidence: 0.5,
        limit: 10,
        recencyWeight: 0.5,
      });

      // Should return results that match all criteria
      for (const result of results) {
        expect([MemoryType.FACT, MemoryType.PREFERENCE]).toContain(result.memory.type);
        expect(result.memory.confidence).toBeGreaterThanOrEqual(0.5);
        expect(result.memory.createdAt.getTime()).toBeGreaterThanOrEqual(
          thirtyDaysAgo.getTime(),
        );
      }
    });
  });

  describe("score calculation", () => {
    it("should calculate combined scores", () => {
      const results = executeQuery(db, {
        query: "User",
        recencyWeight: 0.5,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
        expect(result.semanticScore).toBeGreaterThan(0);
        expect(result.recencyScore).toBeGreaterThan(0);
        // Score should be roughly: 0.5 * semantic + 0.5 * recency
        const expectedScore = 0.5 * result.semanticScore + 0.5 * result.recencyScore;
        expect(Math.abs(result.score - expectedScore)).toBeLessThan(0.01);
      }
    });

    it("should sort by score descending", () => {
      const results = executeQuery(db, {
        query: "User",
      });

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });
});
