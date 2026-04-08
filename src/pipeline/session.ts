/**
 * Session memory for conversation context.
 * Stores recent interactions per sessionId so follow-up questions work.
 */

export interface SessionEntry {
  question: string;
  categories: string[];
  whereClause: string | null;
  answerSnippet: string;
  timestamp: number;
}

interface Session {
  entries: SessionEntry[];
  createdAt: number;
}

const sessions = new Map<string, Session>();
const MAX_ENTRIES_PER_SESSION = 20;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function getSession(sessionId: string): SessionEntry[] {
  cleanup();
  const session = sessions.get(sessionId);
  if (!session) return [];
  return session.entries;
}

export function addToSession(sessionId: string, entry: SessionEntry): void {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { entries: [], createdAt: Date.now() };
    sessions.set(sessionId, session);
  }
  session.entries.push(entry);
  if (session.entries.length > MAX_ENTRIES_PER_SESSION) {
    session.entries = session.entries.slice(-MAX_ENTRIES_PER_SESSION);
  }
}

export function buildConversationContext(sessionId: string): string {
  const entries = getSession(sessionId);
  if (entries.length === 0) return '';

  return entries.map((e, i) =>
    `[Turn ${i + 1}] User asked: "${e.question}" → Categories: ${e.categories.join(', ')}` +
    (e.whereClause ? ` | Filter: ${e.whereClause}` : '')
  ).join('\n');
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getSessionCount(): number {
  cleanup();
  return sessions.size;
}

function cleanup(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}
