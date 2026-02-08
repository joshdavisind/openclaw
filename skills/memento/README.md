# Memento - Structured Memory Storage

Phase 1 implementation providing core schema and storage layer for OpenClaw agent memory.

## Features

### Memory Types
- `fact` - Verified information
- `decision` - Choices made and rationale
- `preference` - User preferences and settings
- `context` - Situational context
- `lesson` - Learned patterns and insights
- `todo` - Task items
- `observation` - Noted patterns
- `relationship` - Connections between entities

### Storage Architecture
- **JSONL Store**: Append-only log as source of truth (`~/.openclaw/memory/store.jsonl`)
- **SQLite Index**: Fast queries with FTS5 full-text search (`~/.openclaw/memory/index.db`)
- **Rebuild Support**: Index can be reconstructed from JSONL at any time

### Memory Schema
Each memory includes:
- UUID identifier
- Type, content, timestamps (created, updated, accessed)
- Source metadata (type, reference, actor)
- Confidence score (0-1)
- Relationships (supersedes, related to)
- Tags for categorization
- Optional expiration
- Permanent and archived flags

## Installation

```bash
cd skills/memento
npm install
```

## Usage

### CLI Commands

#### Check status
```bash
node memento.js status
```

#### Create memories
```bash
# Basic fact
node memento.js create --type fact --content 'User prefers dark mode'

# With tags
node memento.js create --type decision --content 'Use TypeScript' --tags backend,standards

# Permanent preference
node memento.js create --type preference --content 'Morning standup at 9am' --permanent

# With expiration
node memento.js create --type context --content 'Working on GOR-25' --expires 2026-02-15T00:00:00Z
```

#### Retrieve memory
```bash
node memento.js get <uuid>
```

#### List memories
```bash
# All memories
node memento.js list

# Filter by type
node memento.js list --type=fact

# Limit results
node memento.js list --limit=10
```

#### Rebuild index
```bash
node memento.js rebuild
```

## Integration with OpenClaw

The skill can be invoked via:
```bash
openclaw memento status
openclaw memento get <id>
openclaw memento create --type fact --content 'Example'
```

## Implementation Details

### Files
- `SKILL.md` - Skill definition and documentation
- `memento.js` - Main implementation with JSDoc types
- `schema.sql` - SQLite schema with FTS5 and triggers
- `package.json` - Dependencies (better-sqlite3)

### TypeScript Types (via JSDoc)
- `Memory` - Full memory object interface
- `MemoryType` - Enum of 8 memory types
- `MemorySource` - Source metadata structure

### Operations
- **Create**: Append to JSONL, insert into index
- **Read**: Query from index, update access timestamp
- **Update**: Soft update (new version supersedes old)
- **Archive**: Mark as archived (soft delete)

### Data Integrity
- JSONL is append-only (immutable audit log)
- SQLite index maintained via triggers
- Updates create new versions with supersedes links
- Index can be rebuilt from JSONL at any time

## Testing

The implementation has been tested with:
- ✅ Status reporting (empty and populated stores)
- ✅ Memory creation with various options
- ✅ Memory retrieval by ID
- ✅ Listing and filtering
- ✅ Index rebuilding from JSONL
- ✅ Timestamp tracking (created, updated, accessed)

## Future Phases

Phase 2+ will add:
- Query and search operations
- Memory consolidation and cleanup
- Agent integration hooks
- Multi-agent memory sharing
- Memory templates and patterns

## License

MIT
