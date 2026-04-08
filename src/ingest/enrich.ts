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
      system: `You are a category description writer for a Jeopardy database. For each category provided, write a one-sentence description suitable for search routing. Return ONLY a JSON object mapping category names to descriptions. Example: {"SCIENCE": "Questions about scientific discoveries, theories, and notable scientists", "U.S. PRESIDENTS": "Questions about American presidents, their terms, and policies"}. Return nothing else, no markdown fences.`,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON - try to extract from possible markdown fences
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

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
