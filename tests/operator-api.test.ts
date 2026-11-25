import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/conversations/[id]/route";
import { closeDb, getDb, type Db } from "@/server/db/client";
import { createConversation, getConversation, listMessages } from "@/server/conversations";

let db: Db;
beforeAll(async () => {
  db = await getDb();
});
afterAll(closeDb);

function act(id: string, body: unknown) {
  const request = new Request(`http://localhost/api/conversations/${id}`, { method: "POST", body: JSON.stringify(body) });
  return POST(request, { params: Promise.resolve({ id }) } as never);
}

describe("operator actions", () => {
  it("reply takes the conversation over, release hands it back to the AI", async () => {
    const { id } = await createConversation(db);
    expect((await act(id, { action: "reply", text: "Hi, I'm Ana from Nimbus." })).status).toBe(200);
    expect((await getConversation(db, id))?.status).toBe("human");
    expect((await listMessages(db, id)).map((m) => m.role)).toEqual(["event", "operator"]);

    await act(id, { action: "release" });
    expect((await getConversation(db, id))?.status).toBe("bot");
  });

  it("validates actions", async () => {
    const { id } = await createConversation(db);
    expect((await act(id, { action: "delete_everything" })).status).toBe(400);
    expect((await act("c_missing", { action: "close" })).status).toBe(404);
  });
});
