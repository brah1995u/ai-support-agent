import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "@/server/rag/chunk";

describe("chunkMarkdown", () => {
  it("splits by ## sections and keeps the document title", () => {
    const chunks = chunkMarkdown("refunds", "# Refunds\n\nIntro text.\n\n## Flex fare\n- 100% refund\n\n## Basic fare\n- 10 EUR fee\n");
    expect(chunks.map((c) => c.heading)).toEqual(["Overview", "Flex fare", "Basic fare"]);
    expect(chunks.every((c) => c.title === "Refunds" && c.slug === "refunds")).toBe(true);
    expect(chunks[1].content).toBe("- 100% refund");
  });

  it("skips empty sections", () => {
    expect(chunkMarkdown("x", "# X\n\n## Empty\n\n## Full\ntext")).toHaveLength(1);
  });
});
