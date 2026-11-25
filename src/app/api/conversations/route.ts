import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { getMetrics, listConversations } from "@/server/conversations";
import { isOperator, jsonError } from "@/server/http";
import { agentStatus } from "@/server/agent/llm";

/** Operator console: conversation queue + 7-day metrics. */
export async function GET(request: Request) {
  await connection();
  if (!isOperator(request)) return jsonError(401, "Operator token required");
  const db = await getDb();
  const [conversations, metrics, agent] = await Promise.all([listConversations(db), getMetrics(db), agentStatus()]);
  return Response.json({ conversations, metrics, agent });
}
