/**
 * LLM-based memory extractor
 * 
 * Uses LLM to classify and extract structured memories from daily notes.
 */

import { randomUUID } from "node:crypto";
import type { ReturnType as ConfigType } from "../../config/io.js";
import { runEmbeddedPiAgent } from "../pi-embedded-runner/run.js";
import { cleanContent } from "./parser.js";
import type {
  DailyNote,
  ExtractionResult,
  LLMExtractionResponse,
  Memory,
  MemoryType,
} from "./types.js";

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction assistant. Your task is to analyze daily note content and extract structured, discrete memories.

For each memory you extract, classify it into ONE of these types:

- FACT: Objective, verifiable information about the world or system state
- DECISION: Explicit choices made, including rationale and context
- PREFERENCE: User or system preferences, patterns, and style guidelines
- OBSERVATION: Noted patterns, behaviors, or insights discovered during operation
- TASK: Action items, TODOs, or pending work
- CONTEXT: Background information, explanations, or situational awareness

For each memory, assign a confidence score (0.0 to 1.0):
- 0.9-1.0: High confidence (explicit, clear statements)
- 0.7-0.89: Good confidence (implied but clear from context)
- 0.5-0.69: Medium confidence (inferred, may need verification)
- 0.0-0.49: Low confidence (uncertain, conflicting information)

Extract entity mentions (names, places, systems, etc.) when relevant.

Return your response as JSON with this structure:
{
  "memories": [
    {
      "type": "FACT",
      "content": "Self-contained narrative fact",
      "confidence": 0.9,
      "entities": ["EntityName"]
    }
  ]
}

Guidelines:
- Extract 3-10 memories per note (only the most significant items)
- Each memory should be self-contained and make sense without surrounding context
- Preserve the narrative nature of the content
- Don't over-extract: focus on actionable facts, decisions, and preferences
- If the note has no significant memories, return an empty array`;

const EXTRACTION_USER_PROMPT = (content: string, date: string) => `Extract structured memories from this daily note from ${date}:

${content}

Return JSON with extracted memories.`;

/**
 * Extract memories from a daily note using LLM
 */
export async function extractMemoriesFromNote(
  note: DailyNote,
  config: ConfigType,
  agentId: string,
  options: {
    model?: string;
    provider?: string;
    verbose?: boolean;
  } = {},
): Promise<ExtractionResult> {
  const startTime = Date.now();
  const cleanedContent = cleanContent(note.content);
  
  if (cleanedContent.length === 0) {
    return {
      memories: [],
      processingTime: 0,
      model: options.model ?? "unknown",
    };
  }
  
  const sessionId = `memento-extract-${randomUUID()}`;
  const userPrompt = EXTRACTION_USER_PROMPT(cleanedContent, note.date);
  
  try {
    const result = await runEmbeddedPiAgent({
      sessionId,
      agentId,
      config,
      model: options.model ?? config?.agents?.defaults?.model?.name,
      provider: options.provider ?? config?.agents?.defaults?.model?.provider,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      tools: [],
      temperature: 0.3, // Lower temperature for more consistent extraction
      thinkLevel: "off",
    });
    
    if (!result.response) {
      throw new Error("No response from LLM");
    }
    
    const responseText = result.response.text?.trim() ?? "";
    const processingTime = Date.now() - startTime;
    
    // Try to extract JSON from response
    let extracted: LLMExtractionResponse;
    try {
      // Try parsing as direct JSON
      extracted = JSON.parse(responseText);
    } catch {
      // Try extracting JSON from markdown code block
      const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[1]);
      } else {
        // Try parsing the whole response (in case it's JSON without markdown)
        throw new Error("Could not extract JSON from LLM response");
      }
    }
    
    if (!extracted.memories || !Array.isArray(extracted.memories)) {
      throw new Error("Invalid extraction response: missing memories array");
    }
    
    // Convert to Memory objects
    const memories: Memory[] = extracted.memories
      .filter((m) => m.content?.trim().length > 0)
      .map((m) => ({
        id: randomUUID(),
        type: validateMemoryType(m.type),
        content: m.content.trim(),
        confidence: clampConfidence(m.confidence),
        sourceFile: note.filepath,
        sourceLine: m.line,
        extractedAt: new Date().toISOString(),
        createdAt: note.date,
        entities: m.entities?.filter((e) => e?.trim().length > 0),
      }));
    
    return {
      memories,
      processingTime,
      model: result.model ?? options.model ?? "unknown",
      tokensUsed: result.usage?.total,
    };
  } catch (err) {
    if (options.verbose) {
      console.error(`Memory extraction failed for ${note.filepath}:`, err);
    }
    throw new Error(`Memory extraction failed: ${(err as Error).message}`);
  }
}

/**
 * Validate and normalize memory type
 */
function validateMemoryType(type: string): MemoryType {
  const normalized = type?.toUpperCase().trim();
  const validTypes: MemoryType[] = [
    "FACT",
    "DECISION",
    "PREFERENCE",
    "OBSERVATION",
    "TASK",
    "CONTEXT",
  ];
  
  if (validTypes.includes(normalized as MemoryType)) {
    return normalized as MemoryType;
  }
  
  // Default to OBSERVATION for unrecognized types
  return "OBSERVATION";
}

/**
 * Clamp confidence score to valid range
 */
function clampConfidence(confidence: number): number {
  const val = Number(confidence);
  if (Number.isNaN(val)) {
    return 0.5; // Default to medium confidence
  }
  return Math.max(0, Math.min(1, val));
}

/**
 * Batch extract memories from multiple notes
 */
export async function extractMemoriesFromNotes(
  notes: DailyNote[],
  config: ConfigType,
  agentId: string,
  options: {
    model?: string;
    provider?: string;
    verbose?: boolean;
    onProgress?: (current: number, total: number, filepath: string) => void;
  } = {},
): Promise<Map<string, ExtractionResult>> {
  const results = new Map<string, ExtractionResult>();
  
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (options.onProgress) {
      options.onProgress(i + 1, notes.length, note.filepath);
    }
    
    try {
      const result = await extractMemoriesFromNote(note, config, agentId, options);
      results.set(note.filepath, result);
    } catch (err) {
      // Store error as empty result
      results.set(note.filepath, {
        memories: [],
        processingTime: 0,
        model: options.model ?? "unknown",
      });
      
      if (options.verbose) {
        console.error(`Failed to extract from ${note.filepath}:`, err);
      }
    }
  }
  
  return results;
}
