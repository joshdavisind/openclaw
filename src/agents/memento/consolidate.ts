/**
 * Memory consolidation engine
 * 
 * Orchestrates the full consolidation pipeline:
 * parse -> extract -> store -> update state
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ReturnType as ConfigType } from "../../config/io.js";
import { extractMemoriesFromNotes } from "./extractor.js";
import {
  filterByDateRange,
  getDailyNote,
  listDailyNotes,
  parseDailyNote,
  type DailyNote,
} from "./parser.js";
import { createStateTracker, StateTracker } from "./state.js";
import { createMemoryStore, MemoryStore } from "./store.js";
import type {
  ConsolidateOptions,
  ConsolidationStats,
  Memory,
  MemoryType,
} from "./types.js";

export interface ConsolidationContext {
  memoryDir: string;
  stateDir: string;
  dbPath: string;
  config: ConfigType;
  store: MemoryStore;
  stateTracker: StateTracker;
}

/**
 * Create consolidation context for an agent
 */
export async function createConsolidationContext(
  workspaceDir: string,
  stateDir: string,
  config: ConfigType,
): Promise<ConsolidationContext> {
  const memoryDir = path.join(workspaceDir, "memory");
  const mementoStateDir = path.join(stateDir, "memento");
  const dbPath = path.join(mementoStateDir, "memories.sqlite");
  
  // Ensure directories exist
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.mkdir(mementoStateDir, { recursive: true });
  
  // Create store and state tracker
  const store = createMemoryStore(dbPath);
  const stateTracker = createStateTracker(mementoStateDir);
  await stateTracker.load();
  
  return {
    memoryDir,
    stateDir: mementoStateDir,
    dbPath,
    config,
    store,
    stateTracker,
  };
}

/**
 * Close consolidation context
 */
export function closeConsolidationContext(ctx: ConsolidationContext): void {
  ctx.store.close();
}

/**
 * Consolidate memories from daily notes
 */
export async function consolidateMemories(
  ctx: ConsolidationContext,
  options: ConsolidateOptions,
): Promise<ConsolidationStats> {
  const startTime = Date.now();
  
  // Determine which files to process
  const filesToProcess = await determineFilesToProcess(ctx, options);
  
  if (filesToProcess.length === 0) {
    return {
      filesProcessed: 0,
      memoriesExtracted: 0,
      byType: {
        FACT: 0,
        DECISION: 0,
        PREFERENCE: 0,
        OBSERVATION: 0,
        TASK: 0,
        CONTEXT: 0,
      },
      byConfidence: {
        high: 0,
        good: 0,
        medium: 0,
        low: 0,
      },
      processingTime: Date.now() - startTime,
    };
  }
  
  // Parse notes
  const notes: DailyNote[] = [];
  for (const filepath of filesToProcess) {
    try {
      const note = await parseDailyNote(filepath);
      notes.push(note);
    } catch (err) {
      if (options.verbose) {
        console.error(`Failed to parse ${filepath}:`, err);
      }
    }
  }
  
  if (notes.length === 0) {
    return {
      filesProcessed: 0,
      memoriesExtracted: 0,
      byType: {
        FACT: 0,
        DECISION: 0,
        PREFERENCE: 0,
        OBSERVATION: 0,
        TASK: 0,
        CONTEXT: 0,
      },
      byConfidence: {
        high: 0,
        good: 0,
        medium: 0,
        low: 0,
      },
      processingTime: Date.now() - startTime,
    };
  }
  
  // Extract memories
  const extractionResults = await extractMemoriesFromNotes(
    notes,
    ctx.config,
    options.agentId,
    {
      verbose: options.verbose,
      onProgress: options.verbose
        ? (current, total, filepath) => {
            console.log(
              `Extracting memories [${current}/${total}]: ${path.basename(filepath)}`,
            );
          }
        : undefined,
    },
  );
  
  // Store memories and update state
  const allMemories: Memory[] = [];
  for (const note of notes) {
    const result = extractionResults.get(note.filepath);
    if (!result || result.memories.length === 0) {
      // Mark as processed even if no memories extracted
      ctx.stateTracker.markProcessed(
        note.filepath,
        note.stats.mtime,
        0,
        StateTracker.computeContentHash(note.content),
      );
      continue;
    }
    
    // Store memories
    try {
      ctx.store.insertBatch(result.memories);
      allMemories.push(...result.memories);
      
      // Update state
      ctx.stateTracker.markProcessed(
        note.filepath,
        note.stats.mtime,
        result.memories.length,
        StateTracker.computeContentHash(note.content),
      );
      
      if (options.verbose) {
        console.log(
          `Stored ${result.memories.length} memories from ${path.basename(note.filepath)}`,
        );
      }
    } catch (err) {
      if (options.verbose) {
        console.error(`Failed to store memories from ${note.filepath}:`, err);
      }
    }
  }
  
  // Save state
  await ctx.stateTracker.save();
  
  // Compute statistics
  const stats = computeStats(allMemories);
  stats.filesProcessed = notes.length;
  stats.processingTime = Date.now() - startTime;
  
  return stats;
}

/**
 * Determine which files to process based on options
 */
async function determineFilesToProcess(
  ctx: ConsolidationContext,
  options: ConsolidateOptions,
): Promise<string[]> {
  // Reset state if force flag is set
  if (options.force) {
    ctx.stateTracker.reset();
  }
  
  // Specific date
  if (options.date) {
    const filepath = await getDailyNote(ctx.memoryDir, options.date);
    if (!filepath) {
      throw new Error(`Daily note not found for date: ${options.date}`);
    }
    return [filepath];
  }
  
  // Date range
  if (options.from || options.to) {
    const allFiles = await listDailyNotes(ctx.memoryDir);
    return filterByDateRange(allFiles, options.from, options.to);
  }
  
  // Pending files
  if (options.pending) {
    const allFiles = await listDailyNotes(ctx.memoryDir);
    const filesWithStats = await Promise.all(
      allFiles.map(async (filepath) => {
        const stats = await fs.stat(filepath);
        return { path: filepath, mtime: stats.mtime };
      }),
    );
    return ctx.stateTracker.getPendingFiles(filesWithStats);
  }
  
  // Default: all files
  return listDailyNotes(ctx.memoryDir);
}

/**
 * Compute consolidation statistics
 */
function computeStats(memories: Memory[]): ConsolidationStats {
  const byType: Record<MemoryType, number> = {
    FACT: 0,
    DECISION: 0,
    PREFERENCE: 0,
    OBSERVATION: 0,
    TASK: 0,
    CONTEXT: 0,
  };
  
  const byConfidence = {
    high: 0,
    good: 0,
    medium: 0,
    low: 0,
  };
  
  for (const memory of memories) {
    byType[memory.type]++;
    
    if (memory.confidence >= 0.9) {
      byConfidence.high++;
    } else if (memory.confidence >= 0.7) {
      byConfidence.good++;
    } else if (memory.confidence >= 0.5) {
      byConfidence.medium++;
    } else {
      byConfidence.low++;
    }
  }
  
  return {
    filesProcessed: 0, // Set by caller
    memoriesExtracted: memories.length,
    byType,
    byConfidence,
    processingTime: 0, // Set by caller
  };
}
