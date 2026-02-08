/**
 * Memento CLI commands
 * 
 * Commands for structured memory consolidation from daily notes.
 */

import type { Command } from "commander";
import path from "node:path";
import {
  closeConsolidationContext,
  consolidateMemories,
  createConsolidationContext,
} from "../agents/memento/consolidate.js";
import { listDailyNotes } from "../agents/memento/parser.js";
import type { ConsolidateOptions } from "../agents/memento/types.js";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { colorize, isRich, theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatErrorMessage } from "./cli-utils.js";
import { withProgress } from "./progress.js";

interface MementoCommandOptions {
  date?: string;
  pending?: boolean;
  force?: boolean;
  from?: string;
  to?: string;
  agent?: string;
  verbose?: boolean;
  json?: boolean;
}

/**
 * Resolve agent workspace directory
 */
function resolveAgentWorkspace(config: ReturnType<typeof loadConfig>, agentId: string): string {
  const agentConfig = config?.agents?.list?.find((a) => a.id === agentId);
  const workspace =
    agentConfig?.workspace ?? config?.agents?.defaults?.workspace ?? "~/.openclaw/workspace";
  
  // Expand home directory
  return workspace.replace(/^~/, process.env.HOME || "~");
}

/**
 * Resolve agent ID (default to "main")
 */
function resolveAgentId(config: ReturnType<typeof loadConfig>, agent?: string): string {
  if (agent?.trim()) {
    return agent.trim();
  }
  return config?.agents?.defaults?.id ?? "main";
}

/**
 * Consolidate memories from daily notes
 */
async function runConsolidate(opts: MementoCommandOptions) {
  const cfg = loadConfig();
  const agentId = resolveAgentId(cfg, opts.agent);
  const workspaceDir = resolveAgentWorkspace(cfg, agentId);
  const stateDir = path.join(resolveStateDir(process.env, (s) => s), "agents", agentId);
  
  let ctx;
  try {
    ctx = await createConsolidationContext(workspaceDir, stateDir, cfg);
  } catch (err) {
    defaultRuntime.error(`Failed to initialize memento: ${formatErrorMessage(err)}`);
    process.exitCode = 1;
    return;
  }
  
  try {
    const options: ConsolidateOptions = {
      agentId,
      date: opts.date,
      pending: opts.pending,
      force: opts.force,
      from: opts.from,
      to: opts.to,
      verbose: opts.verbose,
    };
    
    const stats = await withProgress(
      { label: "Consolidating memories…", total: 1 },
      async () => {
        return await consolidateMemories(ctx, options);
      },
    );
    
    if (opts.json) {
      defaultRuntime.log(JSON.stringify(stats, null, 2));
      return;
    }
    
    const rich = isRich();
    const success = (text: string) => colorize(rich, theme.success, text);
    const info = (text: string) => colorize(rich, theme.info, text);
    const muted = (text: string) => colorize(rich, theme.muted, text);
    
    const lines = [
      `${success("✓")} Consolidation complete`,
      `  ${muted("Files processed:")} ${info(String(stats.filesProcessed))}`,
      `  ${muted("Memories extracted:")} ${info(String(stats.memoriesExtracted))}`,
      `  ${muted("Processing time:")} ${info((stats.processingTime / 1000).toFixed(2))}s`,
    ];
    
    if (stats.memoriesExtracted > 0) {
      lines.push("");
      lines.push(muted("By type:"));
      for (const [type, count] of Object.entries(stats.byType)) {
        if (count > 0) {
          lines.push(`  ${info(type)}: ${count}`);
        }
      }
      
      lines.push("");
      lines.push(muted("By confidence:"));
      lines.push(`  ${info("High")} (0.9-1.0): ${stats.byConfidence.high}`);
      lines.push(`  ${info("Good")} (0.7-0.89): ${stats.byConfidence.good}`);
      lines.push(`  ${info("Medium")} (0.5-0.69): ${stats.byConfidence.medium}`);
      lines.push(`  ${info("Low")} (0.0-0.49): ${stats.byConfidence.low}`);
    }
    
    defaultRuntime.log(lines.join("\n"));
  } catch (err) {
    defaultRuntime.error(`Consolidation failed: ${formatErrorMessage(err)}`);
    process.exitCode = 1;
  } finally {
    closeConsolidationContext(ctx);
  }
}

/**
 * Show memento status
 */
