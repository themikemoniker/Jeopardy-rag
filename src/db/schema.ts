import Database from 'better-sqlite3';
import path from 'path';
import { config } from '../config';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.resolve(config.DB_PATH);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      show_number  INTEGER,
      air_date     TEXT,
      round        TEXT,
      category     TEXT NOT NULL,
      value        INTEGER,
      question     TEXT NOT NULL,
      answer       TEXT NOT NULL,
      notes        TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
    CREATE INDEX IF NOT EXISTS idx_questions_value    ON questions(value);
    CREATE INDEX IF NOT EXISTS idx_questions_air_date ON questions(air_date);
    CREATE INDEX IF NOT EXISTS idx_questions_round    ON questions(round);

    CREATE TABLE IF NOT EXISTS category_registry (
      category       TEXT PRIMARY KEY,
      question_count INTEGER NOT NULL DEFAULT 0,
      min_date       TEXT,
      max_date       TEXT,
      min_value      INTEGER,
      max_value      INTEGER,
      rounds         TEXT,
      summary        TEXT,
      summary_generated_at TEXT,
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ingest_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      filename     TEXT,
      rows_added   INTEGER,
      ingested_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  // Create trigger for category_registry upsert on question insert.
  // We use a separate check since CREATE TRIGGER IF NOT EXISTS isn't standard.
  const triggerExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_update_category_registry'`
  ).get();

  if (!triggerExists) {
    db.exec(`
      CREATE TRIGGER trg_update_category_registry
      AFTER INSERT ON questions
      BEGIN
        INSERT INTO category_registry (category, question_count, min_date, max_date, min_value, max_value, rounds, updated_at)
        VALUES (
          NEW.category,
          1,
          NEW.air_date,
          NEW.air_date,
          NEW.value,
          NEW.value,
          NEW.round,
          datetime('now')
        )
        ON CONFLICT(category) DO UPDATE SET
          question_count = question_count + 1,
          min_date = CASE
            WHEN NEW.air_date IS NOT NULL AND (excluded.min_date IS NULL OR NEW.air_date < category_registry.min_date)
            THEN NEW.air_date ELSE category_registry.min_date END,
          max_date = CASE
            WHEN NEW.air_date IS NOT NULL AND (excluded.max_date IS NULL OR NEW.air_date > category_registry.max_date)
            THEN NEW.air_date ELSE category_registry.max_date END,
          min_value = CASE
            WHEN NEW.value IS NOT NULL AND (category_registry.min_value IS NULL OR NEW.value < category_registry.min_value)
            THEN NEW.value ELSE category_registry.min_value END,
          max_value = CASE
            WHEN NEW.value IS NOT NULL AND (category_registry.max_value IS NULL OR NEW.value > category_registry.max_value)
            THEN NEW.value ELSE category_registry.max_value END,
          rounds = CASE
            WHEN NEW.round IS NOT NULL AND INSTR(COALESCE(category_registry.rounds, ''), NEW.round) = 0
            THEN CASE
              WHEN category_registry.rounds IS NULL OR category_registry.rounds = '' THEN NEW.round
              ELSE category_registry.rounds || ',' || NEW.round
            END
            ELSE category_registry.rounds
          END,
          updated_at = datetime('now');
      END;
    `);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
