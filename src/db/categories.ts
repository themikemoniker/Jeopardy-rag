import { getDb } from './schema';

export interface CategorySearchResult {
  category: string;
  question_count: number;
  min_date: string | null;
  max_date: string | null;
  min_value: number | null;
  max_value: number | null;
  rounds: string | null;
  summary: string | null;
}

export function searchCategories(
  query: string,
  limit: number = 50,
  offset: number = 0
): { results: CategorySearchResult[]; total: number } {
  const db = getDb();
  const pattern = `%${query}%`;

  const total = db.prepare(
    `SELECT COUNT(*) as cnt FROM category_registry
     WHERE category LIKE ? OR summary LIKE ?`
  ).get(pattern, pattern) as { cnt: number };

  const results = db.prepare(
    `SELECT category, question_count, min_date, max_date, min_value, max_value, rounds, summary
     FROM category_registry
     WHERE category LIKE ? OR summary LIKE ?
     ORDER BY question_count DESC
     LIMIT ? OFFSET ?`
  ).all(pattern, pattern, limit, offset) as CategorySearchResult[];

  return { results, total: total.cnt };
}

export function getCategoryDetail(category: string): {
  info: CategorySearchResult | null;
  sampleClues: { question: string; answer: string; value: number | null; round: string | null; air_date: string | null }[];
} {
  const db = getDb();

  const info = db.prepare(
    `SELECT category, question_count, min_date, max_date, min_value, max_value, rounds, summary
     FROM category_registry WHERE category = ?`
  ).get(category) as CategorySearchResult | undefined;

  if (!info) return { info: null, sampleClues: [] };

  const sampleClues = db.prepare(
    `SELECT question, answer, value, round, air_date FROM questions
     WHERE category = ? ORDER BY air_date DESC LIMIT 20`
  ).all(category) as { question: string; answer: string; value: number | null; round: string | null; air_date: string | null }[];

  return { info, sampleClues };
}
