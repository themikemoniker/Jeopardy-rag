import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupTestDb, insertTestQuestions } from './helpers';

const testDb = setupTestDb();

import { getDb } from '../src/db/schema';
import { updateCategorySummary } from '../src/db/registry';
import { mockRoute, mockFilter } from '../src/pipeline/mock';
import { validateWhereClause } from '../src/pipeline/filter';
import { addToSession, getSession, buildConversationContext, clearSession, getSessionCount } from '../src/pipeline/session';
import { checkRateLimit } from '../src/server/ratelimit';
import { searchCategories, getCategoryDetail } from '../src/db/categories';
import { createApp } from '../src/server/index';

// Set up test data
before(() => {
  const db = getDb();
  insertTestQuestions(db, [
    { category: 'ASTRONOMY', question: 'What is Mars?', answer: 'The Red Planet', value: 200, round: 'Jeopardy!', air_date: '2000-01-01' },
    { category: 'ASTRONOMY', question: 'What is Jupiter?', answer: 'Largest planet', value: 800, round: 'Jeopardy!', air_date: '2000-01-02' },
    { category: 'ASTRONOMY', question: 'What is a nebula?', answer: 'Cloud of gas', value: 1000, round: 'Double Jeopardy!', air_date: '2000-01-03' },
    { category: 'SCIENCE', question: 'What is H2O?', answer: 'Water formula', value: 400, round: 'Jeopardy!', air_date: '2000-01-01' },
    { category: 'SCIENCE', question: 'What is DNA?', answer: 'Genetic code', value: 600, round: 'Jeopardy!', air_date: '2000-01-02' },
    { category: 'U.S. PRESIDENTS', question: 'Who is Lincoln?', answer: '16th president', value: 200, round: 'Jeopardy!', air_date: '1999-05-01' },
    { category: 'U.S. PRESIDENTS', question: 'Who is Washington?', answer: 'First president', value: 400, round: 'Jeopardy!', air_date: '1999-06-01' },
    { category: 'MOVIES', question: 'What is Jaws?', answer: 'Spielberg shark film', value: 600, round: 'Double Jeopardy!', air_date: '2001-03-01' },
  ]);
  updateCategorySummary('ASTRONOMY', 'Questions about planets, stars, and space exploration');
  updateCategorySummary('SCIENCE', 'General science questions');
});

after(() => {
  testDb.cleanup();
});

// --- 1. Improved mock routing ---
describe('Improved mockRoute', () => {
  it('matches keyword "astronomy" to ASTRONOMY category', () => {
    const result = mockRoute('Tell me about astronomy');
    assert.ok(result.includes('ASTRONOMY'), `Expected ASTRONOMY in ${JSON.stringify(result)}`);
  });

  it('matches keyword "president" to U.S. PRESIDENTS', () => {
    const result = mockRoute('Questions about presidents');
    assert.ok(result.includes('U.S. PRESIDENTS'), `Expected U.S. PRESIDENTS in ${JSON.stringify(result)}`);
  });

  it('matches keyword "science" to SCIENCE', () => {
    const result = mockRoute('science trivia');
    assert.ok(result.includes('SCIENCE'), `Expected SCIENCE in ${JSON.stringify(result)}`);
  });

  it('falls back to top categories for unmatched queries', () => {
    const result = mockRoute('xyzzy blorp');
    assert.ok(result.length >= 1);
  });

  it('returns at most 3 categories', () => {
    const result = mockRoute('science astronomy presidents movies');
    assert.ok(result.length <= 3);
  });
});

// --- 2. Improved mockFilter ---
describe('Improved mockFilter', () => {
  it('extracts dollar amounts from "worth at least $800"', () => {
    const result = mockFilter('worth at least $800');
    assert.equal(result, 'value >= 800');
  });

  it('extracts dollar amounts from "over 1000"', () => {
    const result = mockFilter('clues over 1000 dollars');
    assert.equal(result, 'value >= 1000');
  });

  it('extracts year filter', () => {
    const result = mockFilter('questions from 2005');
    assert.ok(result?.includes('2005'));
    assert.ok(result?.includes('air_date'));
  });

  it('still handles keyword heuristics', () => {
    assert.equal(mockFilter('hard questions'), 'value >= 800');
    assert.equal(mockFilter('easy clues'), 'value <= 400');
  });
});

