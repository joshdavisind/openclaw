import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { unlinkSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { Memento, MemoryType, createMemento } from "./index.js";

describe("Memento", () => {
  let memento: Memento;
  let dbPath: string;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `memento-test-${randomBytes(8).toString("hex")}`);
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, "memento.db");
    memento = new Memento(dbPath);
  });

  afterEach(() => {
    memento.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("constructor", () => {
    it("should create database file", () => {
      expect(existsSync(dbPath)).toBe(true);
    });

    it("should create directory if it doesn't exist", () => {
      const newDir = join(tmpdir(), `memento-new-${randomBytes(8).toString("hex")}`);
      const newDbPath = join(newDir, "test.db");

      const newMemento = new Memento(newDbPath);
      expect(existsSync(newDbPath)).toBe(true);

      newMemento.close();
      rmSync(newDir, { recursive: true, force: true });
    });
  });

  describe("add", () => {
    it("should add a memory", () => {
      const memory = memento.add({
        type: MemoryType.FACT,
        content: "User lives in Seattle",
        tags: ["location"],
      });

      expect(memory.id).toBeTruthy();
      expect(memory.type).toBe(MemoryType.FACT);
      expect(memory.content).toBe("User lives in Seattle");
    });
  });

  describe("get", () => {
    it("should retrieve a memory by id", () => {
      const created = memento.add({
        type: MemoryType.PREFERENCE,
        content: "User prefers TypeScript",
      });

      const retrieved = memento.get(created.id);
      expect(retrieved).toEqual(created);
    });

    it("should return null for non-existent id", () => {
      const retrieved = memento.get("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("update", () => {
    it("should update a memory", () => {
      const memory = memento.add({
        type: MemoryType.FACT,
        content: "Original",
      });

      const updated = memento.update(memory.id, {
        content: "Updated",
      });

      expect(updated).toBeTruthy();
      expect(updated!.content).toBe("Updated");
    });
  });

  describe("archive", () => {
    it("should archive a memory", () => {
      const memory = memento.add({
        type: MemoryType.TASK,
        content: "Task",
      });

      const success = memento.archive(memory.id);
      expect(success).toBe(true);

      const archived = memento.get(memory.id);
      expect(archived!.archivedAt).toBeTruthy();
    });
  });

  describe("unarchive", () => {
    it("should unarchive a memory", () => {
      const memory = memento.add({
        type: MemoryType.FACT,
        content: "Test",
      });

      memento.archive(memory.id);
      const success = memento.unarchive(memory.id);
      expect(success).toBe(true);

      const unarchived = memento.get(memory.id);
      expect(unarchived!.archivedAt).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete a memory", () => {
      const memory = memento.add({
        type: MemoryType.FACT,
        content: "Test",
      });

      const success = memento.delete(memory.id);
      expect(success).toBe(true);

      const deleted = memento.get(memory.id);
      expect(deleted).toBeNull();
    });
  });

  describe("query", () => {
    beforeEach(() => {
      memento.add({
        type: MemoryType.FACT,
        content: "User lives in Seattle",
        tags: ["location"],
      });

      memento.add({
        type: MemoryType.PREFERENCE,
        content: "User prefers TypeScript",
        tags: ["coding"],
      });

      memento.add({
        type: MemoryType.DECISION,
        content: "Chose React for frontend",
        tags: ["frontend"],
      });
    });

    it("should query memories", () => {
      const results = memento.query({
        query: "User",
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("memory");
      expect(results[0]).toHaveProperty("score");
      expect(results[0]).toHaveProperty("rank");
    });

    it("should filter by type", () => {
      const results = memento.query({
        types: [MemoryType.PREFERENCE],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.memory.type).toBe(MemoryType.PREFERENCE);
      }
    });

    it("should filter by tags", () => {
      const results = memento.query({
        tags: ["coding"],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.memory.tags).toContain("coding");
      }
    });

    it("should apply limit", () => {
      const results = memento.query({ limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      memento.add({ type: MemoryType.FACT, content: "Fact 1" });
      memento.add({ type: MemoryType.PREFERENCE, content: "Preference 1" });
      memento.add({ type: MemoryType.DECISION, content: "Decision 1" });
    });

    it("should list all memories", () => {
      const memories = memento.list();
      expect(memories).toHaveLength(3);
    });

    it("should filter by type", () => {
      const memories = memento.list({
        types: [MemoryType.FACT],
      });

      expect(memories.length).toBeGreaterThan(0);
      for (const memory of memories) {
        expect(memory.type).toBe(MemoryType.FACT);
      }
    });

    it("should apply limit", () => {
      const memories = memento.list({ limit: 2 });
      expect(memories).toHaveLength(2);
    });
  });

  describe("count", () => {
    it("should count memories", () => {
      memento.add({ type: MemoryType.FACT, content: "Test 1" });
      memento.add({ type: MemoryType.FACT, content: "Test 2" });

      const count = memento.count();
      expect(count).toBe(2);
    });

    it("should exclude archived by default", () => {
      const m1 = memento.add({ type: MemoryType.FACT, content: "Test 1" });
      memento.add({ type: MemoryType.FACT, content: "Test 2" });
      memento.archive(m1.id);

      const count = memento.count();
      expect(count).toBe(1);
    });

    it("should include archived when requested", () => {
      const m1 = memento.add({ type: MemoryType.FACT, content: "Test 1" });
      memento.add({ type: MemoryType.FACT, content: "Test 2" });
      memento.archive(m1.id);

      const count = memento.count({ includeArchived: true });
      expect(count).toBe(2);
    });
  });

  describe("getAgentDbPath", () => {
    it("should generate correct path", () => {
      const path = Memento.getAgentDbPath("test-agent");
      expect(path).toContain(".openclaw");
      expect(path).toContain("agents");
      expect(path).toContain("test-agent");
      expect(path).toContain("memento.db");
    });

    it("should use custom base directory", () => {
      const customBase = "/custom/path";
      const path = Memento.getAgentDbPath("test-agent", customBase);
      expect(path).toContain("/custom/path");
      expect(path).toContain("agents");
      expect(path).toContain("test-agent");
    });
  });
});

describe("createMemento", () => {
  it("should create Memento instance", () => {
    const testDir = join(tmpdir(), `memento-create-test-${randomBytes(8).toString("hex")}`);
    mkdirSync(testDir, { recursive: true });

    const memento = createMemento("test-agent", testDir);
    expect(memento).toBeInstanceOf(Memento);

    memento.close();
    rmSync(testDir, { recursive: true, force: true });
  });
});
