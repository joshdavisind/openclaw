/**
 * Tests for consolidation state tracker
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createStateTracker, StateTracker } from "./state.js";

describe("StateTracker", () => {
  let tempDir: string;
  let stateDir: string;
  
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memento-test-"));
    stateDir = path.join(tempDir, "state");
    await fs.mkdir(stateDir, { recursive: true });
  });
  
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  
  test("initializes with empty state", async () => {
    const tracker = createStateTracker(stateDir);
    await tracker.load();
    
    const state = tracker.getState();
    expect(state.lastConsolidation).toBe("");
    expect(state.processedFiles).toEqual([]);
  });
  
  test("marks file as processed", async () => {
    const tracker = createStateTracker(stateDir);
    await tracker.load();
    
    const filepath = "/tmp/2026-02-08.md";
    const mtime = new Date("2026-02-08T12:00:00Z");
    
    tracker.markProcessed(filepath, mtime, 5);
    
    const state = tracker.getState();
    expect(state.processedFiles).toHaveLength(1);
    expect(state.processedFiles[0].path).toBe(filepath);
    expect(state.processedFiles[0].memoryCount).toBe(5);
    expect(state.lastConsolidation).toBeTruthy();
  });
  
  test("detects files needing processing", async () => {
    const tracker = createStateTracker(stateDir);
    await tracker.load();
    
    const filepath = "/tmp/2026-02-08.md";
    const oldMtime = new Date("2026-02-08T12:00:00Z");
    const newMtime = new Date("2026-02-08T13:00:00Z");
    
    tracker.markProcessed(filepath, oldMtime, 5);
    
    expect(tracker.needsProcessing(filepath, oldMtime)).toBe(false);
    expect(tracker.needsProcessing(filepath, newMtime)).toBe(true);
  });
  
  test("identifies new files as needing processing", async () => {
    const tracker = createStateTracker(stateDir);
    await tracker.load();
    
    const filepath = "/tmp/2026-02-08.md";
    const mtime = new Date();
    
    expect(tracker.needsProcessing(filepath, mtime)).toBe(true);
  });
  
  test("saves and loads state", async () => {
    const tracker1 = createStateTracker(stateDir);
    await tracker1.load();
    
    const filepath = "/tmp/2026-02-08.md";
    const mtime = new Date("2026-02-08T12:00:00Z");
    tracker1.markProcessed(filepath, mtime, 5);
    
    await tracker1.save();
    
    // Load in new tracker
    const tracker2 = createStateTracker(stateDir);
    await tracker2.load();
    
    const state = tracker2.getState();
    expect(state.processedFiles).toHaveLength(1);
    expect(state.processedFiles[0].path).toBe(filepath);
    expect(state.processedFiles[0].memoryCount).toBe(5);
  });
  
  test("gets pending files", async () => {
    const tracker = createStateTracker(stateDir);
    await tracker.load();
    
    const file1 = "/tmp/2026-02-07.md";
    const file2 = "/tmp/2026-02-08.md";
    const file3 = "/tmp/2026-02-09.md";
    const oldTime = new Date("2026-02-08T12:00:00Z");
    const newTime = new Date("2026-02-08T13:00:00Z");
    
    tracker.markProcessed(file1, oldTime, 3);
    tracker.markProcessed(file2, oldTime, 5);
    
    const files = [
      { path: file1, mtime: oldTime },
      { path: file2, mtime: newTime }, // Modified
      { path: file3, mtime: newTime }, // New
    ];
    
    const pending = tracker.getPendingFiles(files);
    
    expect(pending).toHaveLength(2);
    expect(pending).toContain(file2);
    expect(pending).toContain(file3);
  });
  
  test("resets state", async () => {
    const tracker = createStateTracker(stateDir);
    await tracker.load();
    
    tracker.markProcessed("/tmp/test.md", new Date(), 5);
    tracker.reset();
    
    const state = tracker.getState();
    expect(state.lastConsolidation).toBe("");
    expect(state.processedFiles).toEqual([]);
  });
  
  test("computes content hash", () => {
    const content1 = "Test content";
    const content2 = "Test content";
    const content3 = "Different content";
    
    const hash1 = StateTracker.computeContentHash(content1);
    const hash2 = StateTracker.computeContentHash(content2);
    const hash3 = StateTracker.computeContentHash(content3);
    
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
  
  test("updates existing file state", async () => {
    const tracker = createStateTracker(stateDir);
    await tracker.load();
    
    const filepath = "/tmp/2026-02-08.md";
    const time1 = new Date("2026-02-08T12:00:00Z");
    const time2 = new Date("2026-02-08T13:00:00Z");
    
    tracker.markProcessed(filepath, time1, 5);
    tracker.markProcessed(filepath, time2, 8);
    
    const state = tracker.getState();
    expect(state.processedFiles).toHaveLength(1);
    expect(state.processedFiles[0].memoryCount).toBe(8);
  });
});
