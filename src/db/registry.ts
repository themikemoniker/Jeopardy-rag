import { getDb } from './schema';

export interface CategoryRegistryRow {
  category: string;
  question_count: number;
  min_date: string | null;
  max_date: string | null;
  min_value: number | null;
  max_value: number | null;
  rounds: string | null;
  summary: string | null;
  summary_generated_at: string | null;
  updated_at: string | null;
}

export function getTopCategories(limit: number): CategoryRegistryRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT category, question_count, summary, min_value, max_value, rounds, min_date, max_date, summary_generated_at, updated_at
     FROM category_registry
     ORDER BY question_count DESC
     LIMIT ?`
  ).all(limit) as CategoryRegistryRow[];
}

export function getUnenrichedCategories(limit: number): CategoryRegistryRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT category, question_count, min_value, max_value, rounds, min_date, max_date, summary, summary_generated_at, updated_at
     FROM category_registry
     WHERE summary IS NULL
     LIMIT ?`
  ).all(limit) as CategoryRegistryRow[];
}

export function updateCategorySummary(category: string, summary: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE category_registry SET summary = ?, summary_generated_at = datetime('now'), updated_at = datetime('now') WHERE category = ?`
  ).run(summary, category);
}

export function categoryExists(category: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT 1 FROM category_registry WHERE category = ?`).get(category);
  return !!row;
}

export function getRegistryPaginated(limit: number, offset: number, search?: string): CategoryRegistryRow[] {
  const db = getDb();
  if (search) {
    return db.prepare(
      `SELECT * FROM category_registry WHERE category LIKE ? ORDER BY question_count DESC LIMIT ? OFFSET ?`
    ).all(`%${search}%`, limit, offset) as CategoryRegistryRow[];
  }
  return db.prepare(
    `SELECT * FROM category_registry ORDER BY question_count DESC LIMIT ? OFFSET ?`
  ).all(limit, offset) as CategoryRegistryRow[];
}

export function getSampleQuestions(category: string, limit: number): { question: string; answer: string }[] {
  const db = getDb();
  return db.prepare(
    `SELECT question, answer FROM questions WHERE category = ? LIMIT ?`
  ).all(category, limit) as { question: string; answer: string }[];
}
