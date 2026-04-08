import { routeQuery } from './route';
import { buildFilter } from './filter';
import { generateAnswer } from './answer';
import { fetchQuestions, getQuestionCount } from '../db/queries';
import { config } from '../config';
import { addToSession, buildConversationContext } from './session';

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
  sessionId?: string;
}

export async function ask(userQuestion: string, sessionId?: string): Promise<AskResult> {
  const startTime = Date.now();
  const callLog: CallLogEntry[] = [];

  // Build conversation context if session exists
  const conversationContext = sessionId ? buildConversationContext(sessionId) : '';

  // Augment the question with conversation context for routing
  const augmentedQuestion = conversationContext
    ? `${userQuestion}\n\n[Previous conversation context:\n${conversationContext}]`
    : userQuestion;

  // Call 1: Route
  const routeStart = Date.now();
  const categories = await routeQuery(augmentedQuestion);
  const routeDuration = Date.now() - routeStart;
  callLog.push({
    model: config.MOCK_MODE ? 'mock' : 'claude-haiku-4-5-20241022',
    tokens: 0,
  });

  if (config.LOG_LEVEL === 'debug') {
    console.error(`  [orchestrator] Route (${routeDuration}ms): ${JSON.stringify(categories)}`);
  }

  // Call 2: Filter
  const filterStart = Date.now();
  const whereClause = await buildFilter(augmentedQuestion, categories);
  const filterDuration = Date.now() - filterStart;
  callLog.push({
    model: config.MOCK_MODE ? 'mock' : 'claude-haiku-4-5-20241022',
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
  const answerContext = conversationContext
    ? `${context}\n\n[Conversation history:\n${conversationContext}]`
    : context;
  const answer = await generateAnswer(userQuestion, answerContext);
  const answerDuration = Date.now() - answerStart;
  callLog.push({
    model: config.MOCK_MODE ? 'mock' : 'claude-sonnet-4-5-20241022',
    tokens: 0,
  });

  if (config.LOG_LEVEL === 'debug') {
    console.error(`  [orchestrator] Answer (${answerDuration}ms)`);
  }

  const durationMs = Date.now() - startTime;

  // Store in session if sessionId provided
  if (sessionId) {
    addToSession(sessionId, {
      question: userQuestion,
      categories,
      whereClause,
      answerSnippet: answer.slice(0, 200),
      timestamp: Date.now(),
    });
  }

  return {
    answer,
    categories,
    whereClause,
    questionsFound,
    durationMs,
    callLog,
    sessionId,
  };
}
