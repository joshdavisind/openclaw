/**
 * Memento: OpenClaw's persistent memory system
 *
 * Public API for memory management
 */

import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { MementoDatabase } from "./database.js";
import { executeQuery } from "./query.js";
import type {
  Memory,
  MemoryQuery,
  QueryResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryType,
} from "./types.js";

export { MemoryType };
export type { Memory, MemoryQuery, QueryResult, CreateMemoryInput, UpdateMemoryInput };

/**
 * Main Memento class for memory operations
 */
export class Memento {
  private db: MementoDatabase;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = join(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new MementoDatabase(dbPath);
  }

  /**
   * Create a new memory
   */
  add(input: CreateMemoryInput): Memory {
    return this.db.add(input);
  }

  /**
   * Get memory by ID
   */
  get(id: string): Memory | null {
    return this.db.get(id);
  }

  /**
   * Update an existing memory
   */
  update(id: string, input: UpdateMemoryInput): Memory | null {
    return this.db.update(id, input);
  }

  /**
   * Archive (soft delete) a memory
   */
  archive(id: string): boolean {
    return this.db.archive(id);
  }

  /**
   * Unarchive a memory
   */
  unarchive(id: string): boolean {
    return this.db.unarchive(id);
  }

  /**
   * Permanently delete a memory
   */
  delete(id: string): boolean {
    return this.db.delete(id);
  }

  /**
   * Query memories with advanced filtering and ranking
   */
  query(query: MemoryQuery): QueryResult[] {
    return executeQuery(this.db, query);
  }

  /**
   * List all memories (optionally filtered by type/tags)
   */
  list(options: {
    types?: MemoryType[];
    tags?: string[];
    includeArchived?: boolean;
    limit?: number;
  } = {}): Memory[] {
    return this.db.list(options);
  }

  /**
   * Count total memories
   */
  count(options: { includeArchived?: boolean } = {}): number {
    return this.db.count(options);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get database path for an agent
   */
  static getAgentDbPath(agentId: string, baseDir?: string): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
    const base = baseDir ?? join(home, ".openclaw");
    return join(base, "agents", agentId, "memento.db");
  }
}

/**
 * Create a Memento instance for an agent
 */
export function createMemento(agentId: string, baseDir?: string): Memento {
  const dbPath = Memento.getAgentDbPath(agentId, baseDir);
  return new Memento(dbPath);
}
