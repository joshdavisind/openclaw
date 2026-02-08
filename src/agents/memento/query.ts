/**
 * Query layer for Memento with advanced filtering and ranking
 */

import type { MementoDatabase } from "./database.js";
import type { Memory, MemoryQuery, QueryResult, FTSResultRow } from "./types.js";

/**
 * Calculate recency score using exponential decay
 */
function calculateRecencyScore(createdAt: Date, decayRate = 0.1): number {
  const now = Date.now();
  const ageInDays = (now - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-decayRate * ageInDays);
}

/**
 * Normalize scores to 0-1 range
 */
function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = max - min;
  if (range === 0) return scores.map(() => 1);
  return scores.map((s) => (s - min) / range);
}

/**
 * Execute a memory query with filtering, ranking, and recency weighting
 */
export function executeQuery(db: MementoDatabase, query: MemoryQuery): QueryResult[] {
  const limit = query.limit ?? 20;
  const recencyWeight = query.recencyWeight ?? 0.3;
  const minConfidence = query.minConfidence ?? 0;

  let candidates: Memory[] = [];
  let semanticRanks: Map<string, number> = new Map();

  // Step 1: Get initial candidates
  if (query.query) {
    // Use FTS5 for semantic search
    const ftsResults = db.search(query.query);
    candidates = ftsResults.map((row) => {
      const memory: Memory = {
        id: row.id,
        type: row.type as Memory["type"],
        content: row.content,
        tags: JSON.parse(row.tags),
        confidence: row.confidence,
        source: row.source ?? undefined,
        context: row.context ? JSON.parse(row.context) : undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        archivedAt: row.archived_at ? new Date(row.archived_at) : null,
      };
      // Store FTS5 rank (lower is better, so we negate it)
      semanticRanks.set(row.id, -row.rank);
      return memory;
    });
  } else {
    // No text query, just list with filters
    candidates = db.list({
      types: query.types,
      tags: query.tags,
      includeArchived: query.includeArchived ?? false,
      limit: limit * 3, // Get more candidates for filtering
    });
  }

  // Step 2: Apply filters
  let filtered = candidates.filter((memory) => {
    // Type filter
    if (query.types && query.types.length > 0) {
      if (!query.types.includes(memory.type)) return false;
    }

    // Tag filter (OR logic)
    if (query.tags && query.tags.length > 0) {
      const hasMatchingTag = query.tags.some((tag) => memory.tags.includes(tag));
      if (!hasMatchingTag) return false;
    }

    // Date filters
    if (query.since && memory.createdAt < query.since) return false;
    if (query.until && memory.createdAt > query.until) return false;

    // Confidence filter
    if (memory.confidence < minConfidence) return false;

    // Archive filter
    if (!query.includeArchived && memory.archivedAt) return false;

    return true;
  });

  // Step 3: Calculate scores
  const results: QueryResult[] = filtered.map((memory) => {
    // Semantic score (from FTS5 rank or 1.0 if no text query)
    let semanticScore = 1.0;
    if (query.query && semanticRanks.has(memory.id)) {
      semanticScore = semanticRanks.get(memory.id)!;
    }

    // Recency score
    const recencyScore = calculateRecencyScore(memory.createdAt);

    // Combined score
    const score = (1 - recencyWeight) * semanticScore + recencyWeight * recencyScore;

    return {
      memory,
      score,
      semanticScore,
      recencyScore,
      rank: 0, // Will be set after sorting
    };
  });

  // Step 4: Normalize semantic scores if we have FTS5 results
  if (query.query && results.length > 0) {
    const semanticScores = results.map((r) => r.semanticScore);
    const normalizedSemanticScores = normalizeScores(semanticScores);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      result.semanticScore = normalizedSemanticScores[i];
      // Recalculate combined score with normalized semantic score
      result.score = (1 - recencyWeight) * result.semanticScore + recencyWeight * result.recencyScore;
    }
  }

  // Step 5: Sort by score and assign ranks
  results.sort((a, b) => b.score - a.score);
  for (let i = 0; i < results.length; i++) {
    results[i].rank = i + 1;
  }

  // Step 6: Apply limit
  return results.slice(0, limit);
}

/**
 * Build a context string from top query results
 */
export function buildContext(results: QueryResult[], maxResults = 5): string {
  return results
    .slice(0, maxResults)
    .map((r) => r.memory.content)
    .join("\n");
}

/**
 * Group results by type
 */
export function groupByType(results: QueryResult[]): Map<string, QueryResult[]> {
  const groups = new Map<string, QueryResult[]>();
  for (const result of results) {
    const type = result.memory.type;
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push(result);
  }
  return groups;
}

/**
 * Get top tags from results
 */
export function extractTopTags(results: QueryResult[], limit = 10): Array<{ tag: string; count: number }> {
  const tagCounts = new Map<string, number>();
  for (const result of results) {
    for (const tag of result.memory.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
