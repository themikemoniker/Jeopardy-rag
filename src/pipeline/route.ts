import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getTopCategories, categoryExists } from '../db/registry';
import { mockRoute } from './mock';

export async function routeQuery(userQuestion: string): Promise<string[]> {
  if (config.MOCK_MODE) {
    return mockRoute(userQuestion);
  }

  const topN = config.REGISTRY_TOP_N;
  const categories = getTopCategories(topN);

  if (categories.length === 0) {
    return [];
  }

  const index = categories.map(c => {
    const valRange = c.min_value != null && c.max_value != null
      ? `$${c.min_value}-$${c.max_value}`
      : 'N/A';
    const desc = c.summary || c.category;
    return `- ${c.category} (${c.question_count} questions, ${valRange}): ${desc}`;
  }).join('\n');

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const systemPrompt = attempt === 0
        ? 'You are a routing assistant for a Jeopardy database. Given an index of categories, return ONLY a JSON array of the 1-3 most relevant category names, exactly as they appear in the index. Example: ["SCIENCE", "ASTRONOMY"]. Return nothing else, no explanation, no markdown.'
        : 'You are a routing assistant. Return ONLY a valid JSON array of 1-3 category names from the index below. The names must match exactly. No markdown, no explanation, just the JSON array. Example: ["CATEGORY1"]';

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20241022',
        max_tokens: 150,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Index:\n${index}\n\nUser question: ${userQuestion}`,
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      const parsed = JSON.parse(text) as string[];

      if (!Array.isArray(parsed)) throw new Error('Response is not an array');

      // Validate categories exist
      const valid = parsed.filter(c => categoryExists(c));
      if (valid.length > 0) return valid;

      // If none valid but we got results, try again
      if (attempt === 0) continue;
    } catch (err) {
      if (attempt === 0) continue;
      console.error('  [route] Error:', err instanceof Error ? err.message : err);
    }
  }

  // Fallback: top 3 categories by question_count
  console.warn('  [route] Falling back to top 3 categories by question count');
  return categories.slice(0, 3).map(c => c.category);
}

export function getRouteTokens(response: Anthropic.Message): number {
  return (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
}
