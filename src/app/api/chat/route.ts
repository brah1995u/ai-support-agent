import { z } from "zod";
import { runAgent } from "@/server/agent/run";
import { getDb } from "@/server/db/client";
import { createConversation, getConversation } from "@/server/conversations";
import { clientKey, jsonError, rateLimited } from "@/server/http";

const Body = z.object({
  conversationId: z.string().max(40).optional(),
  message: z.string().trim().min(1).max(1500),
});

/**
 * Customer chat endpoint. Streams agent events as Server-Sent Events:
 * conversation -> user_message -> text deltas / tool_start / tool_end / handoff -> done.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Send { message } (1-1500 characters).");
  if (rateLimited(`chat:${clientKey(request)}`)) return jsonError(429, "Too many messages. Please wait a few minutes.");

  const db = await getDb();
  const conversation = parsed.data.conversationId
    ? await getConversation(db, parsed.data.conversationId)
    : await createConversation(db, "web");
  if (!conversation) return jsonError(404, "Conversation not found");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      send({ type: "conversation", id: conversation.id });
      try {
        for await (const event of runAgent({ db, conversationId: conversation.id, text: parsed.data.message, signal: request.signal })) {
          send(event);
        }
      } catch (error) {
        console.error("[chat]", error);
        send({ type: "error", message: "Internal error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
