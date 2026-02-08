#!/usr/bin/env node
/**
 * Memento - Structured Memory Storage
 * Phase 1: Core schema and storage layer
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {'fact' | 'decision' | 'preference' | 'context' | 'lesson' | 'todo' | 'observation' | 'relationship'} MemoryType
 */

/**
 * @typedef {'conversation' | 'file' | 'tool' | 'inference' | 'explicit'} SourceType
 */

/**
 * @typedef {Object} MemorySource
 * @property {SourceType} type - Source type
 * @property {string} [reference] - Reference to source (e.g., file path, conversation ID)
 * @property {string} [actor] - Actor who created the memory
 */

/**
 * @typedef {Object} Memory
 * @property {string} id - Unique identifier (UUID)
 * @property {MemoryType} type - Memory type
 * @property {string} content - Memory content
 * @property {string} createdAt - ISO 8601 timestamp
 * @property {string} updatedAt - ISO 8601 timestamp
 * @property {string} [accessedAt] - Last access timestamp
 * @property {string} [expiresAt] - Optional expiration timestamp
 * @property {MemorySource} source - Source metadata
 * @property {number} confidence - Confidence score (0-1)
 * @property {string[]} supersedes - Array of memory IDs this replaces
 * @property {string[]} relatedTo - Array of related memory IDs
 * @property {string[]} tags - Array of tags
 * @property {boolean} permanent - Permanent flag
 * @property {boolean} archived - Archived flag
 */

/**
 * Get default memory storage directory
 * @returns {string}
 */
function getMemoryDir() {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const openclawHome = process.env.OPENCLAW_HOME || path.join(home, ".openclaw");
  return path.join(openclawHome, "memory");
}

/**
 * Ensure memory directory exists
 * @param {string} dir
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * JSONL Store - Append-only memory log
 */
class JSONLStore {
  /**
   * @param {string} filepath
   */
  constructor(filepath) {
    this.filepath = filepath;
    ensureDir(path.dirname(filepath));
  }

  /**
   * Append a memory to the JSONL store
   * @param {Memory} memory
   */
  append(memory) {
    const line = JSON.stringify(memory) + "\n";
    fs.appendFileSync(this.filepath, line, "utf8");
  }

