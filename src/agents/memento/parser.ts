/**
 * Parser for daily note files
 * 
 * Extracts content from Markdown daily notes for memory extraction.
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface DailyNote {
  date: string;        // YYYY-MM-DD
  filepath: string;
  content: string;
  lineCount: number;
  stats: {
    size: number;
    mtime: Date;
  };
}

export interface ParsedSection {
  heading?: string;
  content: string;
  startLine: number;
  endLine: number;
}

/**
 * Parse a daily note file
 */
export async function parseDailyNote(filepath: string): Promise<DailyNote> {
  const content = await fs.readFile(filepath, "utf-8");
  const stats = await fs.stat(filepath);
  const filename = path.basename(filepath, ".md");
  
  // Extract date from filename (YYYY-MM-DD.md)
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!dateMatch) {
    throw new Error(`Invalid daily note filename format: ${filename} (expected YYYY-MM-DD.md)`);
  }
  
  const lineCount = content.split("\n").length;
  
  return {
    date: dateMatch[1],
    filepath,
    content,
    lineCount,
    stats: {
      size: stats.size,
      mtime: stats.mtime,
    },
  };
}

/**
 * Parse daily note into sections
 */
export function parseSections(note: DailyNote): ParsedSection[] {
  const lines = note.content.split("\n");
  const sections: ParsedSection[] = [];
  
  let currentSection: ParsedSection | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    
    // Check for markdown heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.endLine = lineNumber - 1;
        sections.push(currentSection);
      }
      
      // Start new section
      currentSection = {
        heading: headingMatch[2].trim(),
        content: "",
        startLine: lineNumber,
        endLine: lineNumber,
      };
    } else if (currentSection) {
      // Add line to current section
      currentSection.content += (currentSection.content ? "\n" : "") + line;
      currentSection.endLine = lineNumber;
    } else {
      // Content before first heading
      if (!sections.length || sections[0].heading) {
        sections.unshift({
          content: line,
          startLine: lineNumber,
          endLine: lineNumber,
        });
      } else {
        sections[0].content += "\n" + line;
        sections[0].endLine = lineNumber;
      }
    }
  }
  
  // Add final section
  if (currentSection) {
    sections.push(currentSection);
  }
  
  return sections.filter((s) => s.content.trim().length > 0);
}

/**
 * List all daily note files in memory directory
 */
export async function listDailyNotes(memoryDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    const dailyNotes = entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        if (!entry.name.endsWith(".md")) return false;
        // Match YYYY-MM-DD.md pattern
        return /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name);
      })
      .map((entry) => path.join(memoryDir, entry.name))
      .sort(); // Sort chronologically
    
    return dailyNotes;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Filter daily notes by date range
 */
export function filterByDateRange(
  files: string[],
  from?: string,
  to?: string,
): string[] {
  return files.filter((file) => {
    const filename = path.basename(file, ".md");
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (!dateMatch) return false;
    
    const date = dateMatch[1];
    if (from && date < from) return false;
    if (to && date > to) return false;
    
    return true;
  });
}

/**
 * Get daily note for specific date
 */
export async function getDailyNote(
  memoryDir: string,
  date: string,
): Promise<string | null> {
  const filepath = path.join(memoryDir, `${date}.md`);
  try {
    await fs.access(filepath);
    return filepath;
  } catch {
    return null;
  }
}

/**
 * Extract line number for a substring in content
 */
export function findLineNumber(content: string, substring: string): number | undefined {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(substring)) {
      return i + 1;
    }
  }
  return undefined;
}

/**
 * Clean markdown content for LLM processing
 * Removes excessive whitespace but preserves structure
 */
export function cleanContent(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