async function runStatus(opts: MementoCommandOptions) {
  const cfg = loadConfig();
  const agentId = resolveAgentId(cfg, opts.agent);
  const workspaceDir = resolveAgentWorkspace(cfg, agentId);
  const stateDir = path.join(resolveStateDir(process.env, (s) => s), "agents", agentId);
  
  let ctx;
  try {
    ctx = await createConsolidationContext(workspaceDir, stateDir, cfg);
  } catch (err) {
    defaultRuntime.error(`Failed to initialize memento: ${formatErrorMessage(err)}`);
    process.exitCode = 1;
    return;
  }
  
  try {
    const status = ctx.store.getStatus();
    status.agentId = agentId;
    
    // Get pending files
    const memoryDir = path.join(workspaceDir, "memory");
    const allFiles = await listDailyNotes(memoryDir);
    const filesWithStats = await Promise.all(
      allFiles.map(async (filepath) => {
        const fs = await import("node:fs/promises");
        const stats = await fs.stat(filepath);
        return { path: filepath, mtime: stats.mtime };
      }),
    );
    const pending = ctx.stateTracker.getPendingFiles(filesWithStats);
    status.pendingFiles = pending;
    status.lastConsolidation = ctx.stateTracker.getLastConsolidation();
    
    if (opts.json) {
      defaultRuntime.log(JSON.stringify(status, null, 2));
      return;
    }
    
    const rich = isRich();
    const heading = (text: string) => colorize(rich, theme.heading, text);
    const info = (text: string) => colorize(rich, theme.info, text);
    const success = (text: string) => colorize(rich, theme.success, text);
    const warn = (text: string) => colorize(rich, theme.warn, text);
    const muted = (text: string) => colorize(rich, theme.muted, text);
    const label = (text: string) => muted(`${text}:`);
    
    const lastConsolidation = status.lastConsolidation
      ? new Date(status.lastConsolidation).toLocaleString()
      : "Never";
    
    const lines = [
      `${heading("Memento Status")} ${muted(`(${agentId})`)}`,
      `${label("Last consolidation")} ${info(lastConsolidation)}`,
      `${label("Total memories")} ${success(String(status.totalMemories))}`,
      `${label("Pending files")} ${status.pendingFiles.length > 0 ? warn(String(status.pendingFiles.length)) : muted("0")}`,
      `${label("Storage")} ${info(shortenHomePath(status.storageLocation))}`,
      `${label("Storage size")} ${info((status.storageSize / 1024).toFixed(2) + " KB")}`,
    ];
    
    if (status.totalMemories > 0) {
      lines.push("");
      lines.push(muted("Memories by type:"));
      for (const [type, count] of Object.entries(status.memoriesByType)) {
        if (count > 0) {
          lines.push(`  ${info(type)}: ${count}`);
        }
      }
      
      lines.push("");
      lines.push(muted("Memories by confidence:"));
      lines.push(`  ${info("High")} (0.9-1.0): ${status.memoriesByConfidence.high}`);
      lines.push(`  ${info("Good")} (0.7-0.89): ${status.memoriesByConfidence.good}`);
      lines.push(`  ${info("Medium")} (0.5-0.69): ${status.memoriesByConfidence.medium}`);
      lines.push(`  ${info("Low")} (0.0-0.49): ${status.memoriesByConfidence.low}`);
    }
    
    if (opts.verbose && status.pendingFiles.length > 0) {
      lines.push("");
      lines.push(muted("Pending files:"));
      for (const file of status.pendingFiles) {
        lines.push(`  ${shortenHomePath(file)}`);
      }
    }
    
    defaultRuntime.log(lines.join("\n"));
  } catch (err) {
    defaultRuntime.error(`Status check failed: ${formatErrorMessage(err)}`);
    process.exitCode = 1;
  } finally {
    closeConsolidationContext(ctx);
  }
}

/**
 * Register memento CLI commands
 */
export function registerMementoCli(program: Command) {
  const memento = program
    .command("memento")
    .description("Structured memory consolidation from daily notes")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/memento", "docs.openclaw.ai/cli/memento")}\n`,
    );
  
  memento
    .command("consolidate")
    .description("Extract and consolidate structured memories from daily notes")
    .option("--date <YYYY-MM-DD>", "Consolidate specific date")
    .option("--pending", "Process all unprocessed files")
    .option("--force", "Re-process all files (ignore state)")
    .option("--from <YYYY-MM-DD>", "Start date for range")
    .option("--to <YYYY-MM-DD>", "End date for range")
    .option("--agent <id>", "Agent ID (default: main)")
    .option("--verbose", "Show detailed progress")
    .option("--json", "Output as JSON")
    .action(async (opts: MementoCommandOptions) => {
      await runConsolidate(opts);
    });
  
  memento
    .command("status")
    .description("Show memento consolidation status")
    .option("--agent <id>", "Agent ID (default: main)")
    .option("--verbose", "Show pending files")
    .option("--json", "Output as JSON")
    .action(async (opts: MementoCommandOptions) => {
      await runStatus(opts);
    });
}
