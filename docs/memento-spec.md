# Memento: OpenClaw's Memory System

Memento is OpenClaw's persistent memory layer that enables agents to remember facts, decisions, preferences, and contextual information across sessions.

## Overview

Memento provides:
- **Structured memory storage** with semantic types
- **Full-text search** using SQLite FTS5
- **Advanced filtering** by type, tags, dates, and confidence
- **Recency-weighted ranking** for relevant results
- **Confidence scoring** for memory reliability

## Memory Types

```typescript
enum MemoryType {
  FACT = "fact",           // Factual information ("User lives in Seattle")
  DECISION = "decision",   // Past decisions ("Chose React over Vue")
  PREFERENCE = "preference", // User preferences ("Prefers concise code")
  CONTEXT = "context",     // Situational context ("Working on Project Vesper")
  INSIGHT = "insight",     // Derived insights ("User is a visual learner")
  TASK = "task"           // Task-related memory ("User wants dark mode")
}
```

## Core Data Model

### Memory

```typescript
interface Memory {
  id: string;                    // UUID
  type: MemoryType;              // Memory classification
  content: string;               // Main memory content
  tags: string[];                // Categorization tags
  confidence: number;            // 0.0 - 1.0 reliability score
  source?: string;               // Origin (e.g., "conversation", "user-input")
  context?: Record<string, any>; // Additional metadata
  createdAt: Date;               // Creation timestamp
  updatedAt: Date;               // Last modification
  archivedAt?: Date;             // Soft delete timestamp
}
```

### MemoryQuery

```typescript
interface MemoryQuery {
  query?: string;              // Semantic search text
  types?: MemoryType[];        // Filter by memory types
  tags?: string[];             // Filter by tags (OR logic)
  since?: Date;                // Created after this date
  until?: Date;                // Created before this date
  minConfidence?: number;      // Minimum confidence threshold (0-1)
  includeArchived?: boolean;   // Include soft-deleted memories
  limit?: number;              // Max results (default: 20)
  recencyWeight?: number;      // 0-1, recency impact on ranking (default: 0.3)
}
```

### QueryResult

```typescript
interface QueryResult {
  memory: Memory;
  score: number;              // Combined relevance score
  semanticScore: number;      // FTS5 match score
  recencyScore: number;       // Time-based score
  rank: number;               // Result position
}
```

## Database Schema

### memories table

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL,        -- JSON array
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT,
  context TEXT,              -- JSON object
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_created_at ON memories(created_at);
CREATE INDEX idx_memories_archived_at ON memories(archived_at);
CREATE INDEX idx_memories_confidence ON memories(confidence);
```

### memories_fts table (FTS5)

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  id UNINDEXED,
  content,
  tags,
  content='memories',
  content_rowid='rowid'
);

-- Triggers to keep FTS5 in sync
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, id, content, tags)
  VALUES (new.rowid, new.id, new.content, new.tags);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  UPDATE memories_fts SET content = new.content, tags = new.tags
  WHERE rowid = new.rowid;
END;
```

## Query Algorithm

### 1. Build SQL Query

- Start with FTS5 search if `query` provided
- Add WHERE clauses for filters (type, tags, dates, confidence)
- Exclude archived memories unless `includeArchived=true`

### 2. Calculate Semantic Score

```typescript
// FTS5 provides BM25 score
semanticScore = fts5_rank / maxRank
```

### 3. Calculate Recency Score

```typescript
// Exponential decay based on age
const ageInDays = (now - createdAt) / (1000 * 60 * 60 * 24);
const decayRate = 0.1; // Configurable
recencyScore = Math.exp(-decayRate * ageInDays);
```

### 4. Combine Scores

```typescript
const w = query.recencyWeight ?? 0.3;
finalScore = (1 - w) * semanticScore + w * recencyScore;
```

### 5. Sort & Limit

- Sort by `finalScore DESC`
- Apply `limit`
- Return with rank positions

## CLI Commands

### memento search

Search memories with filters:

```bash
# Basic search
openclaw memento search "project vesper"

# Filter by type
openclaw memento search "dark mode" --type decision --type preference

# Date range
openclaw memento search "API" --since 7d --until now

# Tags filter
openclaw memento search "architecture" --tags backend,api

# Confidence threshold
openclaw memento search "performance" --min-confidence 0.8

# Limit results
openclaw memento search "user preferences" --limit 5

# Adjust recency weight (0=pure semantic, 1=pure recency)
openclaw memento search "recent decisions" --recency-weight 0.8

# Include archived
openclaw memento search "old project" --include-archived
```

### memento list

List memories by type:

```bash
# List all
openclaw memento list

# By type
openclaw memento list --type decision
openclaw memento list --type preference --type fact

# With filters
openclaw memento list --tags project --since 30d
```

### memento add

Create a new memory:

```bash
openclaw memento add --type fact --content "User prefers TypeScript" --tags coding,preference
```

### memento archive

Archive (soft delete) a memory:

```bash
openclaw memento archive <memory-id>
```

### memento delete

Permanently delete a memory:

```bash
openclaw memento delete <memory-id>
```

## Storage Location

Memories are stored in:
```
~/.openclaw/agents/<agentId>/memento.db
```

## Usage Examples

### Agent Integration

```typescript
// Agent queries memory during conversation
const results = await memento.query({
  query: "user's coding preferences",
  types: [MemoryType.PREFERENCE, MemoryType.FACT],
  minConfidence: 0.7,
  limit: 5
});

// Build context from top results
const context = results
  .slice(0, 3)
  .map(r => r.memory.content)
  .join("\n");
```

### Automatic Memory Formation

```typescript
// After user provides feedback
await memento.add({
  type: MemoryType.PREFERENCE,
  content: "User prefers detailed error messages",
  tags: ["coding-style", "communication"],
  confidence: 0.9,
  source: "conversation"
});
```

### Tag-Based Retrieval

```typescript
// Find all project-related context
const projectMemories = await memento.query({
  tags: ["project-vesper"],
  types: [MemoryType.CONTEXT, MemoryType.DECISION],
  since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
});
```

## Performance Considerations

- **FTS5 indexing** provides sub-100ms search on 100k+ memories
- **Compound indexes** optimize common filter combinations
- **Connection pooling** for concurrent access
- **Batch operations** for bulk imports/updates
- **Prepared statements** for query efficiency

## Future Enhancements

- **Semantic embeddings** for better similarity search
- **Memory consolidation** to merge duplicate/conflicting memories
- **Automatic tagging** using NLP
- **Confidence decay** over time
- **Memory graphs** for relationship tracking
- **Cross-agent memory sharing** with privacy controls

## References

- [SQLite FTS5 Documentation](https://www.sqlite.org/fts5.html)
- [BM25 Ranking Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)
