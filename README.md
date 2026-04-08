# Jeopardy RAG

A Jeopardy question retrieval system using hierarchical LLM routing against a SQLite database with 480k+ real clues. No vector embeddings, no external search index — Claude navigates a category registry and generates SQL filters to find relevant clues before answering.

**Live:** [jeopardy.readysetgo.website](https://jeopardy.readysetgo.website)

## How it works

```
User question
    │
    ▼
┌─────────────────────────┐
│  1. Route (Haiku)       │  Pick 1-3 categories from 56k using a compact index
│                         │  with category names, counts, and summaries
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  2. Filter (Haiku)      │  Generate a SQL WHERE clause (value >= 800,
│                         │  round = 'Final Jeopardy!', date ranges, etc.)
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  3. Fetch (SQLite)      │  Query matching clues from the database
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  4. Answer (Sonnet)     │  Generate a response grounded in real clues
└─────────────────────────┘
```

## Features

- **480k+ real Jeopardy clues** from 1984-2025, spanning 56k categories
- **3-step retrieval pipeline** — Haiku routes and filters, Sonnet answers
- **Web UI** — Jeopardy-themed interface with Ask, Categories, and Stats tabs
- **Session memory** — follow-up questions maintain context within a session
- **Smart mock mode** — auto-activates without an API key; uses keyword matching for routing, heuristic filters, and real DB queries so the full pipeline works end-to-end
- **Category search** — browse and search all 56k categories by name or summary
- **CSV export** — download query results as CSV for study or flashcards
- **Rate limiting** — per-IP token bucket (20/min for API calls, 100/min for reads)
- **Streaming ingestion** — load TSV/CSV/JSON files with duplicate detection; 530k rows in ~25 seconds
- **Category enrichment** — Haiku generates one-sentence descriptions for each category to improve routing accuracy
- **SQL injection protection** — validates WHERE clauses for dangerous patterns, subqueries, unbalanced parentheses
- **CI/CD** — GitHub Actions runs 115 tests on Node 18/20/22, smoke tests all endpoints, auto-deploys to production on merge

## Quick start

```bash
git clone https://github.com/themikemoniker/Jeopardy-rag.git
cd Jeopardy-rag
npm install

# Ingest sample data (50 clues)
npx ts-node src/index.ts ingest ./data/sample.tsv

# Start the server
npx ts-node src/index.ts serve
# Open http://localhost:3000
```

Works immediately in mock mode without an API key. Add `ANTHROPIC_API_KEY` to `.env` for real Claude responses.

### Ingest the full dataset

```bash
# Download the jwolle1 dataset (~74MB, 530k clues)
curl -L -o ./data/combined.tsv \
  "https://raw.githubusercontent.com/jwolle1/jeopardy_clue_dataset/main/combined_season1-41.tsv"

npx ts-node src/index.ts ingest ./data/combined.tsv
```

### Enrich categories

```bash
# Enrich one batch of 50 categories
npx ts-node src/index.ts enrich

# Enrich ALL categories (requires API key, ~$0.50-1.00)
npx ts-node src/index.ts enrich --all
```

## CLI

```bash
npx ts-node src/index.ts ingest <file>        # Ingest TSV/CSV/JSON
npx ts-node src/index.ts enrich [--all]        # Enrich category summaries
npx ts-node src/index.ts ask "question"        # Ask a question
npx ts-node src/index.ts serve [--port N]      # Start HTTP server + web UI
npx ts-node src/index.ts stats                 # Show database stats
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Web UI |
| `POST` | `/ask` | Ask a question (`{"question": "...", "sessionId": "..."}`) |
| `POST` | `/ingest` | Ingest a file (`{"filePath": "..."}`) |
| `GET` | `/stats` | Database statistics |
| `GET` | `/registry` | Paginated category registry (`?limit=50&offset=0&search=`) |
| `GET` | `/categories` | Search categories by name/summary (`?q=space&limit=50`) |
| `GET` | `/categories/:name` | Category detail with sample clues |
| `GET` | `/export` | CSV export (`?categories=SCIENCE&whereClause=value>=800`) |
| `DELETE` | `/session/:id` | Clear a conversation session |

## Docker

```bash
# Local with Docker Compose
docker compose up -d

# Ingest data
docker exec jeopardy-rag node dist/index.js ingest /app/data/sample.tsv
```

## Tech stack

- **Runtime:** Node.js + TypeScript
- **Database:** SQLite via better-sqlite3
- **LLMs:** Claude Haiku 4.5 (routing/filtering), Claude Sonnet 4.6 (answers)
- **Server:** Express
- **Infrastructure:** Hetzner CPX11, Cloudflare, GitHub Actions CI/CD
- **No dependencies on:** vector databases, embeddings, LangChain, ORMs, or frontend frameworks

## Project structure

```
src/
├── db/
│   ├── schema.ts          # SQLite schema, migrations, triggers
│   ├── registry.ts        # Category registry helpers
│   ├── queries.ts         # Question fetch and stats
│   └── categories.ts      # Category search
├── pipeline/
│   ├── route.ts           # Call 1: category routing via Haiku
│   ├── filter.ts          # Call 2: SQL WHERE clause via Haiku
│   ├── answer.ts          # Call 3: final answer via Sonnet
│   ├── mock.ts            # Mock implementations for all 3 calls
│   ├── orchestrator.ts    # Wires route → filter → fetch → answer
│   └── session.ts         # Conversation memory
├── ingest/
│   ├── load.ts            # Streaming TSV/CSV/JSON ingestion
│   └── enrich.ts          # Category summary enrichment
├── server/
│   ├── index.ts           # Express server with all endpoints
│   ├── ratelimit.ts       # Per-IP rate limiting
│   └── ui.ts              # Inline web UI (HTML/CSS/JS)
└── index.ts               # CLI entry point
```

## Tests

```bash
npm test    # 115 tests across 4 test files
```

Tests cover ingestion parsing, database triggers, registry helpers, query formatting, SQL validation, mock pipeline, rate limiting, session memory, and all HTTP endpoints.

## Roadmap

- [ ] **HTTPS on origin** — add Caddy reverse proxy for end-to-end TLS (currently Flexible via Cloudflare)
- [ ] **Streaming answers** — use Claude streaming API to show answers as they generate
- [ ] **Quiz mode** — interactive back-and-forth where users respond with "What is..." and get scored
- [ ] **Daily Double** — random high-value clue challenge with wagering
- [ ] **User accounts** — track quiz scores and favorite categories over time
- [ ] **Multiplayer** — WebSocket-based competitive Jeopardy rounds
- [ ] **Better enrichment** — use embeddings or keyword extraction for richer category summaries without burning API credits
- [ ] **Mobile UI** — responsive layout improvements for phone screens
- [ ] **Category clustering** — group similar categories (e.g., "SCIENCE", "SCIENTISTS", "SCIENCE & NATURE") to improve routing recall
- [ ] **Scheduled data updates** — auto-ingest new seasons as they're released
- [ ] **Analytics dashboard** — track popular queries, category hit rates, and response times

## License

See [LICENSE](LICENSE) for details.
