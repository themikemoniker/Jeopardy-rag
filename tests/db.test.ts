import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, insertTestQuestions } from './helpers';

const testDb = setupTestDb();

import { getDb } from '../src/db/schema';
import { getTopCategories, getUnenrichedCategories, updateCategorySummary, categoryExists, getRegistryPaginated, getSampleQuestions } from '../src/db/registry';
import { fetchQuestions, getQuestionCount, getStats } from '../src/db/queries';

describe('Database layer', () => {
  before(() => {
    const db = getDb();
    insertTestQuestions(db, [
      { category: 'SCIENCE', question: 'What is Mars?', answer: 'The Red Planet', value: 200, round: 'Jeopardy!', air_date: '2000-01-01' },
      { category: 'SCIENCE', question: 'What is gold?', answer: 'Element 79', value: 400, round: 'Jeopardy!', air_date: '2000-01-02' },
      { category: 'SCIENCE', question: 'What is H2O?', answer: 'Water formula', value: 1000, round: 'Double Jeopardy!', air_date: '2000-01-03' },
      { category: 'HISTORY', question: 'Who is Lincoln?', answer: '16th president', value: 600, round: 'Jeopardy!', air_date: '1999-05-01' },
      { category: 'HISTORY', question: 'Who is Caesar?', answer: 'Roman leader', value: 800, round: 'Jeopardy!', air_date: '1999-06-01' },
      { category: 'MUSIC', question: 'What is a piano?', answer: '88 keys', value: 200, round: 'Jeopardy!', air_date: '2001-01-01' },
    ]);
  });

  after(() => {
    testDb.cleanup();
  });

  describe('category_registry trigger', () => {
    it('creates registry entries for each category', () => {
      assert.ok(categoryExists('SCIENCE'));
      assert.ok(categoryExists('HISTORY'));
      assert.ok(categoryExists('MUSIC'));
      assert.ok(!categoryExists('NONEXISTENT'));
    });

    it('tracks correct question counts', () => {
      const cats = getTopCategories(10);
      const science = cats.find(c => c.category === 'SCIENCE');
      const history = cats.find(c => c.category === 'HISTORY');
      const music = cats.find(c => c.category === 'MUSIC');

      assert.equal(science?.question_count, 3);
      assert.equal(history?.question_count, 2);
      assert.equal(music?.question_count, 1);
    });

    it('tracks min/max dates correctly', () => {
      const cats = getTopCategories(10);
      const science = cats.find(c => c.category === 'SCIENCE');
      assert.equal(science?.min_date, '2000-01-01');
      assert.equal(science?.max_date, '2000-01-03');
    });

    it('tracks min/max values correctly', () => {
      const cats = getTopCategories(10);
      const science = cats.find(c => c.category === 'SCIENCE');
      assert.equal(science?.min_value, 200);
      assert.equal(science?.max_value, 1000);
    });

    it('tracks distinct rounds', () => {
      const cats = getTopCategories(10);
      const science = cats.find(c => c.category === 'SCIENCE');
      assert.ok(science?.rounds?.includes('Jeopardy!'));
      assert.ok(science?.rounds?.includes('Double Jeopardy!'));
    });

    it('orders by question_count desc', () => {
      const cats = getTopCategories(10);
      assert.equal(cats[0].category, 'SCIENCE');
      assert.equal(cats[1].category, 'HISTORY');
      assert.equal(cats[2].category, 'MUSIC');
    });
  });

  describe('registry helpers', () => {
    it('getUnenrichedCategories returns categories without summaries', () => {
      const unenriched = getUnenrichedCategories(10);
      assert.equal(unenriched.length, 3);
    });

    it('updateCategorySummary sets the summary', () => {
      updateCategorySummary('SCIENCE', 'Questions about scientific topics');
      const cats = getTopCategories(10);
      const science = cats.find(c => c.category === 'SCIENCE');
      assert.equal(science?.summary, 'Questions about scientific topics');
      assert.ok(science?.summary_generated_at);
    });

    it('getUnenrichedCategories excludes enriched categories', () => {
      const unenriched = getUnenrichedCategories(10);
      assert.equal(unenriched.length, 2);
      assert.ok(!unenriched.find(c => c.category === 'SCIENCE'));
    });

    it('getSampleQuestions returns questions for a category', () => {
      const samples = getSampleQuestions('SCIENCE', 5);
      assert.equal(samples.length, 3);
      assert.ok(samples[0].question);
      assert.ok(samples[0].answer);
    });

    it('getRegistryPaginated supports pagination', () => {
      const page1 = getRegistryPaginated(2, 0);
      assert.equal(page1.length, 2);

      const page2 = getRegistryPaginated(2, 2);
      assert.equal(page2.length, 1);
    });

    it('getRegistryPaginated supports search', () => {
      const results = getRegistryPaginated(10, 0, 'SCI');
      assert.equal(results.length, 1);
      assert.equal(results[0].category, 'SCIENCE');
    });
  });

  describe('fetchQuestions', () => {
    it('returns formatted question text', () => {
      const result = fetchQuestions(['SCIENCE'], null, 10);
      assert.ok(result.includes('SCIENCE'));
      assert.ok(result.includes('Clue:'));
      assert.ok(result.includes('Response:'));
    });

    it('applies WHERE clause filter', () => {
      const result = fetchQuestions(['SCIENCE'], 'value >= 400', 10);
      assert.ok(!result.includes('$200'));
      assert.ok(result.includes('$400') || result.includes('$1000'));
    });

    it('returns empty string for no matches', () => {
      const result = fetchQuestions(['NONEXISTENT'], null, 10);
      assert.equal(result, '');
    });

    it('respects limit', () => {
      const result = fetchQuestions(['SCIENCE'], null, 1);
      const blocks = result.split('\n\n').filter(b => b.trim());
      assert.equal(blocks.length, 1);
    });
  });

  describe('getQuestionCount', () => {
    it('counts questions matching categories', () => {
      assert.equal(getQuestionCount(['SCIENCE'], null), 3);
      assert.equal(getQuestionCount(['HISTORY'], null), 2);
      assert.equal(getQuestionCount(['SCIENCE', 'HISTORY'], null), 5);
    });

    it('counts with WHERE clause', () => {
      assert.equal(getQuestionCount(['SCIENCE'], 'value >= 400'), 2);
    });
  });

  describe('getStats', () => {
    it('returns correct aggregate stats', () => {
      const stats = getStats();
      assert.equal(stats.totalQuestions, 6);
      assert.equal(stats.totalCategories, 3);
      assert.equal(stats.categoriesEnriched, 1);
      assert.equal(stats.categoriesPendingEnrichment, 2);
      assert.equal(stats.dateRange.min, '1999-05-01');
      assert.equal(stats.dateRange.max, '2001-01-01');
    });
  });
});
