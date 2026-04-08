import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, insertTestQuestions } from './helpers';

const testDb = setupTestDb();

import { DANGEROUS_PATTERNS } from '../src/pipeline/filter';
import { mockRoute, mockFilter, mockAnswer } from '../src/pipeline/mock';
import { getDb } from '../src/db/schema';

describe('DANGEROUS_PATTERNS', () => {
  it('rejects DROP statements', () => {
    assert.ok(DANGEROUS_PATTERNS.test('DROP TABLE questions'));
    assert.ok(DANGEROUS_PATTERNS.test('drop table questions'));
  });

  it('rejects DELETE statements', () => {
    assert.ok(DANGEROUS_PATTERNS.test('DELETE FROM questions'));
  });

  it('rejects UPDATE statements', () => {
    assert.ok(DANGEROUS_PATTERNS.test('UPDATE questions SET value = 0'));
  });

  it('rejects INSERT statements', () => {
    assert.ok(DANGEROUS_PATTERNS.test('INSERT INTO questions VALUES (1)'));
  });

  it('rejects ALTER statements', () => {
    assert.ok(DANGEROUS_PATTERNS.test('ALTER TABLE questions ADD COLUMN x'));
  });

  it('rejects CREATE statements', () => {
    assert.ok(DANGEROUS_PATTERNS.test('CREATE TABLE evil (x int)'));
  });

  it('rejects TRUNCATE statements', () => {
    assert.ok(DANGEROUS_PATTERNS.test('TRUNCATE TABLE questions'));
  });

  it('rejects semicolons', () => {
    assert.ok(DANGEROUS_PATTERNS.test('value > 500; DROP TABLE questions'));
  });

  it('rejects SQL comments (double dash)', () => {
    assert.ok(DANGEROUS_PATTERNS.test('value > 500 -- comment'));
  });

  it('allows safe WHERE clauses', () => {
    assert.ok(!DANGEROUS_PATTERNS.test('value >= 800'));
    assert.ok(!DANGEROUS_PATTERNS.test("round = 'Final Jeopardy!'"));
    assert.ok(!DANGEROUS_PATTERNS.test("air_date >= '2000-01-01'"));
    assert.ok(!DANGEROUS_PATTERNS.test("value BETWEEN 400 AND 800"));
    assert.ok(!DANGEROUS_PATTERNS.test("answer LIKE '%science%'"));
  });
});

describe('mockFilter', () => {
  it('returns value >= 800 for hard questions', () => {
    assert.equal(mockFilter('Give me hard questions'), 'value >= 800');
    assert.equal(mockFilter('Show me difficult clues'), 'value >= 800');
  });

  it('returns value <= 400 for easy questions', () => {
    assert.equal(mockFilter('Show me easy questions'), 'value <= 400');
    assert.equal(mockFilter('Cheap clues please'), 'value <= 400');
  });

  it('returns Final Jeopardy filter', () => {
    assert.equal(mockFilter('Final Jeopardy questions'), "round = 'Final Jeopardy!'");
  });

  it('returns Double Jeopardy filter', () => {
    assert.equal(mockFilter('Double jeopardy clues'), "round = 'Double Jeopardy!'");
  });

  it('returns null for generic questions', () => {
    assert.equal(mockFilter('Tell me about science'), null);
  });

  it('prioritizes first match (hard before double)', () => {
    // "hard" comes before "double" in the check order
    assert.equal(mockFilter('hard double questions'), 'value >= 800');
  });
});

describe('mockRoute', () => {
  before(() => {
    const db = getDb();
    insertTestQuestions(db, [
      { category: 'SCIENCE', question: 'Q1', answer: 'A1', value: 200 },
      { category: 'SCIENCE', question: 'Q2', answer: 'A2', value: 400 },
      { category: 'SCIENCE', question: 'Q3', answer: 'A3', value: 600 },
      { category: 'HISTORY', question: 'Q4', answer: 'A4', value: 200 },
      { category: 'HISTORY', question: 'Q5', answer: 'A5', value: 400 },
      { category: 'MUSIC', question: 'Q6', answer: 'A6', value: 200 },
    ]);
  });

  after(() => {
    testDb.cleanup();
  });

  it('returns top 2 categories by question_count', () => {
    const result = mockRoute('anything');
    assert.equal(result.length, 2);
    assert.equal(result[0], 'SCIENCE');
    assert.equal(result[1], 'HISTORY');
  });
});

describe('mockAnswer', () => {
  it('includes mock mode header', () => {
    const result = mockAnswer('test', 'block1\n\nblock2\n\nblock3\n\nblock4');
    assert.ok(result.includes('[MOCK MODE'));
  });

  it('includes first 3 context blocks', () => {
    const result = mockAnswer('test', 'block1\n\nblock2\n\nblock3\n\nblock4');
    assert.ok(result.includes('block1'));
    assert.ok(result.includes('block2'));
    assert.ok(result.includes('block3'));
    assert.ok(!result.includes('block4'));
  });

  it('includes instruction to add API key', () => {
    const result = mockAnswer('test', 'context');
    assert.ok(result.includes('ANTHROPIC_API_KEY'));
  });
});
