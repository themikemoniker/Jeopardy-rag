import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupTestDb, insertTestQuestions } from './helpers';

const testDb = setupTestDb();

import { createApp } from '../src/server/index';
import { getDb } from '../src/db/schema';
import { updateCategorySummary } from '../src/db/registry';

let server: http.Server;
let baseUrl: string;

function request(path: string, options: {
  method?: string;
  body?: unknown;
} = {}): Promise<{ status: number; body: any }> {
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
          resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 0, body: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

describe('HTTP Server', () => {
  before(async () => {
    const db = getDb();
    insertTestQuestions(db, [
      { category: 'SCIENCE', question: 'What is Mars?', answer: 'Red Planet', value: 200, round: 'Jeopardy!', air_date: '2000-01-01' },
      { category: 'SCIENCE', question: 'What is gold?', answer: 'Element 79', value: 800, round: 'Jeopardy!', air_date: '2000-01-02' },
      { category: 'SCIENCE', question: 'What is H2O?', answer: 'Water', value: 1000, round: 'Double Jeopardy!', air_date: '2000-01-03' },
      { category: 'HISTORY', question: 'Who is Lincoln?', answer: '16th president', value: 600, round: 'Jeopardy!', air_date: '1999-05-01' },
    ]);
    updateCategorySummary('SCIENCE', 'Science questions');

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
    testDb.cleanup();
  });

  describe('GET /stats', () => {
    it('returns correct stats', async () => {
      const res = await request('/stats');
      assert.equal(res.status, 200);
      assert.equal(res.body.totalQuestions, 4);
      assert.equal(res.body.totalCategories, 2);
      assert.equal(res.body.categoriesEnriched, 1);
      assert.equal(res.body.categoriesPendingEnrichment, 1);
      assert.ok(res.body.dateRange.min);
      assert.ok(res.body.dateRange.max);
    });
  });

  describe('GET /registry', () => {
    it('returns paginated registry entries', async () => {
      const res = await request('/registry?limit=10');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 2);
      // Ordered by question_count desc
      assert.equal(res.body[0].category, 'SCIENCE');
    });

    it('supports search parameter', async () => {
      const res = await request('/registry?search=HIST');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].category, 'HISTORY');
    });

    it('supports pagination', async () => {
      const res = await request('/registry?limit=1&offset=1');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].category, 'HISTORY');
    });
  });

  describe('POST /ask', () => {
    it('returns answer with metadata', async () => {
      const res = await request('/ask', {
        method: 'POST',
        body: { question: 'Tell me about science' },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.answer);
      assert.ok(Array.isArray(res.body.categories));
      assert.ok(typeof res.body.questionsFound === 'number');
      assert.ok(typeof res.body.durationMs === 'number');
    });

    it('returns 400 for missing question', async () => {
      const res = await request('/ask', { method: 'POST', body: {} });
      assert.equal(res.status, 400);
      assert.ok(res.body.error);
    });

    it('returns 400 for empty question', async () => {
      const res = await request('/ask', { method: 'POST', body: { question: '   ' } });
      assert.equal(res.status, 400);
    });

    it('returns 400 for non-string question', async () => {
      const res = await request('/ask', { method: 'POST', body: { question: 123 } });
      assert.equal(res.status, 400);
    });

    it('applies mock filter for hard questions', async () => {
      const res = await request('/ask', {
        method: 'POST',
        body: { question: 'Give me hard questions' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.whereClause, 'value >= 800');
    });
  });

  describe('POST /ingest', () => {
    it('returns 400 for missing filePath', async () => {
      const res = await request('/ingest', { method: 'POST', body: {} });
      assert.equal(res.status, 400);
      assert.ok(res.body.error);
    });

    it('returns 404 for nonexistent file', async () => {
      const res = await request('/ingest', {
        method: 'POST',
        body: { filePath: '/nonexistent/file.tsv' },
      });
      assert.equal(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });
  });
});
