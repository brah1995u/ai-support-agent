import { connection } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { addMessage, getConversation, getConversationDetail, setStatus } from "@/server/conversations";
import { isOperator, jsonError } from "@/server/http";

/** Full trace of one conversation for the operator console. */
export async function GET(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  await connection();
  if (!isOperator(request)) return jsonError(401, "Operator token required");
  const { id } = await ctx.params;
  const detail = await getConversationDetail(await getDb(), id);
  return detail ? Response.json(detail) : jsonError(404, "Conversation not found");
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("takeover") }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("reply"), text: z.string().trim().min(1).max(2000) }),
]);

const EVENT_TEXT = {
  takeover: "A human agent joined the conversation.",
  release: "The conversation was handed back to the AI assistant.",
  close: "The conversation was closed.",
} as const;

/** Operator actions: take over from the bot, reply as a human, hand back, close. */
export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  if (!isOperator(request)) return jsonError(401, "Operator token required");
  const parsed = Action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Unknown action");
  const { id } = await ctx.params;
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) return jsonError(404, "Conversation not found");

  const body = parsed.data;
  switch (body.action) {
    case "takeover":
      await setStatus(db, id, "human");
      await addMessage(db, id, "event", EVENT_TEXT.takeover);
      break;
    case "release":
      await setStatus(db, id, "bot", null);
      await addMessage(db, id, "event", EVENT_TEXT.release);
      break;
    case "close":
      await setStatus(db, id, "closed");
      await addMessage(db, id, "event", EVENT_TEXT.close);
      break;
    case "reply":
      // Replying implies ownership: the bot must not answer over the human.
      if (conversation.status !== "human") {
        await setStatus(db, id, "human");
        await addMessage(db, id, "event", EVENT_TEXT.takeover);
      }
      await addMessage(db, id, "operator", body.text);
      break;
  }
  return Response.json({ ok: true, conversation: await getConversation(db, id) });
}
