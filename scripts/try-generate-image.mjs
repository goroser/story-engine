import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [storyId, chunkId, refChunkId] = process.argv.slice(2);
if (!storyId || !chunkId) {
  console.error("usage: node scripts/try-generate-image.mjs <story_id> <chunk_id> [reference_chunk_id]");
  process.exit(1);
}

const client = new Client({ name: "try-generate-image", version: "0.0.1" });
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  cwd: process.cwd(),
});
await client.connect(transport);

const res = await client.callTool({
  name: "generate_image",
  arguments: refChunkId
    ? { story_id: storyId, chunk_id: chunkId, reference_chunk_id: refChunkId }
    : { story_id: storyId, chunk_id: chunkId },
});

console.log("isError:", res.isError ?? false);
console.log(res.content[0].text);

await client.close();
