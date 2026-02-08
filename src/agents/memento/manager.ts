/**
 * Memento manager implementation
 */

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  ConflictResult,
  CreateMemoryParams,
  Memento,
  Memory,
  SearchMemoryParams,
} from "./types.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import {
  addRelationship,
  getMemoryById,
  getSupersessionChain,
  initializeSchema,
  insertMemory,
  isSuperseded,
  markAsSuperseded,
  rowToMemory,
} from "./database.js";

export interface MementoManagerOptions {
  dbPath: string;
}

export class MementoManager implements Memento {
  private db: DatabaseSync;

  constructor(options: MementoManagerOptions) {
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(options.dbPath);
    initializeSchema(this.db);
  }

  /**
   * Add a new memory
   */
  async add(params: CreateMemoryParams): Promise<Memory> {
    const memory: Memory = {
      id: randomUUID(),
      type: params.type,
      content: params.content,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      timestamp: Date.now(),
      supersedes: params.supersedes ?? [],
      relatedTo: params.relatedTo,
      metadata: params.metadata,
    };

    // If superseding other memories, do it in a transaction
    if (memory.supersedes.length > 0) {
      this.db.exec("BEGIN TRANSACTION");
      try {
        // Validate that all memories to supersede exist and aren't already superseded
        for (const oldId of memory.supersedes) {
          if (isSuperseded(this.db, oldId)) {
            throw new Error(`Cannot supersede memory ${oldId}: already superseded`);
          }
          const existing = getMemoryById(this.db, oldId);
          if (!existing) {
            throw new Error(`Cannot supersede memory ${oldId}: not found`);
          }
        }

        // Insert the new memory
        insertMemory(this.db, memory);

        // Mark old memories as superseded
        markAsSuperseded(this.db, memory.supersedes, memory.id);

        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    } else {
      insertMemory(this.db, memory);
    }

    return memory;
  }

  /**
   * Add a memory that supersedes existing ones
   */
  async addSuperseding(
    params: Omit<CreateMemoryParams, "supersedes">,
    supersedes: string[],
  ): Promise<Memory> {
    return this.add({ ...params, supersedes });
  }

  /**
   * Supersede a single memory
   */
  async supersede(
    oldId: string,
    newParams: Omit<CreateMemoryParams, "supersedes">,
  ): Promise<Memory> {
    return this.add({ ...newParams, supersedes: [oldId] });
  }

  /**
   * Mark memories as related
   */
  async relate(fromId: string, toId: string, type: string): Promise<void> {
    addRelationship(this.db, fromId, toId, type);
  }

  /**
   * Get memory by ID
   */
  async get(id: string): Promise<Memory | null> {
    return getMemoryById(this.db, id);
  }

  /**
   * Search memories
   */
  async search(params: SearchMemoryParams): Promise<Memory[]> {
    const {
      query,
      type,
      minScore = 0,
      maxResults = 20,
      includeSuperseded = false,
      agentId,
      timestampRange,
    } = params;

    let sql: string;
    const sqlParams: unknown[] = [];

    if (query) {
      // Use FTS5 for text search
      sql = `
        SELECT m.*, bm25(memories_fts) as score
        FROM memories m
        JOIN memories_fts ON m.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
      `;
      sqlParams.push(query);
    } else {
      // Simple table scan
      sql = `
        SELECT *, 0 as score
        FROM memories
        WHERE 1=1
      `;
    }

    // Filter by supersession status
    if (!includeSuperseded) {
      sql += ` AND superseded_by IS NULL`;
    }

    // Filter by type
    if (type) {
      const types = Array.isArray(type) ? type : [type];
      const placeholders = types.map(() => "?").join(",");
      sql += ` AND type IN (${placeholders})`;
      sqlParams.push(...types);
    }

    // Filter by agent
    if (agentId) {
      sql += ` AND agent_id = ?`;
      sqlParams.push(agentId);
    }

    // Filter by timestamp
    if (timestampRange?.start) {
      sql += ` AND timestamp >= ?`;
      sqlParams.push(timestampRange.start);
    }
    if (timestampRange?.end) {
      sql += ` AND timestamp <= ?`;
      sqlParams.push(timestampRange.end);
    }

    // Filter by minimum score
    if (query && minScore > 0) {
      sql += ` AND bm25(memories_fts) >= ?`;
      sqlParams.push(minScore);
    }

    // Order and limit
    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    sqlParams.push(maxResults);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...sqlParams) as Array<
      Parameters<typeof rowToMemory>[0] & { score: number }
    >;

    return rows.map((row) => {
      const { score: _, ...memoryRow } = row;
      return rowToMemory(memoryRow);
    });
  }

  /**
   * Check for conflicts with proposed memory
   */
  async checkConflicts(params: { type: string; content: string }): Promise<ConflictResult[]> {
    const { type, content } = params;

    // Use FTS5 to find similar content of the same type
    const stmt = this.db.prepare(`
      SELECT m.*, bm25(memories_fts) as score
      FROM memories m
      JOIN memories_fts ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
        AND m.type = ?
        AND m.superseded_by IS NULL
      ORDER BY bm25(memories_fts) DESC
      LIMIT 10
    `);

    const rows = stmt.all(content, type) as Array<
      Parameters<typeof rowToMemory>[0] & { score: number }
    >;

    // Normalize BM25 scores to 0-1 range
    // BM25 scores are negative (higher is better), so we need to normalize
    const maxScore = rows.length > 0 ? Math.abs(rows[0].score) : 1;

    return rows
      .map((row) => {
        const { score, ...memoryRow } = row;
        const similarity = maxScore > 0 ? Math.abs(score) / maxScore : 0;
        return {
          memory: rowToMemory(memoryRow),
          similarity,
        };
      })
      .filter((result) => result.similarity > 0.3); // Only return meaningful conflicts
  }

  /**
   * Get supersession chain
   */
  async getSupersessionChain(id: string): Promise<Memory[]> {
    return getSupersessionChain(this.db, id);
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    this.db.close();
  }
}

/**
 * Create a new Memento instance
 */
export function createMemento(options: MementoManagerOptions): Memento {
  return new MementoManager(options);
}
