/**
 * Memento: Structured memory consolidation system
 * 
 * Types and interfaces for extracting structured memories from daily notes.
 */

/**
 * Memory types classify extracted content
 */
export type MemoryType =
  | "FACT"        // Objective, verifiable information
  | "DECISION"    // Explicit choices with rationale
  | "PREFERENCE"  // User/system preferences and patterns
  | "OBSERVATION" // Noted patterns and insights
  | "TASK"        // Action items and TODOs
  | "CONTEXT";    // Background information

/**
 * Confidence score range: 0.0 (low) to 1.0 (high)
 */
export type ConfidenceScore = number;

/**
 * A structured memory extracted from daily notes
 */
export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  confidence: ConfidenceScore;
  sourceFile: string;
  sourceLine?: number;
  extractedAt: string; // ISO timestamp
  createdAt: string;   // Date from daily note (YYYY-MM-DD)
  entities?: string[]; // Entity mentions (e.g., ["Peter", "gateway"])
  metadata?: Record<string, unknown>;
}

/**
 * Result of LLM extraction from daily note
 */
export interface ExtractionResult {
  memories: Memory[];
  processingTime: number;
  model: string;
  tokensUsed?: number;
}

/**
 * State tracking for consolidated files
 */
export interface ProcessedFileState {
  path: string;
  lastModified: string; // ISO timestamp
  lastProcessed: string; // ISO timestamp
  memoryCount: number;
  contentHash?: string; // For duplicate detection
}

/**
 * Overall consolidation state
 */
export interface ConsolidationState {
  lastConsolidation: string; // ISO timestamp
  processedFiles: ProcessedFileState[];
}

/**
 * Options for consolidation
 */
export interface ConsolidateOptions {
  date?: string;         // Specific date (YYYY-MM-DD)
  pending?: boolean;     // Process all unprocessed files
  force?: boolean;       // Ignore state, re-process all
  from?: string;         // Date range start (YYYY-MM-DD)
  to?: string;           // Date range end (YYYY-MM-DD)
  agentId: string;
  verbose?: boolean;
}

/**
 * Consolidation statistics
 */
export interface ConsolidationStats {
  filesProcessed: number;
  memoriesExtracted: number;
  byType: Record<MemoryType, number>;
  byConfidence: {
    high: number;    // 0.9-1.0
    good: number;    // 0.7-0.89
    medium: number;  // 0.5-0.69
    low: number;     // 0.0-0.49
  };
  processingTime: number;
}

/**
 * Status information for CLI
 */
export interface MementoStatus {
  agentId: string;
  lastConsolidation?: string;
  totalMemories: number;
  memoriesByType: Record<MemoryType, number>;
  memoriesByConfidence: {
    high: number;
    good: number;
    medium: number;
    low: number;
  };
  pendingFiles: string[];
  storageLocation: string;
  storageSize: number;
}

/**
 * LLM prompt response for memory extraction
 */
export interface LLMExtractionResponse {
  memories: Array<{
    type: MemoryType;
    content: string;
    confidence: ConfidenceScore;
    line?: number;
    entities?: string[];
  }>;
}
