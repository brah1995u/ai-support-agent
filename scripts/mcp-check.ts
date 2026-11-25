/**
 * Connects to the running app's MCP endpoint as a real MCP client, lists the tools and calls
 * two of them. Usage: npm run mcp:check -- http://localhost:3000/api/mcp
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "http://localhost:3000/api/mcp");

async function main() {
  const client = new Client({ name: "nimbus-mcp-check", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(url));
  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));

  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const trips = await client.callTool({ name: "search_trips", arguments: { origin: "Valencia", destination: "Gandia", date } });
  const tripText = (trips.content as { type: string; text: string }[])[0].text;
  console.log(`search_trips Valencia -> Gandia ${date}:`, JSON.parse(tripText).trips.length, "departures");

  const kb = await client.callTool({ name: "search_knowledge", arguments: { query: "pets on buses" } });
  const kbHits = JSON.parse((kb.content as { type: string; text: string }[])[0].text) as { document: string; section: string }[];
  console.log("search_knowledge 'pets on buses':", kbHits.map((h) => `${h.document} > ${h.section}`).slice(0, 2).join(" | "));

  const booking = await client.callTool({ name: "get_booking", arguments: { code: "NB4K7Q2", email: "wrong@example.com" } });
  console.log("get_booking with wrong email -> isError:", booking.isError);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
