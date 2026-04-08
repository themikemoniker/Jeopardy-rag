import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Creates a temporary in-memory-like SQLite DB by pointing to a temp file,
 * then sets DB_PATH so the app uses it. Returns cleanup function.
 */
export function setupTestDb(): { dbPath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeopardy-test-'));
  const dbPath = path.join(tmpDir, 'test.db');

  // Set env before any module loads config
  process.env.DB_PATH = dbPath;
  process.env.MOCK_MODE = 'true';
  process.env.LOG_LEVEL = 'silent';

  return {
    dbPath,
    cleanup: () => {
      // Close DB if schema module was loaded
      try {
        const { closeDb } = require('../src/db/schema');
        closeDb();
      } catch {}
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

/**
 * Insert test questions directly into the DB (bypasses ingest pipeline).
 */
export function insertTestQuestions(db: Database.Database, questions: {
  category: string;
  question: string;
  answer: string;
  value?: number | null;
  round?: string | null;
  air_date?: string | null;
  show_number?: number | null;
}[]): void {
  const stmt = db.prepare(`
    INSERT INTO questions (show_number, air_date, round, category, value, question, answer)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const txn = db.transaction(() => {
    for (const q of questions) {
      stmt.run(
        q.show_number ?? null,
        q.air_date ?? null,
        q.round ?? null,
        q.category,
        q.value ?? null,
        q.question,
        q.answer
      );
    }
  });
  txn();
}

/**
 * Create a temp TSV file with given content. Returns the file path.
 */
export function writeTempTsv(content: string): { filePath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeopardy-tsv-'));
  const filePath = path.join(tmpDir, 'test.tsv');
  fs.writeFileSync(filePath, content, 'utf-8');
  return {
    filePath,
    cleanup: () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    },
  };
}

/**
 * Create a temp JSON file with given data. Returns the file path.
 */
export function writeTempJson(data: unknown[]): { filePath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeopardy-json-'));
  const filePath = path.join(tmpDir, 'test.json');
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  return {
    filePath,
    cleanup: () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    },
  };
}
