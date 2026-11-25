import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { getConversation, listMessages } from "@/server/conversations";
import { jsonError } from "@/server/http";

/** Customer-side polling: new messages after `?after=<id>` plus the conversation status. */
export async function GET(request: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  await connection();
  const { id } = await ctx.params;
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const db = await getDb();
  const conversation = await getConversation(db, id);
  if (!conversation) return jsonError(404, "Conversation not found");
  const rows = await listMessages(db, id, after);
  return Response.json({
    status: conversation.status,
    messages: rows.map((m) => ({ id: m.id, role: m.role, content: m.content, meta: m.meta, createdAt: m.createdAt })),
  });
}
