---
name: memento
description: Structured memory storage with JSONL append-only store and SQLite indexing. Store facts, decisions, preferences, context, lessons, todos, observations, and relationships.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "requires": { "bins": ["node"] },
      },
  }
---

# Memento - Structured Memory Storage

Memento provides persistent, queryable memory storage for OpenClaw agents. It uses a dual-layer architecture: JSONL for durability and SQLite for fast queries.

## Architecture

- **Store**: Append-only JSONL file (`memory/store.jsonl`) - source of truth
- **Index**: SQLite database (`memory/index.db`) - fast queries and retrieval
- **Rebuild**: Index can be reconstructed from JSONL at any time

## Memory Types

- `fact` - Verified information
- `decision` - Choices made and rationale
- `preference` - User preferences and settings
- `context` - Situational context
- `lesson` - Learned patterns and insights
- `todo` - Task items
- `observation` - Noted patterns
- `relationship` - Connections between entities

## Storage Location

Default: `~/.openclaw/memory/`
- `store.jsonl` - append-only memory log
- `index.db` - SQLite index

## CLI Commands

### Status
```bash
openclaw memento status
```
Shows store health, count, and last activity.

### Get Memory
```bash
openclaw memento get <id>
```
Retrieve a specific memory by ID.

### Create Memory
```bash
openclaw memento create --type fact --content 'User prefers dark mode'
openclaw memento create --type decision --content 'Use TypeScript for new modules' --tags backend,standards
openclaw memento create --type preference --content 'Morning standup at 9am' --permanent
```

### Advanced Options
- `--tags <tag1>,<tag2>` - Add searchable tags
- `--permanent` - Mark as permanent (never expires)
- `--expires <timestamp>` - Set expiration date
- `--source <type>` - Source type (conversation/file/tool/inference/explicit)
- `--confidence <0-1>` - Confidence score
- `--related-to <id>` - Link to related memory

## Memory Schema

Each memory contains:
- `id` - Unique identifier (UUID)
- `type` - Memory type (see above)
- `content` - The memory content (string)
- `createdAt` - ISO timestamp
- `updatedAt` - ISO timestamp
- `accessedAt` - Last access timestamp
- `expiresAt` - Optional expiration
- `source` - Source metadata (type, reference, actor)
- `confidence` - 0-1 confidence score
- `supersedes` - Array of memory IDs this replaces
- `relatedTo` - Array of related memory IDs
- `tags` - Array of tag strings
- `permanent` - Boolean flag
- `archived` - Boolean flag

## Usage Patterns

### Store User Preferences
```bash
openclaw memento create --type preference --content 'Use metric units' --permanent
```

### Record Decisions
```bash
openclaw memento create --type decision --content 'Decided to use Postgres over MySQL for better JSON support' --tags database,architecture
```

### Track Context
```bash
openclaw memento create --type context --content 'Working on GOR-25 Memento implementation' --expires 2026-02-15
```

## Implementation

See `memento.js` for the Node.js implementation with:
- JSONL writer
- SQLite indexer
- CRUD operations
- Index rebuild utility
