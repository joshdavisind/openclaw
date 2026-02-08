/**
 * Consolidation state tracker
 * 
 * Manages which daily notes have been processed and when,
 * enabling idempotent consolidation.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConsolidationState, ProcessedFileState } from "./types.js";

export class StateTracker {
  private statePath: string;
  private state: ConsolidationState;
  
  constructor(stateDir: string) {
    this.statePath = path.join(stateDir, "state.json");
    this.state = {
      lastConsolidation: "",
      processedFiles: [],
    };
  }
  
  /**
   * Load state from disk
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.statePath, "utf-8");
      this.state = JSON.parse(data);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // State file doesn't exist yet, use defaults
        this.state = {
          lastConsolidation: "",
          processedFiles: [],
        };
      } else {
        throw err;
      }
    }
  }
  
  /**
   * Save state to disk
   */
  async save(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.statePath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write state
    await fs.writeFile(
      this.statePath,
      JSON.stringify(this.state, null, 2),
      "utf-8",
    );
  }
  
  /**
   * Get current state
   */
  getState(): ConsolidationState {
    return { ...this.state };
  }
  
  /**
   * Check if a file needs processing
   * Returns true if file is new or modified since last processing
   */
  needsProcessing(filepath: string, mtime: Date): boolean {
    const existing = this.state.processedFiles.find((f) => f.path === filepath);
    
    if (!existing) {
      return true; // New file
    }
    
    const lastModified = new Date(existing.lastModified);
    return mtime > lastModified;
  }
  
  /**
   * Mark a file as processed
   */
  markProcessed(
    filepath: string,
    mtime: Date,
    memoryCount: number,
    contentHash?: string,
  ): void {
    const existing = this.state.processedFiles.find((f) => f.path === filepath);
    const now = new Date().toISOString();
    
    if (existing) {
      existing.lastModified = mtime.toISOString();
      existing.lastProcessed = now;
      existing.memoryCount = memoryCount;
      existing.contentHash = contentHash;
    } else {
      this.state.processedFiles.push({
        path: filepath,
        lastModified: mtime.toISOString(),
        lastProcessed: now,
        memoryCount,
        contentHash,
      });
    }
    
    this.state.lastConsolidation = now;
  }
  
  /**
   * Get list of pending files from a set of candidates
   */
  getPendingFiles(files: Array<{ path: string; mtime: Date }>): string[] {
    return files
      .filter((file) => this.needsProcessing(file.path, file.mtime))
      .map((file) => file.path);
  }
  
  /**
   * Get processed file state
   */
  getProcessedFileState(filepath: string): ProcessedFileState | undefined {
    return this.state.processedFiles.find((f) => f.path === filepath);
  }
  
  /**
   * Get all processed files
   */
  getAllProcessedFiles(): ProcessedFileState[] {
    return [...this.state.processedFiles];
  }
  
  /**
   * Reset state (for force re-processing)
   */
  reset(): void {
    this.state = {
      lastConsolidation: "",
      processedFiles: [],
    };
  }
  
  /**
   * Get last consolidation timestamp
   */
  getLastConsolidation(): string {
    return this.state.lastConsolidation;
  }
  
  /**
   * Compute content hash for duplicate detection
   */
  static computeContentHash(content: string): string {
    return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
  }
}

/**
 * Create state tracker for an agent
 */
export function createStateTracker(stateDir: string): StateTracker {
  return new StateTracker(stateDir);
}
