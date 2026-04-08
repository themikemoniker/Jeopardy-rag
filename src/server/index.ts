import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config, printMockWarning } from '../config';
import { getDb } from '../db/schema';
import { getRegistryPaginated } from '../db/registry';
import { getStats } from '../db/queries';
import { loadFile } from '../ingest/load';
import { enrichCategories, hasUnenrichedCategories } from '../ingest/enrich';
import { ask } from '../pipeline/orchestrator';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  // POST /ask
  app.post('/ask', async (req: Request, res: Response) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== 'string' || question.trim() === '') {
        res.status(400).json({ error: 'Missing or empty "question" field' });
        return;
      }

      const result = await ask(question.trim());
      res.json({
        answer: result.answer,
        categories: result.categories,
        whereClause: result.whereClause,
        questionsFound: result.questionsFound,
        durationMs: result.durationMs,
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
  app.get('/registry', (req: Request, res: Response) => {
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
  app.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = getStats();
      res.json(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[server] /stats error:', message);
      res.status(500).json({ error: message });
    }
  });

  return app;
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
