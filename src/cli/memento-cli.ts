/**
 * CLI commands for Memento (structured memory system)
 */

import type { Command } from "commander";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { Memento, MemoryType, type Memory, type QueryResult } from "../agents/memento/index.js";
import { loadConfig } from "../config/config.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { renderTable } from "../terminal/table.js";
import { colorize, isRich, theme } from "../terminal/theme.js";
import { formatErrorMessage } from "./cli-utils.js";
import { parseDuration } from "./parse-duration.js";

type MementoBaseOptions = {
  agent?: string;
  json?: boolean;
};

type MementoSearchOptions = MementoBaseOptions & {
  type?: string[];
  tags?: string[];
  since?: string;
  until?: string;
  minConfidence?: number;
  includeArchived?: boolean;
  limit?: number;
  recencyWeight?: number;
};

type MementoListOptions = MementoBaseOptions & {
  type?: string[];
  tags?: string[];
  includeArchived?: boolean;
  limit?: number;
};

type MementoAddOptions = MementoBaseOptions & {
  type: string;
  content: string;
  tags?: string;
  confidence?: number;
  source?: string;
};

function resolveAgent(cfg: ReturnType<typeof loadConfig>, agent?: string): string {
  const trimmed = agent?.trim();
  if (trimmed) {
    return trimmed;
  }
  return resolveDefaultAgentId(cfg);
}

function parseMemoryType(typeStr: string): MemoryType | null {
  const normalized = typeStr.toLowerCase().trim();
  const validTypes: MemoryType[] = [
    MemoryType.FACT,
    MemoryType.DECISION,
    MemoryType.PREFERENCE,
    MemoryType.CONTEXT,
    MemoryType.INSIGHT,
    MemoryType.TASK,
  ];

  for (const type of validTypes) {
    if (type === normalized) {
      return type;
    }
  }

  return null;
}

function formatMemoryType(type: MemoryType): string {
  const typeColors: Record<MemoryType, keyof typeof theme> = {
    [MemoryType.FACT]: "info",
    [MemoryType.DECISION]: "accent",
    [MemoryType.PREFERENCE]: "success",
    [MemoryType.CONTEXT]: "muted",
    [MemoryType.INSIGHT]: "warn",
    [MemoryType.TASK]: "command",
  };

  const rich = isRich();
  const color = typeColors[type] ?? "muted";
  return colorize(rich, theme[color], type);
}

function formatMemory(memory: Memory, showDetails = false): string {
  const rich = isRich();
  const lines: string[] = [];

  // Header: ID and type
  const header = `${colorize(rich, theme.accent, memory.id.slice(0, 8))} ${formatMemoryType(memory.type)}`;
  lines.push(header);

  // Content
  const content = memory.content.length > 100 && !showDetails
    ? `${memory.content.slice(0, 100)}...`
    : memory.content;
  lines.push(`  ${content}`);

  if (showDetails) {
    // Tags
    if (memory.tags.length > 0) {
      const tagsStr = memory.tags.map((t) => colorize(rich, theme.muted, `#${t}`)).join(" ");
      lines.push(`  ${colorize(rich, theme.muted, "Tags:")} ${tagsStr}`);
    }

    // Confidence
    const confidenceColor = memory.confidence >= 0.8
      ? theme.success
      : memory.confidence >= 0.5
        ? theme.warn
        : theme.error;
    lines.push(
      `  ${colorize(rich, theme.muted, "Confidence:")} ${colorize(
        rich,
        confidenceColor,
        memory.confidence.toFixed(2),
      )}`,
    );

    // Source
    if (memory.source) {
      lines.push(`  ${colorize(rich, theme.muted, "Source:")} ${memory.source}`);
    }

    // Timestamps
    lines.push(
      `  ${colorize(rich, theme.muted, "Created:")} ${memory.createdAt.toISOString()}`,
    );

    if (memory.archivedAt) {
      lines.push(
        `  ${colorize(rich, theme.warn, "Archived:")} ${memory.archivedAt.toISOString()}`,
      );
    }
  }

  return lines.join("\n");
}

