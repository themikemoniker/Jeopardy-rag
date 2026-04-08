import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, writeTempTsv, writeTempJson } from './helpers';

// Set up test DB before importing modules that use config
const testDb = setupTestDb();

import { parseValue, mapRound, parseLine, loadFile } from '../src/ingest/load';
import { getDb } from '../src/db/schema';

describe('parseValue', () => {
  it('parses dollar amounts', () => {
    assert.equal(parseValue('$200'), 200);
    assert.equal(parseValue('$1,000'), 1000);
    assert.equal(parseValue('$2000'), 2000);
  });

  it('parses plain integers', () => {
    assert.equal(parseValue('400'), 400);
    assert.equal(parseValue('1600'), 1600);
  });

  it('returns null for empty/blank values', () => {
    assert.equal(parseValue(''), null);
    assert.equal(parseValue(null), null);
    assert.equal(parseValue(undefined), null);
    assert.equal(parseValue('  '), null);
  });

  it('returns null for none/null strings', () => {
    assert.equal(parseValue('none'), null);
    assert.equal(parseValue('None'), null);
    assert.equal(parseValue('null'), null);
    assert.equal(parseValue('NULL'), null);
  });

  it('returns null for non-numeric strings', () => {
    assert.equal(parseValue('abc'), null);
  });
});

describe('mapRound', () => {
  it('maps integer strings to round names', () => {
    assert.equal(mapRound('1'), 'Jeopardy!');
    assert.equal(mapRound('2'), 'Double Jeopardy!');
    assert.equal(mapRound('3'), 'Final Jeopardy!');
  });

  it('passes through non-numeric round names', () => {
    assert.equal(mapRound('Jeopardy!'), 'Jeopardy!');
    assert.equal(mapRound('Double Jeopardy!'), 'Double Jeopardy!');
  });

  it('returns null for empty/null', () => {
    assert.equal(mapRound(null), null);
    assert.equal(mapRound(undefined), null);
    assert.equal(mapRound(''), null);
  });

  it('trims whitespace', () => {
    assert.equal(mapRound(' 1 '), 'Jeopardy!');
    assert.equal(mapRound('  2  '), 'Double Jeopardy!');
  });
});

describe('parseLine', () => {
  it('parses tab-delimited lines', () => {
    const result = parseLine('foo\tbar\tbaz', '\t');
    assert.deepEqual(result, ['foo', 'bar', 'baz']);
  });

  it('parses comma-delimited lines', () => {
    const result = parseLine('foo,bar,baz', ',');
    assert.deepEqual(result, ['foo', 'bar', 'baz']);
  });

  it('handles quoted fields with delimiters', () => {
    const result = parseLine('"foo,bar"\tbaz', '\t');
    assert.deepEqual(result, ['foo,bar', 'baz']);
  });

  it('handles escaped quotes (doubled)', () => {
    const result = parseLine('"He said ""hello"""\tworld', '\t');
    assert.deepEqual(result, ['He said "hello"', 'world']);
  });

  it('handles empty fields', () => {
    const result = parseLine('a\t\tb', '\t');
    assert.deepEqual(result, ['a', '', 'b']);
  });

  it('handles single field', () => {
    const result = parseLine('solo', '\t');
    assert.deepEqual(result, ['solo']);
  });

  it('handles empty string', () => {
    const result = parseLine('', '\t');
    assert.deepEqual(result, ['']);
  });
});

