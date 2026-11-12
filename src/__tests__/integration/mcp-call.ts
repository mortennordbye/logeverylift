import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
type Register = (server: McpServer, userId: string) => void;

/**
 * One tool group as one token's holder reaches it. The input is parsed with
 * the tool's own schema first, as the MCP SDK does before it calls the
 * handler, so defaults apply and a key the schema refuses fails here too.
 */
export function mcpTools(register: Register, userId: string) {
  const tools = new Map<string, { schema: z.ZodTypeAny; handler: Handler }>();
  register(
    {
      registerTool: (name: string, config: { inputSchema: z.ZodRawShape }, handler: Handler) =>
        tools.set(name, { schema: z.object(config.inputSchema), handler }),
    } as unknown as McpServer,
    userId,
  );
  return async (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) return { isError: true, raw: parsed.error.message, data: null };
    const result = await tool.handler(parsed.data as Record<string, unknown>);
    const raw = result.content[0].text;
    return { isError: result.isError ?? false, raw, data: result.isError ? null : JSON.parse(raw) };
  };
}
