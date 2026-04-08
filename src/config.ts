import dotenv from 'dotenv';
dotenv.config();

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  return val === 'true' || val === '1';
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

const apiKey = process.env.ANTHROPIC_API_KEY || '';
const autoMock = !apiKey;

export const config = {
  ANTHROPIC_API_KEY: apiKey,
  PORT: envInt('PORT', 3000),
  DB_PATH: process.env.DB_PATH || './jeopardy.db',
  LOG_LEVEL: (process.env.LOG_LEVEL || 'info') as 'info' | 'debug' | 'silent',
  ENRICH_BATCH_SIZE: envInt('ENRICH_BATCH_SIZE', 50),
  MAX_CONTEXT_QUESTIONS: envInt('MAX_CONTEXT_QUESTIONS', 60),
  REGISTRY_TOP_N: envInt('REGISTRY_TOP_N', 100),
  MOCK_MODE: envBool('MOCK_MODE', false) || autoMock,
};

export function printMockWarning(): void {
  if (config.MOCK_MODE) {
    console.warn(
      '\n⚠  ANTHROPIC_API_KEY not set — running in MOCK MODE.\n' +
      '   All API calls will return dummy responses.\n' +
      '   Set ANTHROPIC_API_KEY in .env to enable real responses.\n'
    );
  }
}
