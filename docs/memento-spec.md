# Memento Specification

## Overview

Memento is a structured memory system for OpenClaw agents that provides versioned, conflict-aware storage for semantic information. Unlike the existing memory search system which indexes markdown files, Memento manages discrete memory entries with relationships, provenance tracking, and supersession semantics.

## Core Concepts

### Memory Entry

Each memory entry represents a discrete piece of information with:

- **ID**: Unique identifier (UUID)
- **Type**: Category of memory (e.g., "fact", "preference", "decision", "todo")
- **Content**: The actual information stored
- **Source**: Provenance information (agent ID, session key, timestamp)
- **Metadata**: Extensible key-value pairs
- **Relationships**: Links to other memories

### Supersession

Supersession allows memories to evolve over time while maintaining history:

- When a new memory supersedes old ones, the old memories are marked as superseded
- Queries exclude superseded memories by default (can be overridden)
- Supersession chains are tracked (A->B->C means C is the current version)
- Multiple memories can be superseded by a single new memory (consolidation)

### Conflict Detection

When adding a memory, the system checks for potential conflicts:

- Same memory type with overlapping content
- Uses FTS5 for similarity detection
- Surfaces conflicts rather than silently overwriting
- Allows explicit resolution via supersession

## Data Model

### Memory Schema

```typescript
interface Memory {
  id: string;                      // UUID
  type: string;                    // e.g., "fact", "preference", "decision"
  content: string;                 // The actual information
  embedding?: Float32Array;        // Vector representation for semantic search
  
  // Source tracking
  agentId: string;
  sessionKey?: string;
  timestamp: number;               // Unix timestamp (ms)
  
  // Supersession
  supersedes: string[];            // IDs of memories this replaces
  supersededBy?: string;           // ID of memory that replaced this one
  
  // Relationships
  relatedTo?: Array<{
    type: string;                  // e.g., "supports", "conflicts", "references"
    targetId: string;
  }>;
  
  // Metadata
  metadata?: Record<string, unknown>;
}
```

### Storage

Memories are stored in SQLite with:

- Main `memories` table with JSON fields for flexible schema
- FTS5 virtual table for full-text search
- Indexes on type, timestamp, supersession status
- Optional vector storage (using sqlite-vec extension)

## API

### Write Operations

```typescript
interface MementoWriter {
  // Add a new memory
  add(memory: Omit<Memory, 'id' | 'timestamp'>): Promise<Memory>;
  
  // Add a memory that supersedes existing ones
  addSuperseding(
    memory: Omit<Memory, 'id' | 'timestamp' | 'supersedes'>,
    supersedes: string[]
  ): Promise<Memory>;
  
  // Convenience method to supersede a single memory
  supersede(oldId: string, newMemory: Omit<Memory, 'id' | 'timestamp'>): Promise<Memory>;
  
  // Mark memories as related
  relate(fromId: string, toId: string, type: string): Promise<void>;
}
```

### Query Operations

```typescript
interface MementoReader {
  // Get memory by ID
  get(id: string): Promise<Memory | null>;
  
  // Search memories
  search(params: {
    query?: string;              // Text or semantic search
    type?: string | string[];    // Filter by type
    minScore?: number;           // Similarity threshold
    maxResults?: number;
    includeSuperseded?: boolean; // Include superseded memories (default: false)
  }): Promise<Memory[]>;
  
  // Check for conflicts with proposed memory
  checkConflicts(memory: {
    type: string;
    content: string;
  }): Promise<Array<{
    memory: Memory;
    similarity: number;
  }>>;
  
  // Get supersession chain
  getSupersessionChain(id: string): Promise<Memory[]>;
}
```

## Implementation Notes

### Supersession Logic

1. When adding a memory with `supersedes`:
   - Validate all superseded IDs exist
   - Set `supersededBy` field on old memories
   - Store `supersedes` list in new memory
   - Maintain transaction consistency

2. Query filtering:
   - By default, exclude memories where `supersededBy IS NOT NULL`
   - Allow opt-in to include superseded memories
   - Sort results by timestamp descending

### Conflict Detection

1. When adding a memory without explicit supersession:
   - Search for memories of same type
   - Use FTS5 to find similar content
   - Return conflicts if similarity exceeds threshold (e.g., 0.8)
   - Caller decides whether to proceed, supersede, or abort

2. Similarity calculation:
   - Use FTS5 BM25 scoring for text similarity
   - Optionally use vector similarity if embeddings available
   - Normalize scores to 0-1 range

### Source Provenance

All write operations must include:
- Agent ID (who created this memory)
- Optional session key (context of creation)
- Automatic timestamp

This enables:
- Audit trail
- Agent-specific memory filtering
- Temporal reasoning

## Testing Requirements

### Supersession Tests

1. Basic supersession: A supersedes nothing, B supersedes A
   - Verify B.supersedes = [A.id]
   - Verify A.supersededBy = B.id
   - Verify search returns B but not A

2. Chain supersession: A->B->C
   - Verify only C returned by default
   - Verify A and B returned with includeSuperseded=true
   - Verify chain reconstruction

3. Multiple supersession: C supersedes [A, B]
   - Verify both A and B marked as superseded
   - Verify C lists both in supersedes array

4. Concurrent supersession (error case)
   - Two memories try to supersede the same memory
   - Second should fail (already superseded)

### Conflict Detection Tests

1. Exact duplicate detection
   - Same type and content
   - Should return high similarity (>0.9)

2. Near-duplicate detection
   - Same type, similar content
   - Should return medium similarity (0.7-0.9)

3. Different type, same content
   - Should not conflict (different semantic meaning)

4. No conflict
   - Different type and content
   - Should return no conflicts

### Source Provenance Tests

1. Verify agentId stored correctly
2. Verify sessionKey stored when provided
3. Verify timestamp auto-generated
4. Verify can filter by agentId

## Integration with Existing Memory System

Memento is separate from the existing markdown-based memory search:

- Existing memory search: indexes `MEMORY.md` and `memory/*.md` files
- Memento: structured database of discrete memory entries

Both systems can coexist:
- Use memory search for document retrieval
- Use memento for structured facts, preferences, decisions
- Consider future integration where memento entries can reference memory search results
