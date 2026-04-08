import { routeQuery } from './route';
import { buildFilter } from './filter';
import { generateAnswer } from './answer';
import { fetchQuestions, getQuestionCount } from '../db/queries';
import { config } from '../config';

export interface CallLogEntry {
  model: string;
  tokens: number;
}

export interface AskResult {
  answer: string;
  categories: string[];
  whereClause: string | null;
  questionsFound: number;
  durationMs: number;
  callLog: CallLogEntry[];
}

export async function ask(userQuestion: string): Promise<AskResult> {
  const startTime = Date.now();
  const callLog: CallLogEntry[] = [];

  // Call 1: Route
  const routeStart = Date.now();
  const categories = await routeQuery(userQuestion);
  const routeDuration = Date.now() - routeStart;
  callLog.push({
    model: config.MOCK_MODE ? 'mock' : 'claude-haiku-4-5-20251001',
    tokens: 0, // Token tracking would require API response access
  });

  if (config.LOG_LEVEL === 'debug') {
    console.error(`  [orchestrator] Route (${routeDuration}ms): ${JSON.stringify(categories)}`);
  }

  // Call 2: Filter
  const filterStart = Date.now();
  const whereClause = await buildFilter(userQuestion, categories);
  const filterDuration = Date.now() - filterStart;
  callLog.push({
    model: config.MOCK_MODE ? 'mock' : 'claude-haiku-4-5-20251001',
    tokens: 0,
  });

  if (config.LOG_LEVEL === 'debug') {
    console.error(`  [orchestrator] Filter (${filterDuration}ms): ${whereClause || 'none'}`);
  }

  // Fetch questions
  const limit = config.MAX_CONTEXT_QUESTIONS;
  const context = fetchQuestions(categories, whereClause, limit);
  const questionsFound = getQuestionCount(categories, whereClause);

  if (config.LOG_LEVEL === 'debug') {
    console.error(`  [orchestrator] Found ${questionsFound} questions, using top ${limit}`);
  }

  // Call 3: Answer
  const answerStart = Date.now();
  const answer = await generateAnswer(userQuestion, context);
  const answerDuration = Date.now() - answerStart;
  callLog.push({
    model: config.MOCK_MODE ? 'mock' : 'claude-sonnet-4-6-20250514',
    tokens: 0,
  });

  if (config.LOG_LEVEL === 'debug') {
    console.error(`  [orchestrator] Answer (${answerDuration}ms)`);
  }

  const durationMs = Date.now() - startTime;

  return {
    answer,
    categories,
    whereClause,
    questionsFound,
    durationMs,
    callLog,
  };
}
