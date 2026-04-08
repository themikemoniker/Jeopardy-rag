import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getUnenrichedCategories, getSampleQuestions, updateCategorySummary } from '../db/registry';
import { getDb } from '../db/schema';

export async function enrichCategories(limit: number = 50): Promise<number> {
  const categories = getUnenrichedCategories(limit);

  if (categories.length === 0) {
    console.log('  [enrich] No unenriched categories found.');
    return 0;
  }

  console.log(`  [enrich] Enriching ${categories.length} categories...`);

  // Build the prompt with sample questions for each category
  const categoryData: { name: string; samples: string[] }[] = [];
  for (const cat of categories) {
    const samples = getSampleQuestions(cat.category, 5);
    categoryData.push({
      name: cat.category,
      samples: samples.map(s => `  Clue: ${s.answer} → Response: ${s.question}`),
    });
  }

  const prompt = categoryData.map(c =>
    `Category: ${c.name}\nSample clues:\n${c.samples.join('\n')}`
  ).join('\n\n');

  if (config.MOCK_MODE) {
    // In mock mode, generate simple summaries from the category name
    for (const cat of categoryData) {
      const summary = `Questions about ${cat.name.toLowerCase()}`;
      updateCategorySummary(cat.name, summary);
    }
    console.log(`  [enrich] Mock-enriched ${categoryData.length} categories.`);
    return categoryData.length;
  }

  try {
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 4096,
      system: `Return ONLY a valid JSON object. No explanation, no markdown, no text before or after the JSON. Map each category name to a one-sentence description for search routing. Example output: {"SCIENCE": "Questions about scientific discoveries and theories", "HISTORY": "Questions about historical events and figures"}`,
      messages: [{ role: 'user', content: `Write a one-sentence description for each category below. Return ONLY valid JSON.\n\n${prompt}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract JSON from response — handle markdown fences, preamble text, etc.
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    // If Haiku added text before the JSON, extract the JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('  [enrich] Could not find JSON in response:', jsonStr.slice(0, 100));
      return 0;
    }
    jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr) as Record<string, string>;

    let enriched = 0;
    for (const [category, summary] of Object.entries(parsed)) {
      if (typeof summary === 'string' && summary.length > 0) {
        updateCategorySummary(category, summary);
        enriched++;
      }
    }

    console.log(`  [enrich] Enriched ${enriched} categories via API.`);
    return enriched;
  } catch (err) {
    console.error('  [enrich] Error during enrichment:', err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * Enrich all unenriched categories in batches, with progress reporting.
 */
export async function enrichAll(batchSize: number = 50): Promise<{ totalEnriched: number; batches: number; durationMs: number }> {
  const startTime = Date.now();
  let totalEnriched = 0;
  let batches = 0;

  const db = getDb();
  const totalPending = (db.prepare(
    `SELECT COUNT(*) as cnt FROM category_registry WHERE summary IS NULL`
  ).get() as { cnt: number }).cnt;

  if (totalPending === 0) {
    console.log('  [enrich] All categories are already enriched.');
    return { totalEnriched: 0, batches: 0, durationMs: 0 };
  }

  console.log(`  [enrich] ${totalPending} categories pending enrichment.`);

  while (true) {
    const remaining = (db.prepare(
      `SELECT COUNT(*) as cnt FROM category_registry WHERE summary IS NULL`
    ).get() as { cnt: number }).cnt;

    if (remaining === 0) break;

    batches++;
    const enriched = await enrichCategories(batchSize);
    totalEnriched += enriched;

    const pct = Math.round(((totalPending - remaining + enriched) / totalPending) * 100);
    console.log(`  [enrich] Progress: ${pct}% (${totalEnriched}/${totalPending} enriched, batch ${batches})`);

    if (enriched === 0) break; // Safety: stop if a batch fails
  }

  const durationMs = Date.now() - startTime;
  console.log(`  [enrich] Complete: ${totalEnriched} categories enriched in ${batches} batches (${durationMs}ms)`);
  return { totalEnriched, batches, durationMs };
}

export function hasUnenrichedCategories(): boolean {
  const cats = getUnenrichedCategories(1);
  return cats.length > 0;
}

export function getUnenrichedCount(): number {
  const db = getDb();
  return (db.prepare(
    `SELECT COUNT(*) as cnt FROM category_registry WHERE summary IS NULL`
  ).get() as { cnt: number }).cnt;
}
