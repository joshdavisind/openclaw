/**
 * Tests for consolidation engine
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../../config/config.js";
import {
  closeConsolidationContext,
  consolidateMemories,
  createConsolidationContext,
} from "./consolidate.js";

// Mock the extractor to avoid LLM calls in tests
vi.mock("./extractor.js", () => ({
  extractMemoriesFromNotes: vi.fn(async (notes) => {
    const results = new Map();
    for (const note of notes) {
      results.set(note.filepath, {
        memories: [
          {
            id: `mem-${note.date}-1`,
            type: "FACT",
            content: `Test fact from ${note.date}`,
            confidence: 0.9,
            sourceFile: note.filepath,
            extractedAt: new Date().toISOString(),
            createdAt: note.date,
          },
        ],
        processingTime: 100,
        model: "test-model",
      });
    }
    return results;
  }),
}));

describe("consolidateMemories", () => {
  let tempDir: string;
  let workspaceDir: string;
  let stateDir: string;
  
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memento-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    stateDir = path.join(tempDir, "state");
    
    // Create memory directory structure
    const memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    
    // Create sample daily notes
    await fs.writeFile(
      path.join(memoryDir, "2026-02-07.md"),
      "# 2026-02-07\n\n## Morning\nTest content",
    );
    await fs.writeFile(
      path.join(memoryDir, "2026-02-08.md"),
      "# 2026-02-08\n\n## Morning\nMore test content",
    );
  });
  
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  
  test("consolidates all daily notes", async () => {
    const config = loadConfig();
    const ctx = await createConsolidationContext(workspaceDir, stateDir, config);
    
    try {
      const stats = await consolidateMemories(ctx, {
        agentId: "test",
      });
      
      expect(stats.filesProcessed).toBe(2);
      expect(stats.memoriesExtracted).toBe(2);
      expect(stats.byType.FACT).toBe(2);
    } finally {
      closeConsolidationContext(ctx);
    }
  });
  
  test("consolidates specific date", async () => {
    const config = loadConfig();
    const ctx = await createConsolidationContext(workspaceDir, stateDir, config);
    
    try {
      const stats = await consolidateMemories(ctx, {
        agentId: "test",
        date: "2026-02-08",
      });
      
      expect(stats.filesProcessed).toBe(1);
      expect(stats.memoriesExtracted).toBe(1);
    } finally {
      closeConsolidationContext(ctx);
    }
  });
  
  test("consolidates date range", async () => {
    const config = loadConfig();
    const ctx = await createConsolidationContext(workspaceDir, stateDir, config);
    
    try {
      const stats = await consolidateMemories(ctx, {
        agentId: "test",
        from: "2026-02-07",
        to: "2026-02-07",
      });
      
      expect(stats.filesProcessed).toBe(1);
      expect(stats.memoriesExtracted).toBe(1);
    } finally {
      closeConsolidationContext(ctx);
    }
  });
  
  test("idempotency: processes pending files only", async () => {
    const config = loadConfig();
    const ctx = await createConsolidationContext(workspaceDir, stateDir, config);
    
    try {
      // First consolidation
      const stats1 = await consolidateMemories(ctx, {
        agentId: "test",
      });
      expect(stats1.filesProcessed).toBe(2);
      
      // Second consolidation (nothing pending)
      const stats2 = await consolidateMemories(ctx, {
        agentId: "test",
        pending: true,
      });
      expect(stats2.filesProcessed).toBe(0);
      expect(stats2.memoriesExtracted).toBe(0);
      
      // Modify a file
      const memoryDir = path.join(workspaceDir, "memory");
      await fs.appendFile(
        path.join(memoryDir, "2026-02-08.md"),
        "\n\n## New content",
      );
      
      // Third consolidation (one pending)
      const stats3 = await consolidateMemories(ctx, {
        agentId: "test",
        pending: true,
      });
      expect(stats3.filesProcessed).toBe(1);
    } finally {
      closeConsolidationContext(ctx);
    }
  });
  
  test("force flag re-processes all files", async () => {
    const config = loadConfig();
    const ctx = await createConsolidationContext(workspaceDir, stateDir, config);
    
    try {
      // First consolidation
      await consolidateMemories(ctx, {
        agentId: "test",
      });
      
      // Force re-consolidation
      const stats = await consolidateMemories(ctx, {
        agentId: "test",
        force: true,
      });
      
      expect(stats.filesProcessed).toBe(2);
    } finally {
      closeConsolidationContext(ctx);
    }
  });
  
  test("handles empty memory directory", async () => {
    const emptyWorkspace = path.join(tempDir, "empty-workspace");
    const emptyMemoryDir = path.join(emptyWorkspace, "memory");
    await fs.mkdir(emptyMemoryDir, { recursive: true });
    
    const config = loadConfig();
    const ctx = await createConsolidationContext(emptyWorkspace, stateDir, config);
    
    try {
      const stats = await consolidateMemories(ctx, {
        agentId: "test",
      });
      
      expect(stats.filesProcessed).toBe(0);
      expect(stats.memoriesExtracted).toBe(0);
    } finally {
      closeConsolidationContext(ctx);
    }
  });
  
  test("tracks confidence distribution", async () => {
    const config = loadConfig();
    const ctx = await createConsolidationContext(workspaceDir, stateDir, config);
    
    try {
      const stats = await consolidateMemories(ctx, {
        agentId: "test",
      });
      
      expect(stats.byConfidence.high).toBeGreaterThan(0);
      expect(stats.processingTime).toBeGreaterThan(0);
    } finally {
      closeConsolidationContext(ctx);
    }
  });
});
