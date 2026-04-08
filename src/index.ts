import path from 'path';
import fs from 'fs';
import { config, printMockWarning } from './config';
import { getDb, closeDb } from './db/schema';
import { getStats } from './db/queries';
import { loadFile } from './ingest/load';
import { enrichCategories, hasUnenrichedCategories } from './ingest/enrich';
import { ask } from './pipeline/orchestrator';
import { startServer } from './server/index';

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  // Initialize DB for all commands
  getDb();

  switch (command) {
    case 'ingest': {
      const filePath = args[0];
      if (!filePath) {
        console.error('Usage: ts-node src/index.ts ingest <filePath>');
        process.exit(1);
      }
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        console.error(`File not found: ${resolved}`);
        process.exit(1);
      }
      console.log(`Ingesting ${resolved}...`);
      const result = await loadFile(resolved);
      console.log(`Ingest complete: ${result.rowsAdded} added, ${result.rowsSkipped} skipped in ${result.durationMs}ms`);

      // Auto-enrich if needed
      if (hasUnenrichedCategories()) {
        console.log('Starting background enrichment...');
        await enrichCategories(config.ENRICH_BATCH_SIZE);
      }
      break;
    }

    case 'enrich': {
      let limit = config.ENRICH_BATCH_SIZE;
      const limitIdx = args.indexOf('--limit');
      if (limitIdx !== -1 && args[limitIdx + 1]) {
        limit = parseInt(args[limitIdx + 1], 10) || limit;
      }
      console.log(`Enriching up to ${limit} categories...`);
      const enriched = await enrichCategories(limit);
      console.log(`Enriched ${enriched} categories.`);
      break;
    }

    case 'ask': {
      const question = args.join(' ');
      if (!question) {
        console.error('Usage: ts-node src/index.ts ask "your question here"');
        process.exit(1);
      }
      printMockWarning();
      const result = await ask(question);

      // Print answer to stdout
      console.log(result.answer);

      // Print call log to stderr
      console.error(`\n--- Call Log ---`);
      console.error(`Categories: ${result.categories.join(', ')}`);
      console.error(`Filter: ${result.whereClause || 'none'}`);
      console.error(`Questions found: ${result.questionsFound}`);
      console.error(`Duration: ${result.durationMs}ms`);
      console.error(`Calls: ${result.callLog.map(c => c.model).join(' → ')}`);
      break;
    }

    case 'serve': {
      let port = config.PORT;
      const portIdx = args.indexOf('--port');
      if (portIdx !== -1 && args[portIdx + 1]) {
        port = parseInt(args[portIdx + 1], 10) || port;
      }
      startServer(port);
      return; // Don't close DB — server is running
    }

    case 'stats': {
      const stats = getStats();
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    default:
      console.log(`Jeopardy RAG System

Usage:
  ts-node src/index.ts ingest <filePath>       Ingest a TSV/CSV/JSON file
  ts-node src/index.ts enrich [--limit N]      Enrich category summaries
  ts-node src/index.ts ask "question"          Ask a question
  ts-node src/index.ts serve [--port N]        Start HTTP server
  ts-node src/index.ts stats                   Show database stats`);
      break;
  }

  closeDb();
}

main().catch(err => {
  console.error('Fatal error:', err);
  closeDb();
  process.exit(1);
});
