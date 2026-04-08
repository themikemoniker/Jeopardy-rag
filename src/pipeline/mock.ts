import { getTopCategories } from '../db/registry';

export function mockRoute(_userQuestion: string): string[] {
  // Return the top 2 categories by question_count from the registry
  const cats = getTopCategories(2);
  return cats.map(c => c.category);
}

export function mockFilter(userQuestion: string): string | null {
  const q = userQuestion.toLowerCase();
  if (q.includes('hard') || q.includes('difficult')) return 'value >= 800';
  if (q.includes('easy') || q.includes('cheap')) return 'value <= 400';
  if (q.includes('final jeopardy')) return "round = 'Final Jeopardy!'";
  if (q.includes('double')) return "round = 'Double Jeopardy!'";
  return null;
}

export function mockAnswer(_userQuestion: string, context: string): string {
  return `[MOCK MODE — no API key set]\n\nHere are some matching clues from the database:\n\n${context.split('\n\n').slice(0, 3).join('\n\n')}\n\nAdd your ANTHROPIC_API_KEY to .env to get real AI-generated answers.`;
}
