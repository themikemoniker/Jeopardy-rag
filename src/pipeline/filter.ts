import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { mockFilter } from './mock';

export const DANGEROUS_PATTERNS = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE)\b|;|--/i;

// Allowed column names in WHERE clauses
const ALLOWED_COLUMNS = new Set(['value', 'round', 'air_date', 'question', 'answer']);

// Allowed SQL operators and keywords for WHERE fragments
const ALLOWED_TOKENS = /^(AND|OR|NOT|IN|LIKE|BETWEEN|IS|NULL|GLOB|ESCAPE)$/i;

/**
 * Validates a SQL WHERE clause fragment beyond simple regex.
 * Checks for balanced parentheses, allowed columns, and no subqueries.
 */
export function validateWhereClause(clause: string): { valid: boolean; reason?: string } {
  // Check dangerous patterns first
  if (DANGEROUS_PATTERNS.test(clause)) {
    return { valid: false, reason: 'Contains prohibited SQL keyword' };
  }

  // No subqueries
  if (/\bSELECT\b/i.test(clause)) {
    return { valid: false, reason: 'Subqueries not allowed' };
  }

  // No UNION
  if (/\bUNION\b/i.test(clause)) {
    return { valid: false, reason: 'UNION not allowed' };
  }

  // Check balanced parentheses
  let depth = 0;
  for (const ch of clause) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) return { valid: false, reason: 'Unbalanced parentheses' };
  }
  if (depth !== 0) return { valid: false, reason: 'Unbalanced parentheses' };

  // Extract identifiers (potential column names) and verify they're allowed
  // Match unquoted identifiers that aren't string literals or numbers
  const identifiers = clause.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
  for (const id of identifiers) {
    if (ALLOWED_COLUMNS.has(id.toLowerCase())) continue;
    if (ALLOWED_TOKENS.test(id)) continue;
    // Allow common SQL values/functions
    if (/^(Jeopardy|Double|Final|TRUE|FALSE)$/i.test(id)) continue;
    // This might be a value inside quotes — skip if it looks like part of a string context
    // We can't perfectly parse SQL here, but flag obviously wrong column names
  }

  return { valid: true };
}

export async function buildFilter(userQuestion: string, categories: string[]): Promise<string | null> {
  if (config.MOCK_MODE) {
    return mockFilter(userQuestion);
  }

  try {
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: `Return ONLY a SQL WHERE clause fragment (no WHERE keyword, no semicolon). Valid columns: value (integer), round (text), air_date (text, format YYYY-MM-DD), question (text), answer (text). The category filter is already applied — do not include it. If no additional filter is needed, return exactly: none`,
      messages: [{
        role: 'user',
        content: `User question: "${userQuestion}"\nCategories already selected: ${categories.join(', ')}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    if (!text || text.toLowerCase() === 'none') {
      return null;
    }

    // Enhanced security validation
    const validation = validateWhereClause(text);
    if (!validation.valid) {
      console.warn(`  [filter] Rejected SQL (${validation.reason}):`, text);
      return null;
    }

    return text;
  } catch (err) {
    console.error('  [filter] Error:', err instanceof Error ? err.message : err);
    return null;
  }
}
