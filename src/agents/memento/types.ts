/**
 * Memento: OpenClaw's persistent memory system
 */

/**
 * Classification of memory types for semantic organization
 */
export enum MemoryType {
  /** Factual information (e.g., "User lives in Seattle") */
  FACT = "fact",
  /** Past decisions (e.g., "Chose React over Vue") */
  DECISION = "decision",
  /** User preferences (e.g., "Prefers concise code") */
  PREFERENCE = "preference",
  /** Situational context (e.g., "Working on Project Vesper") */
  CONTEXT = "context",
  /** Derived insights (e.g., "User is a visual learner") */
  INSIGHT = "insight",
  /** Task-related memory (e.g., "User wants dark mode") */
  TASK = "task",
}

/**
 * Core memory record with metadata
 */
export interface Memory {
  /** Unique identifier (UUID) */
  id: string;
  /** Memory classification */
  type: MemoryType;
  /** Main memory content */
  content: string;
  /** Categorization tags */
  tags: string[];
  /** Reliability score (0.0 - 1.0) */
  confidence: number;
  /** Origin of memory (e.g., "conversation", "user-input") */
  source?: string;
  /** Additional metadata */
  context?: Record<string, any>;
  /** Creation timestamp */
  createdAt: Date;
  /** Last modification timestamp */
  updatedAt: Date;
  /** Soft delete timestamp */
  archivedAt?: Date | null;
}

/**
 * Query parameters for searching memories
 */
export interface MemoryQuery {
  /** Semantic search text (uses FTS5) */
  query?: string;
  /** Filter by memory types */
  types?: MemoryType[];
  /** Filter by tags (OR logic) */
  tags?: string[];
  /** Created after this date */
  since?: Date;
  /** Created before this date */
  until?: Date;
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
  /** Include soft-deleted memories */
  includeArchived?: boolean;
  /** Maximum number of results (default: 20) */
  limit?: number;
  /** Recency impact on ranking (0-1, default: 0.3) */
  recencyWeight?: number;
}

/**
 * Query result with relevance scoring
 */
export interface QueryResult {
  /** The memory record */
  memory: Memory;
  /** Combined relevance score */
  score: number;
  /** FTS5 match score component */
  semanticScore: number;
  /** Time-based score component */
  recencyScore: number;
  /** Result position (1-indexed) */
  rank: number;
}

/**
 * Input for creating a new memory
 */
export interface CreateMemoryInput {
  type: MemoryType;
  content: string;
  tags?: string[];
  confidence?: number;
  source?: string;
  context?: Record<string, any>;
}

/**
 * Input for updating an existing memory
 */
export interface UpdateMemoryInput {
  content?: string;
  tags?: string[];
  confidence?: number;
  context?: Record<string, any>;
}

/**
 * Database row representation (internal)
 */
export interface MemoryRow {
  id: string;
  type: string;
  content: string;
  tags: string;
  confidence: number;
  source: string | null;
  context: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

/**
 * FTS5 search result row (internal)
 */
export interface FTSResultRow {
  id: string;
  type: string;
  content: string;
  tags: string;
  confidence: number;
  source: string | null;
  context: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  rank: number;
}
