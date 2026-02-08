---
name: memento
description: Structured memory system for persistent facts, preferences, decisions, and context across sessions.
metadata: { "openclaw": { "emoji": "🧠" } }
---

# memento

Store and retrieve structured memories with semantic types, tags, and full-text search. Perfect for remembering user preferences, past decisions, project context, and factual information across conversations.

## When to Use

Use Memento when you need to:

- **Remember facts** about the user, project, or environment
- **Track decisions** and their rationale
- **Store preferences** for coding style, tools, or workflows
- **Maintain context** about ongoing projects or tasks
- **Build insights** from past interactions
- **Manage tasks** and their requirements

## Memory Types

- **fact**: Factual information (`"User lives in Seattle"`)
- **decision**: Past decisions (`"Chose React over Vue for better TypeScript support"`)
- **preference**: User preferences (`"Prefers concise code with brief comments"`)
- **context**: Situational context (`"Working on Project Vesper - a CLI tool"`)
- **insight**: Derived insights (`"User is a visual learner, prefers diagrams"`)
- **task**: Task-related memory (`"User wants to add dark mode to settings"`)

## Quick Examples

### Create Memories

```bash
# Add a user preference
openclaw memento add --type preference --content "User prefers TypeScript over JavaScript" --tags coding,language

# Record a decision
openclaw memento add --type decision --content "Using SQLite for local storage due to simplicity" --tags architecture,database --confidence 0.9

# Store project context
openclaw memento add --type context --content "Project Vesper is a CLI tool for media processing" --tags vesper,project
```

### Search Memories

```bash
# Basic text search
openclaw memento search "typescript"

# Filter by type
openclaw memento search "architecture" --type decision --type preference

# Search with tags
openclaw memento search "coding style" --tags coding --limit 5

# Recent memories (high recency weight)
openclaw memento search "project status" --since 7d --recency-weight 0.8

# High-confidence only
openclaw memento search "user preferences" --min-confidence 0.8
```

### List Memories

```bash
# List all memories
openclaw memento list

# List by type
openclaw memento list --type preference --type fact

# List recent project context
openclaw memento list --tags project --limit 10
```

### Archive or Delete

```bash
# Archive (soft delete)
openclaw memento archive <memory-id>

# Permanently delete
openclaw memento delete <memory-id>
```

## Advanced Usage

### Date Filters

```bash
# Memories from last 7 days
openclaw memento search "API design" --since 7d

# Memories from last 30 days
openclaw memento search --since 30d --type decision

# Specific date range
openclaw memento search --since 2026-01-01 --until 2026-02-01
```

### Confidence Scoring

Confidence scores (0.0-1.0) indicate reliability:

- **1.0**: Explicit user statement or confirmed fact
- **0.8-0.9**: High confidence inference
- **0.5-0.7**: Reasonable inference or assumption
- **Below 0.5**: Tentative or speculative

```bash
# Only high-confidence memories
openclaw memento search "user habits" --min-confidence 0.8
```

### Recency Weighting

Balance semantic relevance vs. recency (0 = pure semantic, 1 = pure recency):

```bash
# Pure semantic search (default: 0.3)
openclaw memento search "architecture decisions" --recency-weight 0

# Balanced
openclaw memento search "recent changes" --recency-weight 0.5

# Prefer recent memories
openclaw memento search "current tasks" --recency-weight 0.9
```

## JSON Output

All commands support `--json` for programmatic access:

```bash
openclaw memento search "user preferences" --json
openclaw memento list --type fact --json
```

## Storage

Memories are stored per-agent in:

```
~/.openclaw/agents/<agentId>/memento.db
```

The database uses SQLite with FTS5 for fast full-text search.

## Tips

### Tagging Strategy

Use consistent tags for easy filtering:

- **Project tags**: `vesper`, `project-x`, `client-work`
- **Domain tags**: `backend`, `frontend`, `devops`, `architecture`
- **Category tags**: `coding-style`, `testing`, `security`, `performance`

### Effective Queries

- **Be specific**: `"React hooks patterns"` > `"React"`
- **Use types**: Filter by type to reduce noise
- **Combine filters**: Type + tags + date for precision
- **Adjust weights**: Recent decisions? Use `--recency-weight 0.7`

### Memory Hygiene

- **Archive outdated** memories instead of deleting (keeps history)
- **Update confidence** when information is confirmed or invalidated
- **Add context** via tags and source metadata
- **Review regularly**: `openclaw memento list --limit 50`

## Integration with Agents

Agents can query Memento during conversations to:

- Retrieve user preferences for response style
- Check past decisions to maintain consistency
- Understand project context automatically
- Build on previous insights

Example agent flow:

1. User asks: "Should we use Redis or Postgres?"
2. Agent queries: `memento.query({ query: "database decisions", types: [MemoryType.DECISION], limit: 5 })`
3. Agent finds: "Chose Postgres for relational data due to strong ACID guarantees"
4. Agent responds with context-aware recommendation

## See Also

- Spec: `docs/memento-spec.md`
- Implementation: `src/agents/memento/`
- CLI help: `openclaw memento --help`

## Examples by Use Case

### Coding Preferences

```bash
openclaw memento add --type preference --content "User prefers functional programming style" --tags coding,style
openclaw memento add --type preference --content "Use descriptive variable names, avoid abbreviations" --tags coding,naming
openclaw memento search "coding style" --type preference
```

### Project Context

```bash
openclaw memento add --type context --content "Project Vesper: CLI for media processing, targets macOS/Linux" --tags vesper,project
openclaw memento add --type decision --content "Using FFmpeg for video processing in Vesper" --tags vesper,architecture
openclaw memento search --tags vesper
```

### Task Tracking

```bash
openclaw memento add --type task --content "Add dark mode toggle to settings page" --tags ui,feature
openclaw memento add --type task --content "Implement user authentication with OAuth" --tags backend,security
openclaw memento list --type task
```

### Learning Patterns

```bash
openclaw memento add --type insight --content "User learns best with visual examples and diagrams" --tags learning,communication
openclaw memento add --type insight --content "User prefers step-by-step explanations for complex topics" --tags learning,communication
openclaw memento search "learning" --type insight
```
