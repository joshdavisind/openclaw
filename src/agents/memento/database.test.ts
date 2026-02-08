import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { MementoDatabase } from "./database.js";
import { MemoryType } from "./types.js";

describe("MementoDatabase", () => {
  let db: MementoDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `memento-test-${randomBytes(8).toString("hex")}.db`);
    db = new MementoDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  describe("add", () => {
    it("should create a memory with all fields", () => {
      const memory = db.add({
        type: MemoryType.FACT,
        content: "User lives in Seattle",
        tags: ["location", "user"],
        confidence: 0.9,
        source: "conversation",
        context: { session: "abc123" },
      });

      expect(memory.id).toBeTruthy();
      expect(memory.type).toBe(MemoryType.FACT);
      expect(memory.content).toBe("User lives in Seattle");
      expect(memory.tags).toEqual(["location", "user"]);
      expect(memory.confidence).toBe(0.9);
      expect(memory.source).toBe("conversation");
      expect(memory.context).toEqual({ session: "abc123" });
      expect(memory.createdAt).toBeInstanceOf(Date);
      expect(memory.updatedAt).toBeInstanceOf(Date);
      expect(memory.archivedAt).toBeNull();
    });

    it("should create a memory with minimal fields", () => {
      const memory = db.add({
        type: MemoryType.PREFERENCE,
        content: "User prefers TypeScript",
      });

      expect(memory.id).toBeTruthy();
      expect(memory.type).toBe(MemoryType.PREFERENCE);
      expect(memory.content).toBe("User prefers TypeScript");
      expect(memory.tags).toEqual([]);
      expect(memory.confidence).toBe(1.0);
      expect(memory.source).toBeUndefined();
      expect(memory.context).toBeUndefined();
    });
  });

  describe("get", () => {
    it("should retrieve an existing memory", () => {
      const created = db.add({
        type: MemoryType.DECISION,
        content: "Chose React over Vue",
      });

      const retrieved = db.get(created.id);
      expect(retrieved).toEqual(created);
    });

    it("should return null for non-existent memory", () => {
      const retrieved = db.get("non-existent-id");
      expect(retrieved).toBeNull();
    });
  });

  describe("update", () => {
    it("should update memory content", () => {
      const memory = db.add({
        type: MemoryType.FACT,
        content: "Original content",
      });

      const updated = db.update(memory.id, {
        content: "Updated content",
      });

      expect(updated).toBeTruthy();
      expect(updated!.content).toBe("Updated content");
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(memory.updatedAt.getTime());
    });

    it("should update memory tags", () => {
      const memory = db.add({
        type: MemoryType.PREFERENCE,
        content: "Test",
        tags: ["old"],
      });

      const updated = db.update(memory.id, {
        tags: ["new", "tags"],
      });

      expect(updated!.tags).toEqual(["new", "tags"]);
    });

    it("should update memory confidence", () => {
      const memory = db.add({
        type: MemoryType.INSIGHT,
        content: "Test",
        confidence: 0.5,
      });

      const updated = db.update(memory.id, {
        confidence: 0.9,
      });

      expect(updated!.confidence).toBe(0.9);
    });

    it("should return null for non-existent memory", () => {
      const updated = db.update("non-existent", {
        content: "New content",
      });

      expect(updated).toBeNull();
    });
  });

  describe("archive", () => {
    it("should archive a memory", () => {
      const memory = db.add({
        type: MemoryType.TASK,
        content: "Complete project",
      });

      const success = db.archive(memory.id);
      expect(success).toBe(true);

      const archived = db.get(memory.id);
      expect(archived!.archivedAt).toBeInstanceOf(Date);
    });

    it("should not archive already archived memory", () => {
      const memory = db.add({
        type: MemoryType.FACT,
        content: "Test",
      });

      db.archive(memory.id);
      const success = db.archive(memory.id);
      expect(success).toBe(false);
    });

    it("should return false for non-existent memory", () => {
      const success = db.archive("non-existent");
      expect(success).toBe(false);
    });
  });

  describe("unarchive", () => {
    it("should unarchive a memory", () => {
      const memory = db.add({
        type: MemoryType.FACT,
        content: "Test",
      });

      db.archive(memory.id);
      const success = db.unarchive(memory.id);
      expect(success).toBe(true);

      const unarchived = db.get(memory.id);
      expect(unarchived!.archivedAt).toBeNull();
    });

    it("should return false for non-archived memory", () => {
      const memory = db.add({
        type: MemoryType.FACT,
        content: "Test",
      });

      const success = db.unarchive(memory.id);
      expect(success).toBe(false);
    });
  });

  describe("delete", () => {
    it("should permanently delete a memory", () => {
      const memory = db.add({
        type: MemoryType.FACT,
        content: "Test",
      });

      const success = db.delete(memory.id);
      expect(success).toBe(true);

      const deleted = db.get(memory.id);
      expect(deleted).toBeNull();
    });

    it("should return false for non-existent memory", () => {
      const success = db.delete("non-existent");
      expect(success).toBe(false);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      db.add({ type: MemoryType.FACT, content: "Fact 1", tags: ["tag1"] });
      db.add({ type: MemoryType.DECISION, content: "Decision 1", tags: ["tag2"] });
      db.add({ type: MemoryType.PREFERENCE, content: "Preference 1", tags: ["tag1", "tag2"] });
    });

    it("should list all memories", () => {
      const memories = db.list();
      expect(memories).toHaveLength(3);
    });

    it("should filter by type", () => {
      const memories = db.list({ types: [MemoryType.FACT] });
      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe(MemoryType.FACT);
    });

    it("should filter by multiple types", () => {
      const memories = db.list({
        types: [MemoryType.FACT, MemoryType.DECISION],
      });
      expect(memories).toHaveLength(2);
    });

    it("should filter by tags", () => {
      const memories = db.list({ tags: ["tag1"] });
      expect(memories).toHaveLength(2);
    });

    it("should exclude archived by default", () => {
      const memory = db.add({ type: MemoryType.FACT, content: "To archive" });
      db.archive(memory.id);

      const memories = db.list();
      expect(memories).toHaveLength(3); // Should not include archived
    });

    it("should include archived when requested", () => {
      const memory = db.add({ type: MemoryType.FACT, content: "To archive" });
      db.archive(memory.id);

      const memories = db.list({ includeArchived: true });
      expect(memories).toHaveLength(4); // Should include archived
    });

    it("should apply limit", () => {
      const memories = db.list({ limit: 2 });
      expect(memories).toHaveLength(2);
    });
  });

  describe("count", () => {
    it("should count all memories", () => {
      db.add({ type: MemoryType.FACT, content: "Test 1" });
      db.add({ type: MemoryType.FACT, content: "Test 2" });

      const count = db.count();
      expect(count).toBe(2);
    });

    it("should exclude archived by default", () => {
      const m1 = db.add({ type: MemoryType.FACT, content: "Test 1" });
      db.add({ type: MemoryType.FACT, content: "Test 2" });
      db.archive(m1.id);

      const count = db.count();
      expect(count).toBe(1);
    });

    it("should include archived when requested", () => {
      const m1 = db.add({ type: MemoryType.FACT, content: "Test 1" });
      db.add({ type: MemoryType.FACT, content: "Test 2" });
      db.archive(m1.id);

      const count = db.count({ includeArchived: true });
      expect(count).toBe(2);
    });
  });

  describe("search (FTS5)", () => {
    beforeEach(() => {
      db.add({
        type: MemoryType.FACT,
        content: "User prefers TypeScript for type safety",
        tags: ["typescript", "coding"],
      });
      db.add({
        type: MemoryType.PREFERENCE,
        content: "User likes functional programming",
        tags: ["coding", "style"],
      });
      db.add({
        type: MemoryType.DECISION,
        content: "Chose React for frontend framework",
        tags: ["react", "frontend"],
      });
    });

    it("should search by content", () => {
      const results = db.search("TypeScript");
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("TypeScript");
    });

    it("should search by tags", () => {
      const results = db.search("coding");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should return empty array for no matches", () => {
      const results = db.search("nonexistent");
      expect(results).toHaveLength(0);
    });

    it("should rank results", () => {
      const results = db.search("User");
      expect(results.length).toBeGreaterThan(0);
      // Results should have rank property
      expect(results[0]).toHaveProperty("rank");
    });
  });
});
