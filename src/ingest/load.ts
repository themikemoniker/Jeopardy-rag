import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { getDb } from '../db/schema';

const ROUND_MAP: Record<string, string> = {
  '1': 'Jeopardy!',
  '2': 'Double Jeopardy!',
  '3': 'Final Jeopardy!',
};

function parseValue(raw: string | undefined | null): number | null {
  if (!raw || raw.trim() === '') return null;
  const cleaned = raw.replace(/[$,]/g, '').trim();
  if (cleaned === '' || cleaned.toLowerCase() === 'none' || cleaned.toLowerCase() === 'null') return null;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

function mapRound(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return ROUND_MAP[trimmed] || trimmed;
}

export interface IngestResult {
  rowsAdded: number;
  rowsSkipped: number;
  durationMs: number;
}

export async function loadFile(filePath: string): Promise<IngestResult> {
  const startTime = Date.now();
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    return loadJson(filePath, startTime);
  }

  return loadDelimited(filePath, ext === '.csv' ? ',' : '\t', startTime);
}

async function loadDelimited(filePath: string, delimiter: string, startTime: number): Promise<IngestResult> {
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO questions (show_number, air_date, round, category, value, question, answer, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const checkDup = db.prepare(`SELECT 1 FROM questions WHERE category = ? AND question = ? LIMIT 1`);

  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] = [];
  let lineNum = 0;
  let rowsAdded = 0;
  let rowsSkipped = 0;
  let batch: (() => void)[] = [];

  const flushBatch = () => {
    if (batch.length === 0) return;
    const txn = db.transaction(() => {
      for (const fn of batch) fn();
    });
    txn();
    batch = [];
  };

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) {
      headers = parseLine(line, delimiter).map(h => h.toLowerCase().trim());
      continue;
    }

    const fields = parseLine(line, delimiter);
    // Need at least enough fields for essential columns (category, answer, question)
    if (fields.length < 4) {
      rowsSkipped++;
      continue;
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = fields[i] || '';
    }

    // jwolle1 TSV format: answer=clue, question=response
    const category = (row['category'] || '').trim();
    const question = (row['question'] || '').trim();
    const answer = (row['answer'] || '').trim();

    if (!question && !answer) {
      rowsSkipped++;
      continue;
    }
    if (!category) {
      rowsSkipped++;
      continue;
    }

    // Check for value: use 'value' field; if empty, try 'daily_double_value'
    let valueRaw = row['value'] || '';
    if (!valueRaw && row['daily_double_value']) {
      valueRaw = row['daily_double_value'];
    }
    const value = parseValue(valueRaw);
    const round = mapRound(row['round']);
    const airDate = (row['air_date'] || '').trim() || null;
    const showNumber = row['show_number'] ? parseInt(row['show_number'], 10) || null : null;
    const notes = (row['notes'] || row['comments'] || '').trim() || null;

    // Duplicate check
    const dup = checkDup.get(category, question);
    if (dup) {
      rowsSkipped++;
      continue;
    }

    batch.push(() => {
      insertStmt.run(showNumber, airDate, round, category, value, question, answer, notes);
    });

    if (batch.length >= 500) {
      flushBatch();
    }

    if (lineNum % 10000 === 0) {
      console.log(`  [ingest] Processed ${lineNum} lines, added ${rowsAdded + batch.length}, skipped ${rowsSkipped}`);
    }
  }

  flushBatch();

  // Calculate final counts
  rowsAdded = lineNum - 1 - rowsSkipped; // -1 for header

  // Log to ingest_log
  db.prepare(`INSERT INTO ingest_log (filename, rows_added) VALUES (?, ?)`).run(
    path.basename(filePath),
    rowsAdded
  );

  const durationMs = Date.now() - startTime;
  console.log(`  [ingest] Done: ${rowsAdded} added, ${rowsSkipped} skipped in ${durationMs}ms`);

  return { rowsAdded, rowsSkipped, durationMs };
}

async function loadJson(filePath: string, startTime: number): Promise<IngestResult> {
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO questions (show_number, air_date, round, category, value, question, answer, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const checkDup = db.prepare(`SELECT 1 FROM questions WHERE category = ? AND question = ? LIMIT 1`);

  // For JSON, we read line-by-line to handle streaming for large arrays
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content) as Record<string, string | number>[];

  let rowsAdded = 0;
  let rowsSkipped = 0;
  let batch: (() => void)[] = [];

  const flushBatch = () => {
    if (batch.length === 0) return;
    const txn = db.transaction(() => {
      for (const fn of batch) fn();
    });
    txn();
    batch = [];
  };

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const category = String(row['category'] || '').trim();
    const question = String(row['question'] || '').trim();
    const answer = String(row['answer'] || '').trim();

    if (!question && !answer) {
      rowsSkipped++;
      continue;
    }
    if (!category) {
      rowsSkipped++;
      continue;
    }

    const value = parseValue(String(row['value'] ?? ''));
    const round = mapRound(String(row['round'] || ''));
    const airDate = String(row['air_date'] || '').trim() || null;
    const showNumber = row['show_number'] ? parseInt(String(row['show_number']), 10) || null : null;

    const dup = checkDup.get(category, question);
    if (dup) {
      rowsSkipped++;
      continue;
    }

    batch.push(() => {
      insertStmt.run(showNumber, airDate, round, category, value, question, answer, null);
    });

    if (batch.length >= 500) {
      flushBatch();
    }

    if ((i + 1) % 10000 === 0) {
      console.log(`  [ingest] Processed ${i + 1} rows, skipped ${rowsSkipped}`);
    }
  }

  flushBatch();
  rowsAdded = data.length - rowsSkipped;

  db.prepare(`INSERT INTO ingest_log (filename, rows_added) VALUES (?, ?)`).run(
    path.basename(filePath),
    rowsAdded
  );

  const durationMs = Date.now() - startTime;
  console.log(`  [ingest] Done: ${rowsAdded} added, ${rowsSkipped} skipped in ${durationMs}ms`);

  return { rowsAdded, rowsSkipped, durationMs };
}

function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}
