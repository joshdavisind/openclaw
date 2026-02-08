/**
 * Memento: Structured memory system with versioning and conflict detection
 */

/**
 * Relationship between memories
 */
export interface MemoryRelationship {
  type: string; // e.g., "supports", "conflicts", "references"
  targetId: string;
}

/**
 * Core memory entry
 */
export interface Memory {
  /** Unique identifier (UUID) */
  id: string;

  /** Memory category (e.g., "fact", "preference", "decision", "todo") */
  type: string;

  /** The actual information stored */
  content: string;

  /** Vector representation for semantic search (optional) */
  embedding?: Float32Array;

  // Source tracking
  /** Agent that created this memory */
  agentId: string;

  /** Session context where memory was created */
  sessionKey?: string;

  /** Creation timestamp (Unix ms) */
  timestamp: number;

  // Supersession
  /** IDs of memories this replaces */
  supersedes: string[];

  /** ID of memory that replaced this one (if superseded) */
  supersededBy?: string;

  // Relationships
  /** Links to other memories */
  relatedTo?: MemoryRelationship[];

  // Metadata
  /** Extensible key-value pairs */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for creating a new memory
 */
export interface CreateMemoryParams {
  type: string;
  content: string;
  agentId: string;
  sessionKey?: string;
  supersedes?: string[];
  relatedTo?: MemoryRelationship[];
  metadata?: Record<string, unknown>;
}

/**
 * Search parameters
 */
export interface SearchMemoryParams {
  /** Text or semantic search query */
  query?: string;

  /** Filter by memory type(s) */
  type?: string | string[];

  /** Similarity threshold (0-1) */
  minScore?: number;

  /** Maximum results to return */
  maxResults?: number;

  /** Include superseded memories in results */
  includeSuperseded?: boolean;

  /** Filter by agent ID */
  agentId?: string;

  /** Filter by timestamp range */
  timestampRange?: {
    start?: number;
    end?: number;
  };
}

/**
 * Conflict detection result
 */
export interface ConflictResult {
  memory: Memory;
  similarity: number;
}

/**
 * Write API for memories
 */
export interface MementoWriter {
  /**
   * Add a new memory
   */
  add(params: CreateMemoryParams): Promise<Memory>;

  /**
   * Add a memory that supersedes existing ones
   */
  addSuperseding(
    params: Omit<CreateMemoryParams, "supersedes">,
    supersedes: string[],
  ): Promise<Memory>;

  /**
   * Convenience method to supersede a single memory
   */
  supersede(oldId: string, newParams: Omit<CreateMemoryParams, "supersedes">): Promise<Memory>;

  /**
   * Mark memories as related
   */
  relate(fromId: string, toId: string, type: string): Promise<void>;
}

/**
 * Read API for memories
 */
export interface MementoReader {
  /**
   * Get memory by ID
   */
  get(id: string): Promise<Memory | null>;

  /**
   * Search memories
   */
  search(params: SearchMemoryParams): Promise<Memory[]>;

  /**
   * Check for conflicts with proposed memory
   */
  checkConflicts(params: { type: string; content: string }): Promise<ConflictResult[]>;

  /**
   * Get supersession chain for a memory
   */
  getSupersessionChain(id: string): Promise<Memory[]>;
}

/**
 * Combined memento interface
 */
export interface Memento extends MementoWriter, MementoReader {
  /**
   * Close database connection
   */
  close(): Promise<void>;
}
