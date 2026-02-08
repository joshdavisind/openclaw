/**
 * Tests for memory store
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createMemoryStore, type MemoryStore } from "./store.js";
import type { Memory, MemoryType } from "./types.js";

describe("MemoryStore", () => {
  let tempDir: string;
  let dbPath: string;
  let store: MemoryStore;
  
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memento-test-"));
    dbPath = path.join(tempDir, "memories.sqlite");
    store = createMemoryStore(dbPath);
  });
  
  afterEach(() => {
    store.close();
  });
  
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  
  test("inserts memory", () => {
    const memory: Memory = {
      id: "test-1",
      type: "FACT",
      content: "Test fact",
      confidence: 0.9,
      sourceFile: "/tmp/2026-02-08.md",
      sourceLine: 10,
      extractedAt: new Date().toISOString(),
      createdAt: "2026-02-08",
      entities: ["Test"],
    };
    
    store.insert(memory);
    
    const retrieved = store.getById("test-1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.type).toBe("FACT");
    expect(retrieved?.content).toBe("Test fact");
    expect(retrieved?.confidence).toBe(0.9);
  });
  
  test("inserts batch of memories", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "Fact 1",
        confidence: 0.9,
        sourceFile: "/tmp/2026-02-08.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-2",
        type: "DECISION",
        content: "Decision 1",
        confidence: 0.8,
        sourceFile: "/tmp/2026-02-08.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
    ];
    
    store.insertBatch(memories);
    
    expect(store.getTotalCount()).toBe(2);
    expect(store.getById("test-1")).toBeDefined();
    expect(store.getById("test-2")).toBeDefined();
  });
  
  test("gets memories by type", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "Fact",
        confidence: 0.9,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-2",
        type: "DECISION",
        content: "Decision",
        confidence: 0.8,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-3",
        type: "FACT",
        content: "Another fact",
        confidence: 0.85,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
    ];
    
    store.insertBatch(memories);
    
    const facts = store.getByType("FACT");
    expect(facts).toHaveLength(2);
    expect(facts.every((m) => m.type === "FACT")).toBe(true);
  });
  
  test("gets memories by source file", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "Fact 1",
        confidence: 0.9,
        sourceFile: "/tmp/2026-02-08.md",
        sourceLine: 5,
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-2",
        type: "FACT",
        content: "Fact 2",
        confidence: 0.8,
        sourceFile: "/tmp/2026-02-08.md",
        sourceLine: 10,
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-3",
        type: "FACT",
        content: "Fact 3",
        confidence: 0.85,
        sourceFile: "/tmp/2026-02-09.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-09",
      },
    ];
    
    store.insertBatch(memories);
    
    const fileMemories = store.getBySourceFile("/tmp/2026-02-08.md");
    expect(fileMemories).toHaveLength(2);
    expect(fileMemories[0].sourceLine).toBe(5);
    expect(fileMemories[1].sourceLine).toBe(10);
  });
  
  test("gets memories by date range", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "Fact 1",
        confidence: 0.9,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-07",
      },
      {
        id: "test-2",
        type: "FACT",
        content: "Fact 2",
        confidence: 0.8,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-3",
        type: "FACT",
        content: "Fact 3",
        confidence: 0.85,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-09",
      },
    ];
    
    store.insertBatch(memories);
    
    const rangeMemories = store.getByDateRange("2026-02-08", "2026-02-09");
    expect(rangeMemories).toHaveLength(2);
    expect(rangeMemories.every((m) => m.createdAt >= "2026-02-08")).toBe(true);
  });
  
  test("gets memories by confidence range", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "High confidence",
        confidence: 0.95,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-2",
        type: "FACT",
        content: "Medium confidence",
        confidence: 0.6,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-3",
        type: "FACT",
        content: "Low confidence",
        confidence: 0.3,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
    ];
    
    store.insertBatch(memories);
    
    const highConfidence = store.getByConfidenceRange(0.9);
    expect(highConfidence).toHaveLength(1);
    expect(highConfidence[0].confidence).toBeGreaterThanOrEqual(0.9);
  });
  
  test("deletes memories by source file", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "Fact 1",
        confidence: 0.9,
        sourceFile: "/tmp/2026-02-08.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-2",
        type: "FACT",
        content: "Fact 2",
        confidence: 0.8,
        sourceFile: "/tmp/2026-02-09.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-09",
      },
    ];
    
    store.insertBatch(memories);
    
    const deleted = store.deleteBySourceFile("/tmp/2026-02-08.md");
    
    expect(deleted).toBe(1);
    expect(store.getTotalCount()).toBe(1);
    expect(store.getById("test-1")).toBeUndefined();
    expect(store.getById("test-2")).toBeDefined();
  });
  
  test("gets count by type", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "Fact",
        confidence: 0.9,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-2",
        type: "FACT",
        content: "Another fact",
        confidence: 0.8,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-3",
        type: "DECISION",
        content: "Decision",
        confidence: 0.85,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
    ];
    
    store.insertBatch(memories);
    
    const counts = store.getCountByType();
    expect(counts.FACT).toBe(2);
    expect(counts.DECISION).toBe(1);
    expect(counts.PREFERENCE).toBe(0);
  });
  
  test("gets count by confidence range", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "High",
        confidence: 0.95,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-2",
        type: "FACT",
        content: "Good",
        confidence: 0.8,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-3",
        type: "FACT",
        content: "Medium",
        confidence: 0.6,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-4",
        type: "FACT",
        content: "Low",
        confidence: 0.3,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
    ];
    
    store.insertBatch(memories);
    
    const counts = store.getCountByConfidenceRange();
    expect(counts.high).toBe(1);
    expect(counts.good).toBe(1);
    expect(counts.medium).toBe(1);
    expect(counts.low).toBe(1);
  });
  
  test("checks if memory exists", () => {
    const memory: Memory = {
      id: "test-1",
      type: "FACT",
      content: "Test",
      confidence: 0.9,
      sourceFile: "/tmp/test.md",
      extractedAt: new Date().toISOString(),
      createdAt: "2026-02-08",
    };
    
    store.insert(memory);
    
    expect(store.exists("test-1")).toBe(true);
    expect(store.exists("non-existent")).toBe(false);
  });
  
  test("gets status", () => {
    const memories: Memory[] = [
      {
        id: "test-1",
        type: "FACT",
        content: "Fact",
        confidence: 0.9,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
      {
        id: "test-2",
        type: "DECISION",
        content: "Decision",
        confidence: 0.8,
        sourceFile: "/tmp/test.md",
        extractedAt: new Date().toISOString(),
        createdAt: "2026-02-08",
      },
    ];
    
    store.insertBatch(memories);
    
    const status = store.getStatus();
    expect(status.totalMemories).toBe(2);
    expect(status.memoriesByType.FACT).toBe(1);
    expect(status.memoriesByType.DECISION).toBe(1);
    expect(status.storageLocation).toBe(dbPath);
    expect(status.storageSize).toBeGreaterThan(0);
  });
});
