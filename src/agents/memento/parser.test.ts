/**
 * Tests for daily note parser
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  cleanContent,
  filterByDateRange,
  findLineNumber,
  getDailyNote,
  listDailyNotes,
  parseDailyNote,
  parseSections,
} from "./parser.js";

describe("parseDailyNote", () => {
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memento-test-"));
  });
  
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  
  test("parses valid daily note", async () => {
    const content = `# 2026-02-08

## Morning
- Reviewed memento requirements
- Implemented parser

## Afternoon
Worked on tests.`;
    
    const filepath = path.join(tempDir, "2026-02-08.md");
    await fs.writeFile(filepath, content);
    
    const note = await parseDailyNote(filepath);
    
    expect(note.date).toBe("2026-02-08");
    expect(note.filepath).toBe(filepath);
    expect(note.content).toBe(content);
    expect(note.lineCount).toBeGreaterThan(0);
    expect(note.stats.size).toBeGreaterThan(0);
  });
  
  test("throws on invalid filename format", async () => {
    const filepath = path.join(tempDir, "invalid-name.md");
    await fs.writeFile(filepath, "# Test");
    
    await expect(parseDailyNote(filepath)).rejects.toThrow("Invalid daily note filename format");
  });
  
  test("handles empty file", async () => {
    const filepath = path.join(tempDir, "2026-02-08.md");
    await fs.writeFile(filepath, "");
    
    const note = await parseDailyNote(filepath);
    expect(note.content).toBe("");
    expect(note.lineCount).toBe(1);
  });
});

describe("parseSections", () => {
  test("parses sections with headings", () => {
    const content = `# 2026-02-08

## Morning
Morning content

## Afternoon
Afternoon content`;
    
    const note = {
      date: "2026-02-08",
      filepath: "/tmp/test.md",
      content,
      lineCount: content.split("\n").length,
      stats: { size: 100, mtime: new Date() },
    };
    
    const sections = parseSections(note);
    
    expect(sections).toHaveLength(3);
    expect(sections[0].heading).toBe("2026-02-08");
    expect(sections[1].heading).toBe("Morning");
    expect(sections[1].content.trim()).toBe("Morning content");
    expect(sections[2].heading).toBe("Afternoon");
    expect(sections[2].content.trim()).toBe("Afternoon content");
  });
  
  test("handles content before first heading", () => {
    const content = `Preamble content

## Section
Section content`;
    
    const note = {
      date: "2026-02-08",
      filepath: "/tmp/test.md",
      content,
      lineCount: content.split("\n").length,
      stats: { size: 100, mtime: new Date() },
    };
    
    const sections = parseSections(note);
    
    expect(sections[0].content).toContain("Preamble content");
    expect(sections[0].heading).toBeUndefined();
  });
  
  test("filters empty sections", () => {
    const content = `## Empty

## Not Empty
Content here`;
    
    const note = {
      date: "2026-02-08",
      filepath: "/tmp/test.md",
      content,
      lineCount: content.split("\n").length,
      stats: { size: 100, mtime: new Date() },
    };
    
    const sections = parseSections(note);
    
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Not Empty");
  });
});

describe("listDailyNotes", () => {
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memento-test-"));
  });
  
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  
  test("lists daily note files", async () => {
    await fs.writeFile(path.join(tempDir, "2026-02-08.md"), "# Test");
    await fs.writeFile(path.join(tempDir, "2026-02-07.md"), "# Test");
    await fs.writeFile(path.join(tempDir, "other.md"), "# Other");
    await fs.writeFile(path.join(tempDir, "README.md"), "# README");
    
    const files = await listDailyNotes(tempDir);
    
    expect(files).toHaveLength(2);
    expect(files[0]).toContain("2026-02-07.md");
    expect(files[1]).toContain("2026-02-08.md");
  });
  
  test("returns empty array for non-existent directory", async () => {
    const files = await listDailyNotes(path.join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });
  
  test("ignores subdirectories", async () => {
    await fs.mkdir(path.join(tempDir, "2026-02-08.md"));
    const files = await listDailyNotes(tempDir);
    expect(files).toEqual([]);
  });
});

describe("filterByDateRange", () => {
  test("filters by from date", () => {
    const files = [
      "/tmp/2026-02-05.md",
      "/tmp/2026-02-07.md",
      "/tmp/2026-02-10.md",
    ];
    
    const filtered = filterByDateRange(files, "2026-02-07");
    
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toContain("2026-02-07");
    expect(filtered[1]).toContain("2026-02-10");
  });
  
  test("filters by to date", () => {
    const files = [
      "/tmp/2026-02-05.md",
      "/tmp/2026-02-07.md",
      "/tmp/2026-02-10.md",
    ];
    
    const filtered = filterByDateRange(files, undefined, "2026-02-07");
    
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toContain("2026-02-05");
    expect(filtered[1]).toContain("2026-02-07");
  });
  
  test("filters by date range", () => {
    const files = [
      "/tmp/2026-02-05.md",
      "/tmp/2026-02-07.md",
      "/tmp/2026-02-10.md",
    ];
    
    const filtered = filterByDateRange(files, "2026-02-06", "2026-02-09");
    
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toContain("2026-02-07");
  });
});

describe("getDailyNote", () => {
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memento-test-"));
  });
  
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  
  test("finds existing daily note", async () => {
    const filepath = path.join(tempDir, "2026-02-08.md");
    await fs.writeFile(filepath, "# Test");
    
    const result = await getDailyNote(tempDir, "2026-02-08");
    expect(result).toBe(filepath);
  });
  
  test("returns null for non-existent note", async () => {
    const result = await getDailyNote(tempDir, "2026-02-08");
    expect(result).toBeNull();
  });
});

describe("findLineNumber", () => {
  test("finds substring in content", () => {
    const content = `Line 1
Line 2
Target line
Line 4`;
    
    const line = findLineNumber(content, "Target");
    expect(line).toBe(3);
  });
  
  test("returns undefined for missing substring", () => {
    const content = "Line 1\nLine 2";
    const line = findLineNumber(content, "Missing");
    expect(line).toBeUndefined();
  });
});

describe("cleanContent", () => {
  test("removes excessive whitespace", () => {
    const content = `Line 1  


Line 2  
Line 3   `;
    
    const cleaned = cleanContent(content);
    
    expect(cleaned).toBe("Line 1\n\nLine 2\nLine 3");
  });
  
  test("preserves double newlines", () => {
    const content = "Line 1\n\nLine 2";
    const cleaned = cleanContent(content);
    expect(cleaned).toBe(content);
  });
  
  test("trims leading and trailing whitespace", () => {
    const content = "  \n  Line 1  \n  ";
    const cleaned = cleanContent(content);
    expect(cleaned).toBe("Line 1");
  });
});
