import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { mockAnswer } from './mock';

export async function generateAnswer(userQuestion: string, context: string): Promise<string> {
  if (config.MOCK_MODE) {
    return mockAnswer(userQuestion, context);
  }

  try {
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      system: `You are an expert Jeopardy assistant with access to a curated set of real Jeopardy clues. Use the provided clues to answer the user's request. If they want to be quizzed, present clues in proper Jeopardy format (show the clue, wait for them to respond with 'What is…'). If they ask a factual question about Jeopardy history or categories, answer from the context. Be accurate — only reference clues that appear in the context.`,
      messages: [{
        role: 'user',
        content: `Context:\n${context}\n\n---\n\n${userQuestion}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  [answer] Error:', msg);
    throw new Error(`Answer generation failed: ${msg}`);
  }
}
