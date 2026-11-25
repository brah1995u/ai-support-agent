import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { queryRows, type Db } from "./db/client";
import {
  agentRuns,
  conversations,
  messages,
  tickets,
  toolCalls,
  type Channel,
  type ConversationStatus,
  type MessageMeta,
  type MessageRole,
} from "./db/schema";

export async function createConversation(db: Db, channel: Channel = "web") {
  const id = `c_${nanoid(12)}`;
  const [row] = await db.insert(conversations).values({ id, channel }).returning();
  return row;
}

export async function getConversation(db: Db, id: string) {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return row ?? null;
}

export async function addMessage(db: Db, conversationId: string, role: MessageRole, content: string, meta: MessageMeta = {}) {
  const [row] = await db.insert(messages).values({ conversationId, role, content, meta }).returning();
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
  return row;
}

export async function setStatus(db: Db, id: string, status: ConversationStatus, handoffReason?: string | null) {
  const [row] = await db
    .update(conversations)
    .set({ status, updatedAt: new Date(), ...(handoffReason !== undefined ? { handoffReason } : {}) })
    .where(eq(conversations.id, id))
    .returning();
  return row ?? null;
}

export async function listMessages(db: Db, conversationId: string, afterId = 0) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gt(messages.id, afterId)))
    .orderBy(asc(messages.id));
}

/** Conversation list for the operator console, newest activity first. */
export async function listConversations(db: Db, limit = 100) {
  return queryRows<{
    id: string;
    channel: Channel;
    status: ConversationStatus;
    title: string | null;
    handoff_reason: string | null;
    updated_at: string;
    created_at: string;
    message_count: number;
    last_message: string | null;
    last_role: MessageRole | null;
    cost_usd: number;
  }>(
    db,
    sql`
    SELECT c.id, c.channel, c.status, c.title, c.handoff_reason, c.updated_at, c.created_at,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.role <> 'event') AS message_count,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role <> 'event' ORDER BY m.id DESC LIMIT 1) AS last_message,
      (SELECT m.role FROM messages m WHERE m.conversation_id = c.id AND m.role <> 'event' ORDER BY m.id DESC LIMIT 1) AS last_role,
      COALESCE((SELECT sum(r.cost_usd)::float FROM agent_runs r WHERE r.conversation_id = c.id), 0) AS cost_usd
    FROM conversations c
    WHERE c.channel <> 'eval'
    ORDER BY CASE c.status WHEN 'needs_human' THEN 0 WHEN 'human' THEN 1 ELSE 2 END, c.updated_at DESC
    LIMIT ${limit}`,
  );
}

/** Full trace of a conversation: messages, agent runs with their tool calls, tickets. */
export async function getConversationDetail(db: Db, id: string) {
  const conversation = await getConversation(db, id);
  if (!conversation) return null;
  const [msgs, runs, calls, ticketRows] = await Promise.all([
    listMessages(db, id),
    db.select().from(agentRuns).where(eq(agentRuns.conversationId, id)).orderBy(asc(agentRuns.id)),
    db.select().from(toolCalls).where(eq(toolCalls.conversationId, id)).orderBy(asc(toolCalls.id)),
    db.select().from(tickets).where(eq(tickets.conversationId, id)).orderBy(desc(tickets.id)),
  ]);
  return {
    conversation,
    messages: msgs,
    runs: runs.map((r) => ({ ...r, toolCalls: calls.filter((c) => c.runId === r.id) })),
    tickets: ticketRows,
  };
}

/** Aggregates for the console header (last 7 days, excluding eval traffic). */
export async function getMetrics(db: Db) {
  const rows = await queryRows<{
    conversations: number;
    needs_human: number;
    handed_off: number;
    runs: number;
    avg_latency_ms: number | null;
    p90_latency_ms: number | null;
    avg_first_token_ms: number | null;
    total_cost_usd: number | null;
    avg_cost_usd: number | null;
    tool_calls: number;
    tool_errors: number;
    tickets: number;
    cache_read_tokens: number;
    input_tokens: number;
  }>(
    db,
    sql`
    WITH c AS (
      SELECT * FROM conversations WHERE channel <> 'eval' AND created_at > now() - interval '7 days'
    ), r AS (
      SELECT * FROM agent_runs WHERE conversation_id IN (SELECT id FROM c)
    )
    SELECT
      (SELECT count(*)::int FROM c) AS conversations,
      (SELECT count(*)::int FROM c WHERE status = 'needs_human') AS needs_human,
      (SELECT count(*)::int FROM c WHERE handoff_reason IS NOT NULL) AS handed_off,
      (SELECT count(*)::int FROM r) AS runs,
      (SELECT avg(latency_ms)::float FROM r WHERE error IS NULL) AS avg_latency_ms,
      (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY latency_ms)::float FROM r WHERE error IS NULL) AS p90_latency_ms,
      (SELECT avg(first_token_ms)::float FROM r WHERE error IS NULL) AS avg_first_token_ms,
      (SELECT sum(cost_usd)::float FROM r) AS total_cost_usd,
      (SELECT avg(cost_usd)::float FROM r WHERE error IS NULL) AS avg_cost_usd,
      (SELECT count(*)::int FROM tool_calls WHERE run_id IN (SELECT id FROM r)) AS tool_calls,
      (SELECT count(*)::int FROM tool_calls WHERE run_id IN (SELECT id FROM r) AND is_error) AS tool_errors,
      (SELECT count(*)::int FROM tickets WHERE conversation_id IN (SELECT id FROM c)) AS tickets,
      (SELECT COALESCE(sum(cache_read_tokens), 0)::int FROM r) AS cache_read_tokens,
      (SELECT COALESCE(sum(input_tokens), 0)::int FROM r) AS input_tokens`,
  );
  return rows[0];
}
