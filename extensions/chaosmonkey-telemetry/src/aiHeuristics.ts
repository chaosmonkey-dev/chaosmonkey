/**
 * ============================================================================
 * AI HEURISTICS ENGINE - SIDE-CAR MODULE
 * ============================================================================
 * 
 * This module analyzes text document changes to detect patterns that suggest
 * AI-assisted code generation or large paste operations.
 * 
 * Heuristics:
 * - Large block insertions (>15 chars with newlines) → likely AI/paste
 * - Rapid multi-line insertions → likely AI generation
 * 
 * Safety guarantees:
 * - Pure function, no side effects
 * - Does not throw exceptions (returns safe defaults)
 * - Does not modify any document or extension state
 * 
 * ============================================================================
 */

import * as vscode from 'vscode';

/**
 * Result of AI heuristic analysis on a text change event
 */
export interface AIHeuristicResult {
  /** Whether the change pattern is suspicious (likely AI/paste) */
  isSuspicious: boolean;
  /** Human-readable reason for the detection */
  reason: string;
  /** Total characters inserted across all changes */
  charCount: number;
  /** Total lines inserted across all changes */
  lineCount: number;
}

/**
 * Thresholds for AI/paste detection
 */
const THRESHOLDS = {
  /** Minimum characters to consider a change "large" */
  MIN_CHARS_FOR_BLOCK: 15,
  /** Minimum lines to consider a change a "block insert" */
  MIN_LINES_FOR_BLOCK: 1,
};

/**
 * Analyze a text document change event for AI-like behavior
 * 
 * Current heuristics (MVP):
 * 1. Large Paste/Block: >15 chars AND contains at least 1 newline
 * 
 * Future heuristics (not implemented yet):
 * - Rapid sequential inserts within short time window
 * - Code structure patterns (function definitions, imports)
 * - Typing speed analysis (chars per second)
 * 
 * @param event The VS Code text document change event
 * @returns Analysis result with detection status and metrics
 */
export function analyzeEvent(event: vscode.TextDocumentChangeEvent): AIHeuristicResult {
  // Default: not suspicious
  const defaultResult: AIHeuristicResult = {
    isSuspicious: false,
    reason: '',
    charCount: 0,
    lineCount: 0,
  };

  try {
    // No changes = nothing to analyze
    if (!event.contentChanges || event.contentChanges.length === 0) {
      return defaultResult;
    }

    // Aggregate metrics across all changes in this event
    let totalCharCount = 0;
    let totalLineCount = 0;
    let hasSuspiciousChange = false;
    let suspiciousReason = '';

    for (const change of event.contentChanges) {
      const insertedText = change.text;
      
      // Skip empty changes (deletions only)
      if (!insertedText || insertedText.length === 0) {
        continue;
      }

      const charCount = insertedText.length;
      const newlineCount = (insertedText.match(/\n/g) || []).length;

      totalCharCount += charCount;
      totalLineCount += newlineCount;

      // Heuristic 1: Large block with newlines
      // This catches:
      // - AI code generation (usually multi-line)
      // - Copy-paste of code blocks
      // - Snippet expansions
      if (charCount > THRESHOLDS.MIN_CHARS_FOR_BLOCK && newlineCount >= THRESHOLDS.MIN_LINES_FOR_BLOCK) {
        hasSuspiciousChange = true;
        
        // Determine reason based on size
        if (newlineCount >= 10) {
          suspiciousReason = 'Large Block Insert';
        } else if (newlineCount >= 3) {
          suspiciousReason = 'Multi-line Insert';
        } else {
          suspiciousReason = 'Block Insert';
        }
      }
    }

    return {
      isSuspicious: hasSuspiciousChange,
      reason: suspiciousReason,
      charCount: totalCharCount,
      lineCount: totalLineCount,
    };

  } catch (err) {
    // Never throw - return safe default
    console.error('[ChaosMonkey][AIHeuristics] Analysis error:', err);
    return defaultResult;
  }
}

/**
 * Check if a specific text content looks like generated code
 * 
 * This is a utility function for more detailed analysis.
 * Not currently used in the main flow but available for future enhancements.
 * 
 * @param text The text content to analyze
 * @returns Object with analysis flags
 */
export function analyzeTextContent(text: string): {
  hasCodePatterns: boolean;
  hasComments: boolean;
  hasFunctionDef: boolean;
  hasImports: boolean;
} {
  return {
    hasCodePatterns: /[{};()=]/.test(text),
    hasComments: /\/\/|\/\*|\*\/|#/.test(text),
    hasFunctionDef: /function\s+\w+|const\s+\w+\s*=\s*\(|=>\s*{|def\s+\w+|class\s+\w+/.test(text),
    hasImports: /import\s+|require\(|from\s+['"]/.test(text),
  };
}