// --- 3. Categories search ---
describe('searchCategories', () => {
  it('searches by category name', () => {
    const { results, total } = searchCategories('ASTRO');
    assert.ok(total >= 1);
    assert.ok(results.some(r => r.category === 'ASTRONOMY'));
  });

  it('searches by summary content', () => {
    const { results } = searchCategories('planets');
    assert.ok(results.some(r => r.category === 'ASTRONOMY'));
  });

  it('returns empty for no matches', () => {
    const { results, total } = searchCategories('XYZNONEXISTENT');
    assert.equal(total, 0);
    assert.equal(results.length, 0);
  });

  it('supports pagination', () => {
    const { results: page1 } = searchCategories('S', 2, 0);
    assert.ok(page1.length <= 2);
  });
});

describe('getCategoryDetail', () => {
  it('returns category info and sample clues', () => {
    const detail = getCategoryDetail('ASTRONOMY');
    assert.ok(detail.info);
    assert.equal(detail.info!.category, 'ASTRONOMY');
    assert.equal(detail.info!.question_count, 3);
    assert.ok(detail.sampleClues.length > 0);
  });

  it('returns null for nonexistent category', () => {
    const detail = getCategoryDetail('NONEXISTENT');
    assert.equal(detail.info, null);
    assert.equal(detail.sampleClues.length, 0);
  });
});

