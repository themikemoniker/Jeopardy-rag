import { getTopCategories, getRegistryPaginated } from '../db/registry';

export function mockRoute(userQuestion: string): string[] {
  const q = userQuestion.toLowerCase();

  // Extract keywords from the question (ignore common words)
  const stopWords = new Set(['give', 'me', 'show', 'some', 'the', 'a', 'an', 'about', 'from',
    'for', 'with', 'what', 'are', 'is', 'do', 'does', 'can', 'how', 'many', 'much',
    'questions', 'clues', 'quiz', 'tell', 'want', 'find', 'get', 'hard', 'easy',
    'difficult', 'cheap', 'worth', 'dollars', 'dollar', 'at', 'least', 'three',
    'two', 'one', 'five', 'ten', 'any', 'of', 'in', 'on', 'to', 'and', 'or']);
  const words = q.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));

  if (words.length > 0) {
    // Try to match keywords against category names and summaries
    const matches: { category: string; score: number }[] = [];

    // Search categories by keyword
    for (const word of words) {
      const found = getRegistryPaginated(20, 0, word.toUpperCase());
      for (const cat of found) {
        const existing = matches.find(m => m.category === cat.category);
        let score = cat.question_count;
        // Boost if the category name contains the keyword directly
        if (cat.category.toLowerCase().includes(word)) score *= 2;
        // Boost if the summary contains the keyword
        if (cat.summary && cat.summary.toLowerCase().includes(word)) score *= 1.5;
        if (existing) {
          existing.score += score;
        } else {
          matches.push({ category: cat.category, score });
        }
      }
    }

    if (matches.length > 0) {
      matches.sort((a, b) => b.score - a.score);
      return matches.slice(0, 3).map(m => m.category);
    }
  }

  // Fallback: return the top 2 categories by question_count
  const cats = getTopCategories(2);
  return cats.map(c => c.category);
}

export function mockFilter(userQuestion: string): string | null {
  const q = userQuestion.toLowerCase();
  if (q.includes('hard') || q.includes('difficult')) return 'value >= 800';
  if (q.includes('easy') || q.includes('cheap')) return 'value <= 400';
  if (q.includes('final jeopardy')) return "round = 'Final Jeopardy!'";
  if (q.includes('double')) return "round = 'Double Jeopardy!'";

  // Try to extract dollar amounts
  const dollarMatch = q.match(/(?:worth|at least|over|above|more than)\s*\$?(\d[\d,]*)/);
  if (dollarMatch) {
    const val = parseInt(dollarMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(val)) return `value >= ${val}`;
  }

  // Date filtering
  const yearMatch = q.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (yearMatch) {
    return `air_date >= '${yearMatch[1]}-01-01' AND air_date <= '${yearMatch[1]}-12-31'`;
  }

  return null;
}

export function mockAnswer(_userQuestion: string, context: string): string {
  return `[MOCK MODE — no API key set]\n\nHere are some matching clues from the database:\n\n${context.split('\n\n').slice(0, 3).join('\n\n')}\n\nAdd your ANTHROPIC_API_KEY to .env to get real AI-generated answers.`;
}
