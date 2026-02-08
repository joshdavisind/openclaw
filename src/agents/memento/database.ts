/**
 * SQLite database layer for Memento memory system
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Memory,
  MemoryRow,
  CreateMemoryInput,
  UpdateMemoryInput,
  FTSResultRow,
} from "./types.js";

/**
 * Database schema SQL
 */
const SCHEMA_SQL = `
-- Main memories table
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT,
  context TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_archived_at ON memories(archived_at);
CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  content,
  tags,
  content='memories',
  content_rowid='rowid'
);

-- Triggers to keep FTS5 in sync with memories table
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, id, content, tags)
  VALUES (new.rowid, new.id, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  UPDATE memories_fts 
  SET content = new.content, tags = new.tags
  WHERE rowid = new.rowid;
END;
`;

/**
 * Convert database row to Memory object
 */
function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    type: row.type as Memory["type"],
    content: row.content,
    tags: JSON.parse(row.tags),
    confidence: row.confidence,
    source: row.source ?? undefined,
    context: row.context ? JSON.parse(row.context) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
  };
}

/**
 * Database manager for Memento
 */
export class MementoDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Create a new memory
   */
  add(input: CreateMemoryInput): Memory {
    const id = randomUUID();
    const now = Date.now();
    const tags = JSON.stringify(input.tags ?? []);
    const context = input.context ? JSON.stringify(input.context) : null;
    const confidence = input.confidence ?? 1.0;

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, type, content, tags, confidence, source, context, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.type,
      input.content,
      tags,
      confidence,
      input.source ?? null,
      context,
      now,
      now,
    );

    return this.get(id)!;
  }

  /**
   * Get memory by ID
   */
  get(id: string): Memory | null {
    const stmt = this.db.prepare("SELECT * FROM memories WHERE id = ?");
    const row = stmt.get(id) as MemoryRow | null;
    return row ? rowToMemory(row) : null;
  }

  /**
   * Update an existing memory
   */
  update(id: string, input: UpdateMemoryInput): Memory | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = Date.now();
    const updates: string[] = [];
    const values: any[] = [];

    if (input.content !== undefined) {
      updates.push("content = ?");
      values.push(input.content);
    }

    if (input.tags !== undefined) {
      updates.push("tags = ?");
      values.push(JSON.stringify(input.tags));
    }

    if (input.confidence !== undefined) {
      updates.push("confidence = ?");
      values.push(input.confidence);
    }

    if (input.context !== undefined) {
      updates.push("context = ?");
      values.push(JSON.stringify(input.context));
    }

    if (updates.length === 0) return existing;

    updates.push("updated_at = ?");
    values.push(now);
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE memories
      SET ${updates.join(", ")}
      WHERE id = ?
    `);

    stmt.run(...values);
    return this.get(id);
  }

  /**
   * Archive (soft delete) a memory
   */
  archive(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE memories
      SET archived_at = ?
      WHERE id = ? AND archived_at IS NULL
    `);

    const result = stmt.run(Date.now(), id);
    return result.changes > 0;
  }

  /**
   * Unarchive a memory
   */
  unarchive(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE memories
      SET archived_at = NULL
      WHERE id = ? AND archived_at IS NOT NULL
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Permanently delete a memory
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM memories WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Get all memories (optionally filtered)
   */
  list(options: {
    types?: string[];
    tags?: string[];
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Memory[] {
    let sql = "SELECT * FROM memories WHERE 1=1";
    const values: any[] = [];

    if (!options.includeArchived) {
      sql += " AND archived_at IS NULL";
    }

    if (options.types && options.types.length > 0) {
      sql += ` AND type IN (${options.types.map(() => "?").join(",")})`;
      values.push(...options.types);
    }

    if (options.tags && options.tags.length > 0) {
      // OR logic for tags: match if any tag is present
      const tagConditions = options.tags.map(() => "tags LIKE ?").join(" OR ");
      sql += ` AND (${tagConditions})`;
      for (const tag of options.tags) {
        values.push(`%"${tag}"%`);
      }
    }

    sql += " ORDER BY created_at DESC";

    if (options.limit) {
      sql += " LIMIT ?";
      values.push(options.limit);
    }

    if (options.offset) {
      sql += " OFFSET ?";
      values.push(options.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  /**
   * Count total memories
   */
  count(options: { includeArchived?: boolean } = {}): number {
    let sql = "SELECT COUNT(*) as count FROM memories";
    if (!options.includeArchived) {
      sql += " WHERE archived_at IS NULL";
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Full-text search using FTS5
   */
  search(query: string): FTSResultRow[] {
    const stmt = this.db.prepare(`
      SELECT 
        m.*,
        -rank as rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.id
      WHERE memories_fts MATCH ?
      ORDER BY rank
    `);

    const rows = stmt.all(query) as FTSResultRow[];
    return rows;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get the raw database instance (for advanced operations)
   */
  getRaw(): DatabaseSync {
    return this.db;
  }
}
