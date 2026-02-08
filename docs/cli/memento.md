---
summary: "CLI reference for `openclaw memento` (consolidate/status)"
read_when:
  - You want to extract structured memories from daily notes
  - You're working with memory consolidation
  - You need to check memento status
title: "memento"
---

# `openclaw memento`

Structured memory consolidation from daily notes. Memento extracts typed memories (FACT, DECISION, PREFERENCE, OBSERVATION, TASK, CONTEXT) from freeform daily notes using LLM classification.

Related:

- Memory concept: [Memory](/concepts/memory)
- Memento specification: [Memento Spec](/memento-spec)

## Commands

### `openclaw memento consolidate`

Extract and consolidate structured memories from daily notes.

```bash
# Consolidate a specific date
openclaw memento consolidate --date 2026-02-07

# Consolidate all unprocessed files
openclaw memento consolidate --pending

# Re-process all files (ignore state)
openclaw memento consolidate --force

# Consolidate date range
openclaw memento consolidate --from 2026-02-01 --to 2026-02-07

# Verbose output with progress
openclaw memento consolidate --pending --verbose

# JSON output
openclaw memento consolidate --date 2026-02-07 --json

# Specific agent
openclaw memento consolidate --pending --agent personal
```

Options:

- `--date <YYYY-MM-DD>`: Consolidate specific date
- `--pending`: Process all files modified since last consolidation
- `--force`: Re-process all files regardless of state
- `--from <YYYY-MM-DD>`: Start date for range
- `--to <YYYY-MM-DD>`: End date for range
- `--agent <id>`: Agent ID (default: main)
- `--verbose`: Show detailed extraction progress
- `--json`: Output as JSON

### `openclaw memento status`

Show memento consolidation status and memory statistics.

```bash
# Show status
openclaw memento status

# Show status with pending files list
openclaw memento status --verbose

# JSON output
openclaw memento status --json

# Specific agent
openclaw memento status --agent personal
```

Options:

- `--agent <id>`: Agent ID (default: main)
- `--verbose`: Show pending files
- `--json`: Output as JSON

## Memory Types

Memento classifies extracted content into six types:

- **FACT**: Objective, verifiable information
- **DECISION**: Explicit choices with rationale
- **PREFERENCE**: User/system preferences and patterns
- **OBSERVATION**: Noted patterns and insights
- **TASK**: Action items and TODOs
- **CONTEXT**: Background information

## Confidence Scores

Each memory has a confidence score (0.0 to 1.0):

- **0.9-1.0**: High confidence (explicit, clear statements)
- **0.7-0.89**: Good confidence (implied but clear from context)
- **0.5-0.69**: Medium confidence (inferred, may need verification)
- **0.0-0.49**: Low confidence (uncertain, conflicting information)

## Daily Note Format

Daily notes live at `memory/YYYY-MM-DD.md` in the agent workspace:

```markdown
# 2026-02-08

## Morning
- Reviewed memento requirements
- Need to extract structured memories from daily notes

## Afternoon
Implemented the consolidation engine. Key decisions:
- Use LLM for classification (more flexible than regex)
- Store state in SQLite for idempotency
```

## Storage

Consolidated memories are stored in:

- **Memories**: `~/.openclaw/agents/<agentId>/memento/memories.sqlite`
- **State**: `~/.openclaw/agents/<agentId>/memento/state.json`

State tracking enables idempotent consolidation: re-running `consolidate --pending` only processes new or modified files.

## Workflow

Typical memento workflow:

1. **Write daily notes** throughout the day in `memory/YYYY-MM-DD.md`
2. **Consolidate periodically**: `openclaw memento consolidate --pending`
3. **Check status**: `openclaw memento status`
4. **Query memories** (future): Search and filter consolidated memories

## Examples

### Daily consolidation

```bash
# At end of day, consolidate today's notes
openclaw memento consolidate --date $(date +%Y-%m-%d)
```

### Periodic batch

```bash
# Consolidate all pending files
openclaw memento consolidate --pending --verbose
```

### Status check

```bash
# See what's pending
openclaw memento status --verbose
```

### Backfill

```bash
# Process last week
openclaw memento consolidate \
  --from 2026-02-01 \
  --to 2026-02-07
```

### Force re-processing

```bash
# Re-extract from all files
openclaw memento consolidate --force
```

## Integration with Memory Search

Memento complements existing memory search:

- **Memory search** (`openclaw memory`): Semantic search over raw Markdown
- **Memento**: Structured, typed query over extracted memories

Future integration will surface memento memories via `memory_search` tool.

## Performance

Consolidation performance depends on:

- Number of files to process
- File sizes (content length)
- LLM provider and model speed
- Batch processing settings

Typical performance:

- Single file: 2-5 seconds
- 10 files: 20-50 seconds
- 100 files: 5-10 minutes

Use `--verbose` to see per-file progress.

## Troubleshooting

### No memories extracted

If consolidation completes but extracts zero memories:

- Check daily note content is substantial (> 50 words)
- Verify notes contain actionable information (facts, decisions, etc.)
- Try more explicit memory markers (bullet points, clear statements)

### State out of sync

If `--pending` misses modified files:

```bash
# Force re-consolidation
openclaw memento consolidate --force
```

### Duplicate memories

Memento tracks file modification times to prevent duplicates. If you see duplicates:

- Check state file: `~/.openclaw/agents/<agentId>/memento/state.json`
- Clear state and re-consolidate: `rm state.json && openclaw memento consolidate --force`

### LLM extraction errors

If extraction fails:

- Verify model configuration: `openclaw models status`
- Check LLM provider availability
- Try with explicit model: Configure in `~/.openclaw/config.json`

## Configuration

Memento uses the agent's configured LLM model:

```json5
{
  agents: {
    defaults: {
      model: {
        provider: "openai",
        name: "gpt-4o-mini"
      }
    }
  }
}
```

Override per-agent:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        model: {
          provider: "anthropic",
          name: "claude-3-5-sonnet-20241022"
        }
      }
    ]
  }
}
```

## Future Features

Planned enhancements:

- **Phase 5**: Memory evolution (confidence updates, merging)
- **Phase 6**: Entity linking and relationship tracking
- **Phase 7**: Active recall and consolidation suggestions
- **Search**: Direct query interface for consolidated memories
- **Export**: Export memories to other formats

## See Also

- [Memory concept](/concepts/memory)
- [Memory CLI](/cli/memory)
- [Agent workspace](/concepts/agent-workspace)
- [Memento specification](/memento-spec)