function formatQueryResult(result: QueryResult): string {
  const rich = isRich();
  const lines: string[] = [];

  // Rank and score
  const scoreStr = `${result.score.toFixed(3)} (semantic: ${result.semanticScore.toFixed(
    3,
  )}, recency: ${result.recencyScore.toFixed(3)})`;
  lines.push(
    `${colorize(rich, theme.success, `#${result.rank}`)} ${colorize(
      rich,
      theme.muted,
      scoreStr,
    )}`,
  );

  // Memory details
  lines.push(formatMemory(result.memory, true));

  return lines.join("\n");
}

/**
 * Search memories
 */
async function runMementoSearch(query: string | undefined, opts: MementoSearchOptions) {
  try {
    const cfg = loadConfig();
    const agentId = resolveAgent(cfg, opts.agent);
    const memento = new Memento(Memento.getAgentDbPath(agentId));

    try {
      // Parse types
      const types = opts.type?.map((t) => {
        const parsed = parseMemoryType(t);
        if (!parsed) {
          throw new Error(`Invalid memory type: ${t}`);
        }
        return parsed;
      });

      // Parse tags
      const tags = opts.tags?.flatMap((t) => t.split(",").map((tag) => tag.trim()));

      // Parse dates
      let since: Date | undefined;
      let until: Date | undefined;

      if (opts.since) {
        const ms = parseDuration(opts.since);
        if (ms !== null) {
          since = new Date(Date.now() - ms);
        } else {
          since = new Date(opts.since);
          if (Number.isNaN(since.getTime())) {
            throw new Error(`Invalid date format for --since: ${opts.since}`);
          }
        }
      }

      if (opts.until) {
        until = new Date(opts.until);
        if (Number.isNaN(until.getTime())) {
          throw new Error(`Invalid date format for --until: ${opts.until}`);
        }
      }

      // Execute query
      const results = memento.query({
        query,
        types,
        tags,
        since,
        until,
        minConfidence: opts.minConfidence,
        includeArchived: opts.includeArchived,
        limit: opts.limit,
        recencyWeight: opts.recencyWeight,
      });

      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ results }, null, 2));
        return;
      }

      if (results.length === 0) {
        defaultRuntime.log("No memories found.");
        return;
      }

      const lines: string[] = [];
      lines.push(
        colorize(isRich(), theme.heading, `Found ${results.length} memories:`),
      );
      lines.push("");

      for (const result of results) {
        lines.push(formatQueryResult(result));
        lines.push("");
      }

      defaultRuntime.log(lines.join("\n"));
    } finally {
      memento.close();
    }
  } catch (err) {
    const message = formatErrorMessage(err);
    defaultRuntime.error(`Memento search failed: ${message}`);
    process.exitCode = 1;
  }
}

/**
 * List memories
 */
async function runMementoList(opts: MementoListOptions) {
  try {
    const cfg = loadConfig();
    const agentId = resolveAgent(cfg, opts.agent);
    const memento = new Memento(Memento.getAgentDbPath(agentId));

    try {
      // Parse types
      const types = opts.type?.map((t) => {
        const parsed = parseMemoryType(t);
        if (!parsed) {
          throw new Error(`Invalid memory type: ${t}`);
        }
        return parsed;
      });

      // Parse tags
      const tags = opts.tags?.flatMap((t) => t.split(",").map((tag) => tag.trim()));

      // List memories
      const memories = memento.list({
        types,
        tags,
        includeArchived: opts.includeArchived,
        limit: opts.limit,
      });

      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ memories }, null, 2));
        return;
      }

      if (memories.length === 0) {
        defaultRuntime.log("No memories found.");
        return;
      }

      const lines: string[] = [];
      lines.push(
        colorize(isRich(), theme.heading, `${memories.length} memories:`),
      );
      lines.push("");

      for (const memory of memories) {
        lines.push(formatMemory(memory));
        lines.push("");
      }

      defaultRuntime.log(lines.join("\n"));
    } finally {
      memento.close();
    }
  } catch (err) {
    const message = formatErrorMessage(err);
    defaultRuntime.error(`Memento list failed: ${message}`);
    process.exitCode = 1;
  }
}

/**
 * Add a memory
 */
async function runMementoAdd(opts: MementoAddOptions) {
  try {
    const cfg = loadConfig();
    const agentId = resolveAgent(cfg, opts.agent);
    const memento = new Memento(Memento.getAgentDbPath(agentId));

    try {
      const type = parseMemoryType(opts.type);
      if (!type) {
        throw new Error(`Invalid memory type: ${opts.type}`);
      }

      const tags = opts.tags
        ? opts.tags.split(",").map((t) => t.trim())
        : [];

      const memory = memento.add({
        type,
        content: opts.content,
        tags,
        confidence: opts.confidence,
        source: opts.source,
      });

      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ memory }, null, 2));
        return;
      }

      defaultRuntime.log(
        colorize(
          isRich(),
          theme.success,
          `✓ Memory created: ${memory.id.slice(0, 8)}`,
        ),
      );
      defaultRuntime.log("");
      defaultRuntime.log(formatMemory(memory, true));
    } finally {
      memento.close();
    }
  } catch (err) {
    const message = formatErrorMessage(err);
    defaultRuntime.error(`Memento add failed: ${message}`);
    process.exitCode = 1;
  }
}

/**
 * Archive a memory
 */
async function runMementoArchive(id: string, opts: MementoBaseOptions) {
  try {
    const cfg = loadConfig();
    const agentId = resolveAgent(cfg, opts.agent);
    const memento = new Memento(Memento.getAgentDbPath(agentId));

    try {
      const success = memento.archive(id);

      if (!success) {
        defaultRuntime.error(`Memory not found or already archived: ${id}`);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ success }, null, 2));
        return;
      }

      defaultRuntime.log(
        colorize(isRich(), theme.success, `✓ Memory archived: ${id}`),
      );
    } finally {
      memento.close();
    }
  } catch (err) {
    const message = formatErrorMessage(err);
    defaultRuntime.error(`Memento archive failed: ${message}`);
    process.exitCode = 1;
  }
}

/**
 * Delete a memory
 */
async function runMementoDelete(id: string, opts: MementoBaseOptions) {
  try {
    const cfg = loadConfig();
    const agentId = resolveAgent(cfg, opts.agent);
    const memento = new Memento(Memento.getAgentDbPath(agentId));

    try {
      const success = memento.delete(id);

      if (!success) {
        defaultRuntime.error(`Memory not found: ${id}`);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ success }, null, 2));
        return;
      }

      defaultRuntime.log(
        colorize(isRich(), theme.success, `✓ Memory deleted: ${id}`),
      );
    } finally {
      memento.close();
    }
  } catch (err) {
    const message = formatErrorMessage(err);
    defaultRuntime.error(`Memento delete failed: ${message}`);
    process.exitCode = 1;
  }
}

/**
 * Register memento CLI commands
 */
export function registerMementoCli(program: Command) {
  const memento = program
    .command("memento")
    .description("Structured memory management")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/memento", "docs.openclaw.ai/cli/memento")}\n`,
    );

  memento
    .command("search")
    .description("Search memories with filters")
    .argument("[query]", "Search query (optional)")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--type <type...>", "Filter by memory type (fact, decision, preference, context, insight, task)")
    .option("--tags <tags...>", "Filter by tags (comma-separated)")
    .option("--since <date>", "Created after (date or duration like 7d)")
    .option("--until <date>", "Created before (ISO date)")
    .option("--min-confidence <n>", "Minimum confidence (0-1)", (v) => Number.parseFloat(v))
    .option("--include-archived", "Include archived memories", false)
    .option("--limit <n>", "Maximum results", (v) => Number.parseInt(v, 10), 20)
    .option("--recency-weight <n>", "Recency weight (0-1)", (v) => Number.parseFloat(v))
    .option("--json", "Print JSON")
    .action(async (query: string | undefined, opts: MementoSearchOptions) => {
      await runMementoSearch(query, opts);
    });

  memento
    .command("list")
    .description("List memories")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--type <type...>", "Filter by memory type")
    .option("--tags <tags...>", "Filter by tags (comma-separated)")
    .option("--include-archived", "Include archived memories", false)
    .option("--limit <n>", "Maximum results", (v) => Number.parseInt(v, 10))
    .option("--json", "Print JSON")
    .action(async (opts: MementoListOptions) => {
      await runMementoList(opts);
    });

  memento
    .command("add")
    .description("Add a new memory")
    .option("--agent <id>", "Agent id (default: default agent)")
    .requiredOption("--type <type>", "Memory type (fact, decision, preference, context, insight, task)")
    .requiredOption("--content <text>", "Memory content")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--confidence <n>", "Confidence score (0-1)", (v) => Number.parseFloat(v), 1.0)
    .option("--source <source>", "Memory source")
    .option("--json", "Print JSON")
    .action(async (opts: MementoAddOptions) => {
      await runMementoAdd(opts);
    });

  memento
    .command("archive")
    .description("Archive a memory (soft delete)")
    .argument("<id>", "Memory ID")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .action(async (id: string, opts: MementoBaseOptions) => {
      await runMementoArchive(id, opts);
    });

  memento
    .command("delete")
    .description("Permanently delete a memory")
    .argument("<id>", "Memory ID")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .action(async (id: string, opts: MementoBaseOptions) => {
      await runMementoDelete(id, opts);
    });
}