// --- 4. Session memory ---
describe('Session memory', () => {
  it('stores and retrieves session entries', () => {
    addToSession('test-1', {
      question: 'astronomy questions',
      categories: ['ASTRONOMY'],
      whereClause: null,
      answerSnippet: 'Here are clues...',
      timestamp: Date.now(),
    });
    const entries = getSession('test-1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].question, 'astronomy questions');
  });

  it('appends multiple entries', () => {
    addToSession('test-1', {
      question: 'harder ones',
      categories: ['ASTRONOMY'],
      whereClause: 'value >= 800',
      answerSnippet: 'More clues...',
      timestamp: Date.now(),
    });
    const entries = getSession('test-1');
    assert.equal(entries.length, 2);
  });

  it('builds conversation context string', () => {
    const ctx = buildConversationContext('test-1');
    assert.ok(ctx.includes('astronomy questions'));
    assert.ok(ctx.includes('harder ones'));
    assert.ok(ctx.includes('Turn 1'));
    assert.ok(ctx.includes('Turn 2'));
  });

  it('returns empty for unknown session', () => {
    const entries = getSession('nonexistent');
    assert.equal(entries.length, 0);
  });

  it('clears a session', () => {
    clearSession('test-1');
    const entries = getSession('test-1');
    assert.equal(entries.length, 0);
  });

  it('tracks session count', () => {
    addToSession('test-a', { question: 'q', categories: [], whereClause: null, answerSnippet: '', timestamp: Date.now() });
    addToSession('test-b', { question: 'q', categories: [], whereClause: null, answerSnippet: '', timestamp: Date.now() });
    assert.ok(getSessionCount() >= 2);
    clearSession('test-a');
    clearSession('test-b');
  });
});

// --- 5. Rate limiting ---
describe('Rate limiting', () => {
  it('allows requests within the limit', () => {
    const cfg = { windowMs: 60000, maxRequests: 5 };
    const r1 = checkRateLimit('test-ip-1', cfg);
    assert.ok(r1.allowed);
    assert.equal(r1.remaining, 4);
  });

  it('blocks requests over the limit', () => {
    const cfg = { windowMs: 60000, maxRequests: 3 };
    checkRateLimit('test-ip-2', cfg);
    checkRateLimit('test-ip-2', cfg);
    checkRateLimit('test-ip-2', cfg);
    const r4 = checkRateLimit('test-ip-2', cfg);
    assert.ok(!r4.allowed);
    assert.equal(r4.remaining, 0);
    assert.ok(r4.resetMs > 0);
  });

  it('tracks separate buckets per key', () => {
    const cfg = { windowMs: 60000, maxRequests: 2 };
    checkRateLimit('ip-a', cfg);
    checkRateLimit('ip-a', cfg);
    const blocked = checkRateLimit('ip-a', cfg);
    assert.ok(!blocked.allowed);

    const other = checkRateLimit('ip-b', cfg);
    assert.ok(other.allowed);
  });
});

// --- 6. Improved filter validation ---
describe('validateWhereClause', () => {
  it('allows simple comparisons', () => {
    assert.ok(validateWhereClause('value >= 800').valid);
    assert.ok(validateWhereClause("round = 'Final Jeopardy!'").valid);
    assert.ok(validateWhereClause("air_date >= '2000-01-01'").valid);
  });

  it('allows BETWEEN and LIKE', () => {
    assert.ok(validateWhereClause('value BETWEEN 400 AND 800').valid);
    assert.ok(validateWhereClause("answer LIKE '%science%'").valid);
  });

  it('rejects DROP', () => {
    const r = validateWhereClause('DROP TABLE questions');
    assert.ok(!r.valid);
    assert.ok(r.reason?.includes('prohibited'));
  });

  it('rejects subqueries', () => {
    const r = validateWhereClause('value IN (SELECT value FROM questions)');
    assert.ok(!r.valid);
    assert.ok(r.reason?.includes('Subqueries'));
  });

  it('rejects UNION', () => {
    const r = validateWhereClause("value = 1 UNION SELECT * FROM questions");
    assert.ok(!r.valid);
  });

  it('rejects unbalanced parentheses', () => {
    assert.ok(!validateWhereClause('value > (800').valid);
    assert.ok(!validateWhereClause('value > 800)').valid);
  });

  it('rejects semicolons', () => {
    assert.ok(!validateWhereClause('value > 800; DROP TABLE x').valid);
  });

  it('rejects SQL comments', () => {
    assert.ok(!validateWhereClause('value > 800 -- drop').valid);
  });
});

// --- 7. HTTP Server new endpoints ---
describe('New HTTP endpoints', () => {
  let server: http.Server;
  let baseUrl: string;

  function request(path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const postData = options.body ? JSON.stringify(options.body) : undefined;
      const req = http.request(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(data), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode || 0, body: data, headers: res.headers });
          }
        });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  before(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  describe('GET / (Web UI)', () => {
    it('serves HTML', async () => {
      const res = await request('/');
      assert.equal(res.status, 200);
      assert.ok(typeof res.body === 'string');
      assert.ok(res.body.includes('JEOPARDY RAG'));
    });
  });

  describe('GET /categories', () => {
    it('searches categories', async () => {
      const res = await request('/categories?q=ASTRO');
      assert.equal(res.status, 200);
      assert.ok(res.body.total >= 1);
      assert.ok(res.body.results.length >= 1);
    });

    it('returns 400 without query', async () => {
      const res = await request('/categories');
      assert.equal(res.status, 400);
    });

    it('returns empty for no matches', async () => {
      const res = await request('/categories?q=XYZNONEXISTENT');
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 0);
    });
  });

  describe('GET /categories/:name', () => {
    it('returns category detail', async () => {
      const res = await request('/categories/ASTRONOMY');
      assert.equal(res.status, 200);
      assert.ok(res.body.info);
      assert.equal(res.body.info.category, 'ASTRONOMY');
      assert.ok(res.body.sampleClues.length > 0);
    });

    it('returns 404 for unknown category', async () => {
      const res = await request('/categories/NONEXISTENT');
      assert.equal(res.status, 404);
    });
  });

  describe('POST /ask with sessionId', () => {
    it('accepts sessionId and returns it', async () => {
      const res = await request('/ask', {
        method: 'POST',
        body: { question: 'astronomy questions', sessionId: 'test-session-http' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.sessionId, 'test-session-http');
    });
  });

  describe('DELETE /session/:id', () => {
    it('clears a session', async () => {
      const res = await request('/session/test-session-http', { method: 'DELETE' });
      assert.equal(res.status, 200);
      assert.ok(res.body.cleared);
    });
  });

  describe('GET /export', () => {
    it('exports CSV', async () => {
      const res = await request('/export?categories=ASTRONOMY');
      assert.equal(res.status, 200);
      assert.ok(typeof res.body === 'string');
      assert.ok(res.body.includes('category,value'));
      assert.ok(res.body.includes('ASTRONOMY'));
    });

    it('returns 400 without categories', async () => {
      const res = await request('/export');
      assert.equal(res.status, 400);
    });
  });

  describe('Rate limit headers', () => {
    it('includes rate limit headers on /stats', async () => {
      const res = await request('/stats');
      assert.ok(res.headers['x-ratelimit-limit']);
      assert.ok(res.headers['x-ratelimit-remaining']);
    });
  });
});
