export interface KbChunk {
  slug: string;
  title: string;
  heading: string;
  content: string;
}

/**
 * Splits a markdown document into one chunk per "##" section (the intro becomes its own
 * chunk). Sections in the knowledge base are short policy units, so section-level chunks
 * keep each rule together with its numbers and give clean citations.
 */
export function chunkMarkdown(slug: string, markdown: string): KbChunk[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) ?? `# ${slug}`).slice(2).trim();
  const chunks: KbChunk[] = [];
  let heading = "Overview";
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) chunks.push({ slug, title, heading, content });
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      flush();
      heading = line.slice(3).trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return chunks;
}
