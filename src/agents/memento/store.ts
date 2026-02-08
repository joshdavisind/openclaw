/**
 * Memory store
 * 
 * SQLite-backed storage for consolidated memories.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Memory, MemoryType, MementoStatus } from "./types.js";

export class MemoryStore {
  private db: Database.Database;
  private dbPath: string;
  
  constructor(dbPath: string) {
    this.dbPath = dbPath;
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.initializeSchema();
  }
  
  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        source_file TEXT NOT NULL,
        source_line INTEGER,
        extracted_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        entities TEXT,
        metadata TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_source_file ON memories(source_file);
      CREATE INDEX IF NOT EXISTS idx_memories_extracted_at ON memories(extracted_at);
    `);
  }
  
  /**
   * Insert a memory
   */
  insert(memory: Memory): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, type, content, confidence, source_file, source_line,
        extracted_at, created_at, entities, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      memory.id,
      memory.type,
      memory.content,
      memory.confidence,
      memory.sourceFile,
      memory.sourceLine ?? null,
      memory.extractedAt,
      memory.createdAt,
      memory.entities ? JSON.stringify(memory.entities) : null,
      memory.metadata ? JSON.stringify(memory.metadata) : null,
    );
  }
  
  /**
   * Insert multiple memories in a transaction
   */
  insertBatch(memories: Memory[]): void {
    const insertMany = this.db.transaction((items: Memory[]) => {
      for (const memory of items) {
        this.insert(memory);
      }
    });
    
    insertMany(memories);
  }
  
  /**
   * Get memory by ID
   */
  getById(id: string): Memory | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `);
    
    const row = stmt.get(id) as any;
    return row ? this.rowToMemory(row) : undefined;
  }
  
  /**
   * Get all memories
   */
  getAll(): Memory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories ORDER BY created_at DESC, extracted_at DESC
    `);
    
    return stmt.all().map((row) => this.rowToMemory(row as any));
  }
  
  /**
   * Get memories by type
   */
  getByType(type: MemoryType): Memory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC
    `);
    
    return stmt.all(type).map((row) => this.rowToMemory(row as any));
  }
  
  /**
   * Get memories by source file
   */
  getBySourceFile(sourceFile: string): Memory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE source_file = ? ORDER BY source_line ASC
    `);
    
    return stmt.all(sourceFile).map((row) => this.rowToMemory(row as any));
  }
  
  /**
   * Get memories by date range
   */
  getByDateRange(from?: string, to?: string): Memory[] {
    let query = "SELECT * FROM memories WHERE 1=1";
    const params: string[] = [];
    
    if (from) {
      query += " AND created_at >= ?";
      params.push(from);
    }
    
    if (to) {
      query += " AND created_at <= ?";
      params.push(to);
    }
    
    query += " ORDER BY created_at DESC";
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params).map((row) => this.rowToMemory(row as any));
  }
  
  /**
   * Get memories by confidence range
   */
  getByConfidenceRange(min: number, max: number = 1.0): Memory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories 
      WHERE confidence >= ? AND confidence <= ?
      ORDER BY confidence DESC, created_at DESC
    `);
    
    return stmt.all(min, max).map((row) => this.rowToMemory(row as any));
  }
  
  /**
   * Delete memories from a source file
   */
  deleteBySourceFile(sourceFile: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM memories WHERE source_file = ?
    `);
    
    const result = stmt.run(sourceFile);
    return result.changes;
  }
  
  /**
   * Get total memory count
   */
  getTotalCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM memories
    `);
    
    const result = stmt.get() as { count: number };
    return result.count;
  }
  
  /**
   * Get memory count by type
   */
  getCountByType(): Record<MemoryType, number> {
    const stmt = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM memories GROUP BY type
    `);
    
    const rows = stmt.all() as Array<{ type: MemoryType; count: number }>;
    const counts: Record<string, number> = {
      FACT: 0,
      DECISION: 0,
      PREFERENCE: 0,
      OBSERVATION: 0,
      TASK: 0,
      CONTEXT: 0,
    };
    
    for (const row of rows) {
      counts[row.type] = row.count;
    }
    
    return counts as Record<MemoryType, number>;
  }
  
  /**
   * Get memory count by confidence range
   */
  getCountByConfidenceRange(): {
    high: number;
    good: number;
    medium: number;
    low: number;
  } {
    const stmt = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN confidence >= 0.9 THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN confidence >= 0.7 AND confidence < 0.9 THEN 1 ELSE 0 END) as good,
        SUM(CASE WHEN confidence >= 0.5 AND confidence < 0.7 THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN confidence < 0.5 THEN 1 ELSE 0 END) as low
      FROM memories
    `);
    
    return stmt.get() as {
      high: number;
      good: number;
      medium: number;
      low: number;
    };
  }
  
  /**
   * Get database file size in bytes
   */
  getSize(): number {
    try {
      const stats = fs.statSync(this.dbPath);
      return stats.size;
    } catch {
      return 0;
    }
  }
  
  /**
   * Check if memory with ID exists
   */
  exists(id: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM memories WHERE id = ? LIMIT 1
    `);
    
    return stmt.get(id) !== undefined;
  }
  
  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
  
  /**
   * Convert database row to Memory object
   */
  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      confidence: row.confidence,
      sourceFile: row.source_file,
      sourceLine: row.source_line,
      extractedAt: row.extracted_at,
      createdAt: row.created_at,
      entities: row.entities ? JSON.parse(row.entities) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
  
  /**
   * Get status information
   */
  getStatus(): MementoStatus {
    return {
      agentId: "", // Set by caller
      totalMemories: this.getTotalCount(),
      memoriesByType: this.getCountByType(),
      memoriesByConfidence: this.getCountByConfidenceRange(),
      pendingFiles: [], // Set by caller
      storageLocation: this.dbPath,
      storageSize: this.getSize(),
    };
  }
}

/**
 * Create a memory store
 */
export function createMemoryStore(dbPath: string): MemoryStore {
  return new MemoryStore(dbPath);
}
