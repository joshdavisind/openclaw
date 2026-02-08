/**
 * SQLite database layer for Memento
 */

import type { DatabaseSync } from "node:sqlite";
import type { Memory, MemoryRelationship } from "./types.js";

export interface MementoDatabase {
  db: DatabaseSync;
}

/**
 * Initialize the database schema
 */
export function initializeSchema(db: DatabaseSync): void {
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
    );
    
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp);
    CREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by);
    
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      type,
      content,
      content='memories',
      content_rowid='rowid'
    );
    
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
export function insertMemory(db: DatabaseSync, memory: Memory): void {
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
export function markAsSuperseded(
  db: DatabaseSync,
  memoryIds: string[],
  supersededBy: string,
): void {
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
  db: DatabaseSync,
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
export function getMemoryById(db: DatabaseSync, id: string): Memory | null {
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
export function isSuperseded(db: DatabaseSync, id: string): boolean {
  const stmt = db.prepare(`
    SELECT superseded_by FROM memories WHERE id = ?
  `);

  const row = stmt.get(id) as { superseded_by: string | null } | undefined;
  return row ? row.superseded_by !== null : false;
}

/**
 * Get supersession chain (all versions of a memory)
 */
export function getSupersessionChain(db: DatabaseSync, id: string): Memory[] {
  const chain: Memory[] = [];
  const visited = new Set<string>();

  // Get the starting memory
  const start = getMemoryById(db, id);
  if (!start) {
    return chain;
  }

  // Walk backwards to find the root
  let current = start;
  while (current.supersedes.length > 0) {
    const prevId = current.supersedes[0];
    const prev = getMemoryById(db, prevId);
    if (!prev || visited.has(prev.id)) break;

    visited.add(current.id);
    current = prev;
  }

  // Now current is the root, build the chain forward
  visited.clear();
  const root = current;
  chain.push(root);
  visited.add(root.id);

  // Walk forward from root to end
  let nextId = root.supersededBy;
  while (nextId && !visited.has(nextId)) {
    const next = getMemoryById(db, nextId);
    if (!next) break;

    chain.push(next);
    visited.add(next.id);
    nextId = next.supersededBy;
  }

  return chain;
}
