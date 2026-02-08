---
summary: "Memento: Structured memory consolidation system for daily notes"
title: "Memento Specification"
---

# Memento: Memory Consolidation System

Memento is OpenClaw's structured memory consolidation system that transforms freeform daily notes into queryable, typed memories.

## Overview

Daily notes in `memory/YYYY-MM-DD.md` are append-only journals where context, decisions, and observations accumulate in natural language. Memento extracts structured, typed memories from these notes using LLM-based classification, making them searchable and queryable.

## Memory Types

Memento classifies extracted content into distinct memory types:

### FACT
Objective, verifiable information about the world or system state.
- Example: "The gateway runs on port 18789 by default"
- Example: "Peter is based in Berlin"

### DECISION
Explicit choices made, including rationale and context.
- Example: "Decided to use SQLite for memory storage due to zero-dependency requirement"
- Example: "Chose to implement batch embeddings for performance"

### PREFERENCE
User or system preferences, patterns, and style guidelines.
- Example: "Peter prefers concise responses under 1500 characters"
- Example: "Use TypeScript strict mode for all new code"

### OBSERVATION
Noted patterns, behaviors, or insights discovered during operation.
- Example: "Session compaction triggers approximately every 50k tokens"
- Example: "Users often ask for status after configuration changes"

### TASK
Action items, TODOs, or pending work.
- Example: "TODO: Add retry logic to batch embedding failures"
- Example: "Need to update documentation for memento CLI"

### CONTEXT
Background information, explanations, or situational awareness.
- Example: "Running in development mode on macOS 14.2"
- Example: "Current session started after gateway restart"

## Confidence Scores

Each extracted memory has a confidence score (0.0 to 1.0) indicating extraction quality:

- **0.9-1.0**: High confidence (explicit, clear statements)
- **0.7-0.89**: Good confidence (implied but clear from context)
- **0.5-0.69**: Medium confidence (inferred, may need verification)
- **0.0-0.49**: Low confidence (uncertain, conflicting information)

Confidence factors:
- Explicitness of statement
- Supporting context
- Internal consistency
- Temporal clarity

## Daily Note Format

Daily notes are Markdown files at `memory/YYYY-MM-DD.md`:

```markdown
# 2026-02-08

## Morning
- Reviewed memento requirements for GOR-28
- Need to extract structured memories from daily notes
- User preferences should be tracked with confidence scores

## Afternoon
Implemented the consolidation engine. Key decisions:
- Use LLM for classification (more flexible than regex)
- Store state in SQLite for idempotency
- Track last consolidation timestamp per file
```

## Consolidation Process

### 1. Parse
- Scan `memory/` directory for daily note files
- Read Markdown content
- Track file modification times

### 2. Extract
- Send note content to LLM with classification prompt
- LLM identifies discrete memory items
- Each item tagged with type, confidence, entities, timestamp

### 3. Classify
- FACT: Look for objective statements
- DECISION: Look for "decided", "chose", rationale language
- PREFERENCE: Look for "prefers", "likes", "wants", patterns
- OBSERVATION: Look for "noticed", "seems", insights
- TASK: Look for "TODO", "need to", action items
- CONTEXT: Background info, setup, environment

### 4. Store
- Save extracted memories to consolidated store
- Link to source file + line numbers
- Track consolidation state (last processed timestamp)
- Ensure idempotency (re-running doesn't duplicate)

## Consolidation State

State tracking ensures idempotent consolidation:

```typescript
interface ConsolidationState {
  lastConsolidation: string; // ISO timestamp
  processedFiles: {
    path: string;
    lastModified: string; // ISO timestamp
    lastProcessed: string; // ISO timestamp
    memoryCount: number;
  }[];
}
```

Stored in `~/.openclaw/agents/<agentId>/memento/state.json`

## Storage Schema

Consolidated memories stored in SQLite at `~/.openclaw/agents/<agentId>/memento/memories.sqlite`:

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- FACT, DECISION, PREFERENCE, etc.
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  source_file TEXT NOT NULL,
  source_line INTEGER,
  extracted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,  -- from daily note date
  entities TEXT,  -- JSON array of entity mentions
  metadata TEXT  -- JSON for extensibility
);

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_confidence ON memories(confidence);
CREATE INDEX idx_memories_created_at ON memories(created_at);
CREATE INDEX idx_memories_source_file ON memories(source_file);
```

## CLI Commands

### `openclaw memento consolidate`

Extract and consolidate memories from daily notes.

```bash
# Consolidate a specific date
openclaw memento consolidate --date 2026-02-07

# Consolidate all unprocessed files
openclaw memento consolidate --pending

# Force re-consolidation (ignore state)
openclaw memento consolidate --force

# Consolidate date range
openclaw memento consolidate --from 2026-02-01 --to 2026-02-07
```

Options:
- `--date YYYY-MM-DD`: Consolidate specific date
- `--pending`: Process all files modified since last consolidation
- `--force`: Re-process all files regardless of state
- `--from YYYY-MM-DD`: Start date for range
- `--to YYYY-MM-DD`: End date for range
- `--agent <id>`: Scope to specific agent (default: default agent)
- `--verbose`: Show detailed extraction progress

### `openclaw memento status`

Show consolidation state and memory statistics.

```bash
# Show status
openclaw memento status

# Show status with details
openclaw memento status --verbose

# JSON output
openclaw memento status --json
```

Output includes:
- Total memories by type
- Last consolidation timestamp
- Pending files (modified but not processed)
- Memory count by confidence range
- Storage location and size

### `openclaw memento search` (future)

Query consolidated memories:

```bash
openclaw memento search "user preferences" --type PREFERENCE
openclaw memento search "gateway" --min-confidence 0.8
```

## Idempotency

Consolidation must be idempotent:
- Track file modification times in state
- Skip files unchanged since last consolidation
- `--force` flag bypasses state checks
- Duplicate detection by content hash

## Integration with Memory Search

Memento complements existing memory search:
- **Memory search**: Semantic search over raw Markdown
- **Memento**: Structured, typed query over extracted memories

Future integration points:
- Expose memento memories to `memory_search` tool
- Surface high-confidence memories in context
- Link consolidated memories back to source notes

## Testing Requirements

### Unit Tests
- Parser: Extract content from various Markdown formats
- Extractor: LLM classification with sample notes
- State tracker: Idempotency, file tracking
- Store: CRUD operations, schema migrations

### Integration Tests
- End-to-end consolidation flow
- Idempotency: Run twice, verify no duplicates
- State persistence across sessions
- Handle malformed or empty files

### Edge Cases
- Empty daily notes
- Notes with no extractable memories
- Malformed Markdown
- Concurrent consolidation attempts
- Large notes (>100KB)

## Performance Considerations

- Batch LLM requests where possible
- Cache extraction results per file hash
- Index lookups for duplicate detection
- Limit concurrent file processing
- Progress reporting for large backlogs

## Future Enhancements

### Phase 5: Memory Evolution
- Track confidence changes over time
- Merge redundant memories
- Flag contradictions

### Phase 6: Entity Linking
- Extract and link entity mentions
- Entity-centric memory views
- Relationship tracking

### Phase 7: Active Recall
- Suggest consolidation timing
- Prompt for clarification on low-confidence items
- Auto-summarize weekly/monthly

## References

- [Memory concept](/concepts/memory)
- [Memory CLI](/cli/memory)
- Research: [Workspace Memory v2](/experiments/research/memory)
