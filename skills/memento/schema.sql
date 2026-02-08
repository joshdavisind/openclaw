-- Memento SQLite Schema
-- Index database for fast memory queries
-- Source of truth remains in store.jsonl

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accessed_at TEXT,
  expires_at TEXT,
  source_type TEXT,
  source_reference TEXT,
  source_actor TEXT,
  confidence REAL DEFAULT 1.0,
  permanent INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  CHECK (type IN ('fact', 'decision', 'preference', 'context', 'lesson', 'todo', 'observation', 'relationship')),
  CHECK (confidence >= 0.0 AND confidence <= 1.0)
);

-- Tags for searchability
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- Relationships between memories
CREATE TABLE IF NOT EXISTS memory_relations (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, relation_type),
  FOREIGN KEY (from_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (to_id) REFERENCES memories(id) ON DELETE CASCADE,
  CHECK (relation_type IN ('supersedes', 'related'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);
CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);
CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);

-- Full-text search for content
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  content,
  tags
);

-- Trigger to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(id, content, tags)
  SELECT 
    NEW.id, 
    NEW.content,
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM memory_tags WHERE memory_id = NEW.id), '');
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
  UPDATE memories_fts 
  SET content = NEW.content,
      tags = COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM memory_tags WHERE memory_id = NEW.id), '')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE id = OLD.id;
END;

-- View for easy querying with all relationships
CREATE VIEW IF NOT EXISTS memories_view AS
SELECT 
  m.*,
  (SELECT GROUP_CONCAT(tag, ',') FROM memory_tags WHERE memory_id = m.id) as tags,
  (SELECT GROUP_CONCAT(to_id, ',') FROM memory_relations WHERE from_id = m.id AND relation_type = 'supersedes') as supersedes,
  (SELECT GROUP_CONCAT(to_id, ',') FROM memory_relations WHERE from_id = m.id AND relation_type = 'related') as related_to
FROM memories m;
