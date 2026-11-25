import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { executeTool, type ToolContext } from "@/server/agent/tools";
import { getDb, type Db } from "@/server/db/client";
import { eq } from "drizzle-orm";
import { addMessage, createConversation } from "@/server/conversations";
import { conversations } from "@/server/db/schema";
import { CITIES } from "@/server/domain/timetable";
import { clientKey, jsonError, rateLimited } from "@/server/http";

/**
 * MCP server (Streamable HTTP, stateless). Exposes the same business tools the support
 * agent uses, so Claude, ChatGPT or any MCP client can search trips, read the help center,
 * look up a booking (code + email) and open tickets: a new channel on the same backend.
 */
function buildServer(db: Db): McpServer {
  const server = new McpServer({ name: "nimbus-travel", version: "1.0.0" });

  // Read-only tools don't touch a conversation. A ticket opened over MCP gets its own
  // conversation (channel "mcp") so the team sees it in the console queue.
  const call = async (name: string, input: unknown) => {
    let conversationId = "mcp";
    if (name === "create_ticket") {
      const conversation = await createConversation(db, "mcp");
      conversationId = conversation.id;
    }
    const ctx: ToolContext = { db, conversationId, now: new Date(), meta: {} };
    const result = await executeTool(name, input, ctx);
    if (name === "create_ticket" && result.ok) {
      const summary = (input as { summary?: string }).summary ?? "";
      await addMessage(db, conversationId, "event", `Ticket ${(result.data as { ticket_number: string }).ticket_number} opened by an external agent over MCP.`);
      await db.update(conversations).set({ title: `MCP ticket: ${summary.slice(0, 70)}` }).where(eq(conversations.id, conversationId));
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.ok ? result.data : { error: result.error }, null, 2) }],
      isError: !result.ok,
    };
  };

  server.registerTool(
    "search_trips",
    {
      title: "Search trips",
      description: "Nimbus Travel bus and train departures between two Spanish cities on a date, with Basic and Flex prices in EUR.",
      inputSchema: {
        origin: z.enum(CITIES),
        destination: z.enum(CITIES),
        date: z.string().describe("YYYY-MM-DD"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => call("search_trips", args),
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Search help center",
      description: "Search Nimbus Travel rules: refunds, changes, baggage, pets, children, accessibility, delays, payments, invoices.",
      inputSchema: { query: z.string().describe("English search query") },
      annotations: { readOnlyHint: true },
    },
    (args) => call("search_knowledge", args),
  );

  server.registerTool(
    "get_booking",
    {
      title: "Get booking",
      description: "Look up a Nimbus booking. Needs the booking code and the email used for the booking.",
      inputSchema: { code: z.string(), email: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args) => call("get_booking", args),
  );

  server.registerTool(
    "create_ticket",
    {
      title: "Create support ticket",
      description: "Open a ticket for the Nimbus support team (cancellation, change, refund, compensation, lost item, invoice, payment, complaint).",
      inputSchema: {
        category: z.enum(["cancellation", "change", "refund", "compensation", "lost_item", "invoice", "payment", "accessibility", "complaint", "other"]),
        priority: z.enum(["low", "normal", "high", "urgent"]),
        summary: z.string(),
        booking_code: z.string().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) => call("create_ticket", args),
  );

  return server;
}

async function handle(request: Request): Promise<Response> {
  if (request.method === "POST" && rateLimited(`mcp:${clientKey(request)}`, 60)) {
    return jsonError(429, "Too many requests");
  }
  const server = buildServer(await getDb());
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
