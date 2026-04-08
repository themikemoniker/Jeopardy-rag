import { getDb } from './schema';

export interface QuestionRow {
  category: string;
  value: number | null;
  round: string | null;
  question: string;
  answer: string;
  air_date: string | null;
}

export function fetchQuestions(
  categories: string[],
  whereClause: string | null,
  limit: number = 60
): string {
  const db = getDb();

  const placeholders = categories.map(() => '?').join(', ');
  let sql = `SELECT category, value, round, question, answer, air_date
             FROM questions
             WHERE category IN (${placeholders})`;

  const params: unknown[] = [...categories];

  if (whereClause) {
    sql += ` AND (${whereClause})`;
  }

  sql += ` ORDER BY value DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as QuestionRow[];

  return rows.map(r => {
    const valStr = r.value != null ? `$${r.value}` : 'N/A';
    return `[${r.category} / ${valStr} / ${r.round || 'N/A'} / ${r.air_date || 'N/A'}]\nClue: ${r.answer}\nResponse: ${r.question}`;
  }).join('\n\n');
}

export function getQuestionCount(categories: string[], whereClause: string | null): number {
  const db = getDb();
  const placeholders = categories.map(() => '?').join(', ');
  let sql = `SELECT COUNT(*) as cnt FROM questions WHERE category IN (${placeholders})`;
  const params: unknown[] = [...categories];
  if (whereClause) {
    sql += ` AND (${whereClause})`;
  }
  const row = db.prepare(sql).get(...params) as { cnt: number };
  return row.cnt;
}

export function getStats(): {
  totalQuestions: number;
  totalCategories: number;
  categoriesEnriched: number;
  categoriesPendingEnrichment: number;
  dateRange: { min: string | null; max: string | null };
} {
  const db = getDb();
  const q = db.prepare(`SELECT COUNT(*) as cnt FROM questions`).get() as { cnt: number };
  const c = db.prepare(`SELECT COUNT(*) as cnt FROM category_registry`).get() as { cnt: number };
  const e = db.prepare(`SELECT COUNT(*) as cnt FROM category_registry WHERE summary IS NOT NULL`).get() as { cnt: number };
  const d = db.prepare(`SELECT MIN(air_date) as min_date, MAX(air_date) as max_date FROM questions`).get() as { min_date: string | null; max_date: string | null };

  return {
    totalQuestions: q.cnt,
    totalCategories: c.cnt,
    categoriesEnriched: e.cnt,
    categoriesPendingEnrichment: c.cnt - e.cnt,
    dateRange: { min: d.min_date, max: d.max_date },
  };
}
