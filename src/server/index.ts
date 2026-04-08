import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config, printMockWarning } from '../config';
import { getDb } from '../db/schema';
import { getRegistryPaginated } from '../db/registry';
import { getStats, fetchQuestions } from '../db/queries';
import { searchCategories, getCategoryDetail } from '../db/categories';
import { loadFile } from '../ingest/load';
import { enrichCategories, hasUnenrichedCategories } from '../ingest/enrich';
import { ask } from '../pipeline/orchestrator';
import { createRateLimitMiddleware } from './ratelimit';
import { clearSession } from '../pipeline/session';
import { HTML_UI } from './ui';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  // Apply rate limiting to API-calling endpoints
  const apiRateLimit = createRateLimitMiddleware({
    windowMs: 60 * 1000,
    maxRequests: 20,  // 20 /ask requests per minute (these call Claude)
  });
  const generalRateLimit = createRateLimitMiddleware({
    windowMs: 60 * 1000,
    maxRequests: 100, // 100 general requests per minute
  });

  // Serve web UI
  app.get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(HTML_UI);
  });

  // POST /ask
  app.post('/ask', apiRateLimit, async (req: Request, res: Response) => {
    try {
      const { question, sessionId } = req.body;
      if (!question || typeof question !== 'string' || question.trim() === '') {
        res.status(400).json({ error: 'Missing or empty "question" field' });
        return;
      }

      const result = await ask(question.trim(), sessionId || undefined);
      res.json({
        answer: result.answer,
        categories: result.categories,
        whereClause: result.whereClause,
        questionsFound: result.questionsFound,
        durationMs: result.durationMs,
        sessionId: result.sessionId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[server] /ask error:', message);
      res.status(500).json({ error: message });
    }
  });

  // POST /ingest
  app.post('/ingest', async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body;
      if (!filePath || typeof filePath !== 'string') {
        res.status(400).json({ error: 'Missing "filePath" field' });
        return;
      }

      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        res.status(404).json({ error: `File not found: ${resolved}` });
        return;
      }

      const result = await loadFile(resolved);

      // Trigger enrichment in the background
      let enrichmentStarted = false;
      if (hasUnenrichedCategories()) {
        enrichmentStarted = true;
        enrichCategories(config.ENRICH_BATCH_SIZE).catch(err => {
          console.error('[server] Background enrichment error:', err);
        });
      }

      res.json({
        rowsAdded: result.rowsAdded,
        rowsSkipped: result.rowsSkipped,
        durationMs: result.durationMs,
        enrichmentStarted,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[server] /ingest error:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /registry
  app.get('/registry', generalRateLimit, (req: Request, res: Response) => {
    try {
      const limit = parseInt(String(req.query.limit || '50'), 10) || 50;
      const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
      const search = req.query.search ? String(req.query.search) : undefined;

      const entries = getRegistryPaginated(limit, offset, search);
      res.json(entries);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[server] /registry error:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /stats
  app.get('/stats', generalRateLimit, (_req: Request, res: Response) => {
    try {
      const stats = getStats();
      res.json(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[server] /stats error:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /categories — search categories by name and summary
  app.get('/categories', generalRateLimit, (req: Request, res: Response) => {
    try {
      const query = String(req.query.q || req.query.query || '');
      if (!query) {
        res.status(400).json({ error: 'Missing "q" or "query" parameter' });
        return;
      }
      const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
      const offset = parseInt(String(req.query.offset || '0'), 10) || 0;

      const { results, total } = searchCategories(query, limit, offset);
      res.json({ results, total, limit, offset });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[server] /categories error:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /categories/:name — get detail for a specific category
  app.get('/categories/:name', generalRateLimit, (req: Request, res: Response) => {
    try {
      const name = decodeURIComponent(String(req.params.name));
      const detail = getCategoryDetail(name);
      if (!detail.info) {
        res.status(404).json({ error: `Category not found: ${name}` });
        return;
      }
      res.json(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[server] /categories/:name error:', message);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /session/:id — clear a conversation session
  app.delete('/session/:id', (req: Request, res: Response) => {
    clearSession(String(req.params.id));
    res.json({ cleared: true });
  });

  // GET /export — export query results as CSV
  app.get('/export', generalRateLimit, (req: Request, res: Response) => {
    try {
      const categoriesParam = String(req.query.categories || '');
      if (!categoriesParam) {
        res.status(400).json({ error: 'Missing "categories" parameter' });
        return;
      }
      const categories = categoriesParam.split(',').map(c => c.trim()).filter(Boolean);
      const whereClause = req.query.whereClause ? String(req.query.whereClause) : null;
      const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 1000);

      const db = getDb();
      const placeholders = categories.map(() => '?').join(', ');
      let sql = `SELECT category, value, round, question, answer, air_date
                 FROM questions WHERE category IN (${placeholders})`;
      const params: unknown[] = [...categories];
      if (whereClause && whereClause !== 'null' && whereClause !== '') {
        sql += ` AND (${whereClause})`;
      }
      sql += ` ORDER BY category, value DESC LIMIT ?`;
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as {
        category: string; value: number | null; round: string | null;
        question: string; answer: string; air_date: string | null;
      }[];

      // Build CSV
      const csvLines = ['category,value,round,clue,response,air_date'];
      for (const r of rows) {
        csvLines.push([
          csvEscape(r.category),
          r.value != null ? String(r.value) : '',
          csvEscape(r.round || ''),
          csvEscape(r.answer),
          csvEscape(r.question),
          r.air_date || '',
        ].join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="jeopardy_export.csv"');
      res.send(csvLines.join('\n'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[server] /export error:', message);
      res.status(500).json({ error: message });
    }
  });

  return app;
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

export function startServer(port?: number): void {
  printMockWarning();

  // Ensure DB is initialized
  getDb();

  const app = createApp();
  const p = port || config.PORT;
  app.listen(p, () => {
    console.log(`Jeopardy RAG server listening on http://localhost:${p}`);
  });
}