  /**
   * Read all memories from the JSONL store
   * @returns {Memory[]}
   */
  readAll() {
    if (!fs.existsSync(this.filepath)) {
      return [];
    }

    const content = fs.readFileSync(this.filepath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());

    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        console.warn(`Failed to parse JSONL line: ${line}`, err);
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Get store stats
   * @returns {{exists: boolean, size: number, count: number, lastModified: Date | null}}
   */
  stats() {
    if (!fs.existsSync(this.filepath)) {
      return { exists: false, size: 0, count: 0, lastModified: null };
    }

    const stat = fs.statSync(this.filepath);
    const memories = this.readAll();

    return {
      exists: true,
      size: stat.size,
      count: memories.length,
      lastModified: stat.mtime,
    };
  }
}

/**
 * SQLite Index - Fast queries
 */
class SQLiteIndex {
  /**
   * @param {string} filepath
   */
  constructor(filepath) {
    this.filepath = filepath;
    ensureDir(path.dirname(filepath));
    this.db = new Database(filepath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  /**
   * Initialize database schema
   */
  initSchema() {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    this.db.exec(schema);
  }

  /**
   * Insert a memory into the index
   * @param {Memory} memory
   */
  insert(memory) {
    const insertMemory = this.db.prepare(`
      INSERT INTO memories (
        id, type, content, created_at, updated_at, accessed_at, expires_at,
        source_type, source_reference, source_actor, confidence, permanent, archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertMemory.run(
      memory.id,
      memory.type,
      memory.content,
      memory.createdAt,
      memory.updatedAt,
      memory.accessedAt || null,
      memory.expiresAt || null,
      memory.source.type,
      memory.source.reference || null,
      memory.source.actor || null,
      memory.confidence,
      memory.permanent ? 1 : 0,
      memory.archived ? 1 : 0
    );

    // Insert tags
    if (memory.tags && memory.tags.length > 0) {
      const insertTag = this.db.prepare(
        "INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)"
      );
      for (const tag of memory.tags) {
        insertTag.run(memory.id, tag);
      }
    }

    // Insert relations
    if (memory.supersedes && memory.supersedes.length > 0) {
      const insertRelation = this.db.prepare(
        "INSERT INTO memory_relations (from_id, to_id, relation_type) VALUES (?, ?, 'supersedes')"
      );
      for (const targetId of memory.supersedes) {
        insertRelation.run(memory.id, targetId);
      }
    }

    if (memory.relatedTo && memory.relatedTo.length > 0) {
      const insertRelation = this.db.prepare(
        "INSERT INTO memory_relations (from_id, to_id, relation_type) VALUES (?, ?, 'related')"
      );
      for (const targetId of memory.relatedTo) {
        insertRelation.run(memory.id, targetId);
      }
    }
  }

  /**
   * Get a memory by ID
   * @param {string} id
   * @returns {Memory | null}
   */
  get(id) {
    const row = this.db.prepare("SELECT * FROM memories_view WHERE id = ?").get(id);
    if (!row) return null;

    return this.rowToMemory(row);
  }

  /**
   * Update accessed timestamp
   * @param {string} id
   */
  updateAccessed(id) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE memories SET accessed_at = ? WHERE id = ?").run(now, id);
  }

  /**
   * Soft update (creates new version in JSONL, marks old as archived in index)
   * @param {string} id
   * @param {Partial<Memory>} updates
   * @returns {Memory | null}
   */
  update(id, updates) {
    const existing = this.get(id);
    if (!existing) return null;

    // Archive the old version
    this.db.prepare("UPDATE memories SET archived = 1 WHERE id = ?").run(id);

    // Return updated memory (caller should append to JSONL and insert new)
    const now = new Date().toISOString();
    return {
      ...existing,
      ...updates,
      id: randomUUID(),
      updatedAt: now,
      supersedes: [...(existing.supersedes || []), id],
    };
  }

  /**
   * Archive a memory
   * @param {string} id
   */
  archive(id) {
    this.db.prepare("UPDATE memories SET archived = 1 WHERE id = ?").run(id);
  }

  /**
   * Get all memories (non-archived)
   * @param {{type?: MemoryType, limit?: number, offset?: number}} options
   * @returns {Memory[]}
   */
  getAll(options = {}) {
    let query = "SELECT * FROM memories_view WHERE archived = 0";
    const params = [];

    if (options.type) {
      query += " AND type = ?";
      params.push(options.type);
    }

    query += " ORDER BY created_at DESC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    if (options.offset) {
      query += " OFFSET ?";
      params.push(options.offset);
    }

    const rows = this.db.prepare(query).all(...params);
    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Count memories
   * @param {{type?: MemoryType}} options
   * @returns {number}
   */
  count(options = {}) {
    let query = "SELECT COUNT(*) as count FROM memories WHERE archived = 0";
    const params = [];

    if (options.type) {
      query += " AND type = ?";
      params.push(options.type);
    }

    const result = this.db.prepare(query).get(...params);
    return result.count;
  }

  /**
   * Clear all data (for rebuild)
   */
  clear() {
    this.db.exec("DELETE FROM memory_relations");
    this.db.exec("DELETE FROM memory_tags");
    this.db.exec("DELETE FROM memories");
  }

  /**
   * Convert database row to Memory object
   * @param {any} row
   * @returns {Memory}
   */
  rowToMemory(row) {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessedAt: row.accessed_at || undefined,
      expiresAt: row.expires_at || undefined,
      source: {
        type: row.source_type,
        reference: row.source_reference || undefined,
        actor: row.source_actor || undefined,
      },
      confidence: row.confidence,
      supersedes: row.supersedes ? row.supersedes.split(",") : [],
      relatedTo: row.related_to ? row.related_to.split(",") : [],
      tags: row.tags ? row.tags.split(",") : [],
      permanent: row.permanent === 1,
      archived: row.archived === 1,
    };
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

/**
 * Memento Storage - Main interface
 */
class MementoStorage {
  /**
   * @param {string} [baseDir]
   */
  constructor(baseDir) {
    this.baseDir = baseDir || getMemoryDir();
    this.storePath = path.join(this.baseDir, "store.jsonl");
    this.indexPath = path.join(this.baseDir, "index.db");

    this.store = new JSONLStore(this.storePath);
    this.index = new SQLiteIndex(this.indexPath);
  }

  /**
   * Create a new memory
   * @param {Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>} data
   * @returns {Memory}
   */
  create(data) {
    const now = new Date().toISOString();
    const memory = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      confidence: 1.0,
      supersedes: [],
      relatedTo: [],
      tags: [],
      permanent: false,
      archived: false,
      ...data,
    };

    // Append to JSONL (source of truth)
    this.store.append(memory);

    // Index for queries
    this.index.insert(memory);

    return memory;
  }

  /**
   * Get a memory by ID
   * @param {string} id
   * @returns {Memory | null}
   */
  get(id) {
    const memory = this.index.get(id);
    if (memory) {
      this.index.updateAccessed(id);
    }
    return memory;
  }

  /**
   * Update a memory (soft update - creates new version)
   * @param {string} id
   * @param {Partial<Memory>} updates
   * @returns {Memory | null}
   */
  update(id, updates) {
    const newMemory = this.index.update(id, updates);
    if (newMemory) {
      this.store.append(newMemory);
      this.index.insert(newMemory);
    }
    return newMemory;
  }

  /**
   * Archive a memory
   * @param {string} id
   */
  archive(id) {
    this.index.archive(id);
  }

  /**
   * Get all memories
   * @param {{type?: MemoryType, limit?: number, offset?: number}} options
   * @returns {Memory[]}
   */
  getAll(options = {}) {
    return this.index.getAll(options);
  }

  /**
   * Count memories
   * @param {{type?: MemoryType}} options
   * @returns {number}
   */
  count(options = {}) {
    return this.index.count(options);
  }

  /**
   * Rebuild index from JSONL store
   */
  rebuild() {
    console.log("Rebuilding index from JSONL store...");

    // Clear index
    this.index.clear();

    // Read all memories from JSONL
    const memories = this.store.readAll();
    console.log(`Found ${memories.length} memories in store`);

    // Re-index
    for (const memory of memories) {
      this.index.insert(memory);
    }

    console.log("Index rebuild complete");
  }

  /**
   * Get storage status
   * @returns {{store: any, index: any, healthy: boolean}}
   */
  status() {
    const storeStats = this.store.stats();
    const indexCount = this.index.count();

    return {
      store: {
        path: this.storePath,
        ...storeStats,
      },
      index: {
        path: this.indexPath,
        count: indexCount,
      },
      healthy: storeStats.exists && indexCount > 0,
    };
  }

  /**
   * Close connections
   */
  close() {
    this.index.close();
  }
}

/**
 * CLI Commands
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const storage = new MementoStorage();

  try {
    switch (command) {
      case "status": {
        const status = storage.status();
        console.log(JSON.stringify(status, null, 2));
        break;
      }

      case "get": {
        const id = args[1];
        if (!id) {
          console.error("Usage: memento get <id>");
          process.exit(1);
        }
        const memory = storage.get(id);
        if (memory) {
          console.log(JSON.stringify(memory, null, 2));
        } else {
          console.error(`Memory not found: ${id}`);
          process.exit(1);
        }
        break;
      }

      case "create": {
        // Parse flags
        const flags = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i].startsWith("--")) {
            const key = args[i].slice(2);
            const value = args[i + 1];
            flags[key] = value;
            i++;
          }
        }

        if (!flags.type || !flags.content) {
          console.error("Usage: memento create --type <type> --content '<content>' [options]");
          console.error("Options:");
          console.error("  --tags <tag1>,<tag2>");
          console.error("  --permanent");
          console.error("  --expires <ISO timestamp>");
          console.error("  --source <type>");
          console.error("  --confidence <0-1>");
          console.error("  --related-to <id>");
          process.exit(1);
        }

        const memoryData = {
          type: flags.type,
          content: flags.content,
          source: {
            type: flags.source || "explicit",
          },
          tags: flags.tags ? flags.tags.split(",") : [],
          permanent: flags.permanent !== undefined,
          confidence: flags.confidence ? parseFloat(flags.confidence) : 1.0,
          expiresAt: flags.expires,
          relatedTo: flags["related-to"] ? [flags["related-to"]] : [],
        };

        const memory = storage.create(memoryData);
        console.log(JSON.stringify(memory, null, 2));
        break;
      }

      case "rebuild": {
        storage.rebuild();
        break;
      }

      case "list": {
        const type = args.find((arg) => arg.startsWith("--type"))?.split("=")[1];
        const limit = args.find((arg) => arg.startsWith("--limit"))?.split("=")[1];

        const memories = storage.getAll({
          type,
          limit: limit ? parseInt(limit, 10) : undefined,
        });

        console.log(JSON.stringify(memories, null, 2));
        break;
      }

      default:
        console.log("Memento - Structured Memory Storage");
        console.log("");
        console.log("Commands:");
        console.log("  status              Show store health and statistics");
        console.log("  get <id>            Retrieve a memory by ID");
        console.log("  create              Create a new memory");
        console.log("  list                List memories");
        console.log("  rebuild             Rebuild index from JSONL store");
        console.log("");
        console.log("For detailed usage, see skills/memento/SKILL.md");
        break;
    }
  } finally {
    storage.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}

// Export for use as module
export { MementoStorage, JSONLStore, SQLiteIndex };