describe('loadFile', () => {
  after(() => {
    testDb.cleanup();
  });

  it('ingests TSV rows correctly', async () => {
    const tsv = writeTempTsv(
      'round\tvalue\tdaily_double_value\tcategory\tcomments\tanswer\tquestion\tair_date\tnotes\n' +
      '1\t200\t\tSCIENCE\t\tThe Red Planet\tWhat is Mars?\t2000-01-01\t\n' +
      '2\t$800\t\tHISTORY\t\tFirst president\tWho is Washington?\t2000-01-02\t\n'
    );

    try {
      const result = await loadFile(tsv.filePath);
      assert.equal(result.rowsAdded, 2);
      assert.equal(result.rowsSkipped, 0);
      assert.ok(result.durationMs >= 0);

      const db = getDb();
      const rows = db.prepare('SELECT * FROM questions ORDER BY id').all() as any[];
      assert.equal(rows.length, 2);

      assert.equal(rows[0].category, 'SCIENCE');
      assert.equal(rows[0].value, 200);
      assert.equal(rows[0].round, 'Jeopardy!');
      assert.equal(rows[0].question, 'What is Mars?');
      assert.equal(rows[0].answer, 'The Red Planet');

      assert.equal(rows[1].category, 'HISTORY');
      assert.equal(rows[1].value, 800);
      assert.equal(rows[1].round, 'Double Jeopardy!');
    } finally {
      tsv.cleanup();
    }
  });

  it('skips duplicate rows on re-ingest', async () => {
    const tsv = writeTempTsv(
      'round\tvalue\tdaily_double_value\tcategory\tcomments\tanswer\tquestion\tair_date\tnotes\n' +
      '1\t200\t\tSCIENCE\t\tThe Red Planet\tWhat is Mars?\t2000-01-01\t\n'
    );

    try {
      const result = await loadFile(tsv.filePath);
      assert.equal(result.rowsAdded, 0);
      assert.equal(result.rowsSkipped, 1);
    } finally {
      tsv.cleanup();
    }
  });

  it('skips rows with empty question and answer', async () => {
    const tsv = writeTempTsv(
      'round\tvalue\tdaily_double_value\tcategory\tcomments\tanswer\tquestion\tair_date\tnotes\n' +
      '1\t200\t\tSCIENCE\t\t\t\t2000-01-01\t\n'
    );

    try {
      const result = await loadFile(tsv.filePath);
      assert.equal(result.rowsAdded, 0);
      assert.equal(result.rowsSkipped, 1);
    } finally {
      tsv.cleanup();
    }
  });

  it('handles Final Jeopardy with no value', async () => {
    const tsv = writeTempTsv(
      'round\tvalue\tdaily_double_value\tcategory\tcomments\tanswer\tquestion\tair_date\tnotes\n' +
      '3\t\t\tFINAL CAT\t\tFinal clue\tWhat is answer?\t2000-03-01\t\n'
    );

    try {
      const result = await loadFile(tsv.filePath);
      assert.equal(result.rowsAdded, 1);

      const db = getDb();
      const row = db.prepare(`SELECT * FROM questions WHERE category = 'FINAL CAT'`).get() as any;
      assert.equal(row.value, null);
      assert.equal(row.round, 'Final Jeopardy!');
    } finally {
      tsv.cleanup();
    }
  });

  it('ingests JSON rows correctly', async () => {
    const json = writeTempJson([
      {
        show_number: 100,
        air_date: '1999-05-01',
        round: 'Jeopardy!',
        category: 'JSON CAT',
        value: '$600',
        question: 'What is JSON?',
        answer: 'A data format',
      },
    ]);

    try {
      const result = await loadFile(json.filePath);
      assert.equal(result.rowsAdded, 1);

      const db = getDb();
      const row = db.prepare(`SELECT * FROM questions WHERE category = 'JSON CAT'`).get() as any;
      assert.equal(row.show_number, 100);
      assert.equal(row.value, 600);
      assert.equal(row.question, 'What is JSON?');
    } finally {
      json.cleanup();
    }
  });

  it('records ingest operations', () => {
    const db = getDb();
    const logs = db.prepare('SELECT * FROM ingest_log ORDER BY id').all() as any[];
    assert.ok(logs.length >= 1);
    assert.ok(logs[0].filename);
    assert.ok(typeof logs[0].rows_added === 'number');
  });
});
