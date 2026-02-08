/**
 * SQLite database layer for Memento
 */

import Database from "better-sqlite3";
import type { Memory, MemoryRelationship } from "./types.js";

export interface MementoDatabase {
  db: Database.Database;
}

/**
 * Initialize the database schema
 */
export function initializeSchema(db: Database.Database): void {
  // Main memories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_key TEXT,
      timestamp INTEGER NOT NULL,
      supersedes TEXT NOT NULL DEFAULT '[]', -- JSON array of IDs
      superseded_by TEXT,
      related_to TEXT, -- JSON array of relationships
      metadata TEXT, -- JSON object
      embedding BLOB -- Optional vector embedding
    )
  `);

  // Index for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp);
    CREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by);
  `);

  // FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      type,
      content,
      content='memories',
      content_rowid='rowid'
    );
  `);

  // Triggers to keep FTS table in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, id, type, content)
      VALUES (new.rowid, new.id, new.type, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE rowid = old.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
      DELETE FROM memories_fts WHERE rowid = old.rowid;
      INSERT INTO memories_fts(rowid, id, type, content)
      VALUES (new.rowid, new.id, new.type, new.content);
    END;
  `);
}

/**
 * Convert database row to Memory object
 */
export function rowToMemory(row: {
  id: string;
  type: string;
  content: string;
  agent_id: string;
  session_key: string | null;
  timestamp: number;
  supersedes: string;
  superseded_by: string | null;
  related_to: string | null;
  metadata: string | null;
  embedding: Buffer | null;
}): Memory {
  const supersedes = JSON.parse(row.supersedes) as string[];
  const relatedTo = row.related_to
    ? (JSON.parse(row.related_to) as MemoryRelationship[])
    : undefined;
  const metadata = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined;
  const embedding = row.embedding ? new Float32Array(row.embedding.buffer) : undefined;

  return {
    id: row.id,
    type: row.type,
    content: row.content,
    agentId: row.agent_id,
    sessionKey: row.session_key ?? undefined,
    timestamp: row.timestamp,
    supersedes,
    supersededBy: row.superseded_by ?? undefined,
    relatedTo,
    metadata,
    embedding,
  };
}

/**
 * Insert a memory into the database
 */
export function insertMemory(db: Database.Database, memory: Memory): void {
  const stmt = db.prepare(`
    INSERT INTO memories (
      id, type, content, agent_id, session_key, timestamp,
      supersedes, superseded_by, related_to, metadata, embedding
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    memory.id,
    memory.type,
    memory.content,
    memory.agentId,
    memory.sessionKey ?? null,
    memory.timestamp,
    JSON.stringify(memory.supersedes),
    memory.supersededBy ?? null,
    memory.relatedTo ? JSON.stringify(memory.relatedTo) : null,
    memory.metadata ? JSON.stringify(memory.metadata) : null,
    memory.embedding ? Buffer.from(memory.embedding.buffer) : null,
  );
}

/**
 * Update superseded_by field for memories
 */
export function markAsSuperseded(db: Database.Database, memoryIds: string[], supersededBy: string): void {
  if (memoryIds.length === 0) return;

  const placeholders = memoryIds.map(() => "?").join(",");
  const stmt = db.prepare(`
    UPDATE memories
    SET superseded_by = ?
    WHERE id IN (${placeholders})
  `);

  stmt.run(supersededBy, ...memoryIds);
}

/**
 * Add a relationship between memories
 */
export function addRelationship(
  db: Database.Database,
  fromId: string,
  toId: string,
  type: string,
): void {
  const stmt = db.prepare(`
    SELECT related_to FROM memories WHERE id = ?
  `);

  const row = stmt.get(fromId) as { related_to: string | null } | undefined;
  if (!row) {
    throw new Error(`Memory not found: ${fromId}`);
  }

  const relatedTo = row.related_to ? (JSON.parse(row.related_to) as MemoryRelationship[]) : [];
  relatedTo.push({ type, targetId: toId });

  const updateStmt = db.prepare(`
    UPDATE memories SET related_to = ? WHERE id = ?
  `);
  updateStmt.run(JSON.stringify(relatedTo), fromId);
}

/**
 * Get memory by ID
 */
export function getMemoryById(db: Database.Database, id: string): Memory | null {
  const stmt = db.prepare(`
    SELECT * FROM memories WHERE id = ?
  `);

  const row = stmt.get(id) as ReturnType<typeof rowToMemory> extends infer T
    ? T extends Memory
      ? Parameters<typeof rowToMemory>[0]
      : never
    : never;

  if (!row) {
    return null;
  }

  return rowToMemory(row);
}

/**
 * Check if a memory has already been superseded
 */
export function isSuperseded(db: Database.Database, id: string): boolean {
  const stmt = db.prepare(`
    SELECT superseded_by FROM memories WHERE id = ?
  `);

  const row = stmt.get(id) as { superseded_by: string | null } | undefined;
  return row ? row.superseded_by !== null : false;
}

/**
 * Get supersession chain (all versions of a memory)
 */
export function getSupersessionChain(db: Database.Database, id: string): Memory[] {
  const chain: Memory[] = [];
  const visited = new Set<string>();
  
  // Get the starting memory
  let current = getMemoryById(db, id);
  if (!current) {
    return chain;
  }

  // Walk backwards to find the root
  while (current.supersedes.length > 0 && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift(current);
    
    // Find the first predecessor
    const prevId = current.supersedes[0];
    const prev = getMemoryById(db, prevId);
    if (!prev) break;
    
    current = prev;
  }

  // Add the root if not already added
  if (!visited.has(current.id)) {
    chain.unshift(current);
    visited.add(current.id);
  }

  // Walk forward to find all successors
  let nextId = current.supersededBy;
  while (nextId && !visited.has(nextId)) {
    const next = getMemoryById(db, nextId);
    if (!next) break;
    
    visited.add(next.id);
    chain.push(next);
    nextId = next.supersededBy;
  }

  return chain;
}
