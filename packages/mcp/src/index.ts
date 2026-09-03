import { createInterface } from "node:readline";
import { TOOL_DEFS, callTool } from "./tools.js";

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function reply(id: RpcRequest["id"], result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function replyError(id: RpcRequest["id"], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(req: RpcRequest): Promise<string | null> {
  // Notifications (no id) get no response.
  if (req.id === undefined || req.id === null) {
    return null;
  }
  switch (req.method) {
    case "initialize":
      return reply(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "caste-mcp", version: "1.0.0" },
      });
    case "ping":
      return reply(req.id, {});
    case "tools/list":
      return reply(req.id, { tools: TOOL_DEFS });
    case "tools/call": {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!params.name) return replyError(req.id, -32602, "params.name is required");
      try {
        const content = await callTool(params.name, params.arguments as Record<string, never>);
        return reply(req.id, {
          content: [{ type: "text", text: JSON.stringify(content, null, 2) }],
        });
      } catch (err) {
        return reply(req.id, {
          content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }],
          isError: true,
        });
      }
    }
    default:
      return replyError(req.id, -32601, `method not found: ${req.method}`);
  }
}

export async function serveStdio(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: RpcRequest;
    try {
      req = JSON.parse(line) as RpcRequest;
    } catch {
      process.stdout.write(replyError(null, -32700, "parse error") + "\n");
      continue;
    }
    const out = await handle(req);
    if (out !== null) process.stdout.write(out + "\n");
  }
}

// Only auto-start when run as the main module (tests import handlers directly).
const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  serveStdio().catch((err) => {
    process.stderr.write(`caste-mcp fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
