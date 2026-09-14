// Generic helper: call any story-engine tool over a real MCP stdio connection.
// usage: node scripts/try-tool.mjs <tool_name> '<json args>'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [toolName, argsJson] = process.argv.slice(2);
if (!toolName) {
  console.error("usage: node scripts/try-tool.mjs <tool_name> '<json args>'");
  process.exit(1);
}
const args = argsJson ? JSON.parse(argsJson) : {};

const client = new Client({ name: "try-tool", version: "0.0.1" });
const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"], cwd: process.cwd() });
await client.connect(transport);

const res = await client.callTool({ name: toolName, arguments: args });
console.log("isError:", res.isError ?? false);
console.log(res.content[0].text);

await client.close();
