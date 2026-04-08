import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { mockFilter } from './mock';

export const DANGEROUS_PATTERNS = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE)\b|;|--/i;

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

    // Security validation
    if (DANGEROUS_PATTERNS.test(text)) {
      console.warn('  [filter] Rejected dangerous SQL:', text);
      return null;
    }

    return text;
  } catch (err) {
    console.error('  [filter] Error:', err instanceof Error ? err.message : err);
    return null;
  }
}
