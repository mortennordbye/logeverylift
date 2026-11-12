/**
 * MCP access levels (docs/plans/mcp-access.md, 2.1): the scope rule, the
 * consent page's narrowing, and which tools count as reads. Integration tests
 * (src/__tests__/integration/mcp-scopes.test.ts) run the tools for real.
 */

import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerGarminTools } from "@/lib/mcp/tools/garmin";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { registerWorkoutTools } from "@/lib/mcp/tools/workouts";
import {
  READ_ONLY_REFUSAL,
  accessFromScopes,
  consentScope,
  effectiveAccess,
  isReadTool,
  scopedServer,
} from "@/lib/mcp/scopes";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const READ_TOOLS = [
  "exercise_history",
  "get_garmin_activity",
  "get_garmin_status",
  "get_garmin_trends",
  "get_profile",
  "get_program",
  "get_training_cycle",
  "list_garmin_activities",
  "list_programs",
  "list_training_cycles",
  "personal_records",
  "recent_workouts",
  "summary_stats",
  "weekly_volume",
];
const WRITE_TOOLS = [
  "create_program",
  "delete_program",
  "edit_cycle_slot",
  "edit_program_exercise",
  "manage_training_cycle",
  "manage_weight",
  "update_profile",
  "update_program",
];

type Registered = { name: string; config: { description?: string; annotations?: object }; handler: () => unknown };

function registerAll(wrap: (s: McpServer) => McpServer = (s) => s) {
  const tools: Registered[] = [];
  const base = {
    registerTool: (name: string, config: Registered["config"], handler: Registered["handler"]) =>
      tools.push({ name, config, handler }),
  } as unknown as McpServer;
  const server = wrap(base);
  for (const register of [registerProfileTools, registerProgramTools, registerCycleTools, registerWorkoutTools, registerGarminTools]) {
    register(server, "test-user");
  }
  return tools;
}

describe("effectiveAccess", () => {
  it("is the token narrowed by the consent", () => {
    expect(effectiveAccess("openid mcp:read mcp:write", ["openid", "mcp:read", "mcp:write"])).toBe("write");
    expect(effectiveAccess("openid mcp:read mcp:write", ["openid", "mcp:read"])).toBe("read");
    expect(effectiveAccess("openid mcp:read", ["openid", "mcp:read", "mcp:write"])).toBe("read");
  });

  it("gives nothing without a consent or without an mcp scope", () => {
    expect(effectiveAccess("mcp:read mcp:write", null)).toBeNull();
    expect(effectiveAccess("openid offline_access", ["openid", "offline_access"])).toBeNull();
    expect(effectiveAccess(undefined, ["mcp:read"])).toBeNull();
  });

  it("reads a consent's own level", () => {
    expect(accessFromScopes(["openid", "mcp:read", "mcp:write"])).toBe("write");
    expect(accessFromScopes(["mcp:read"])).toBe("read");
    expect(accessFromScopes(["openid"])).toBeNull();
  });
});

describe("consentScope", () => {
  const requested = ["openid", "offline_access", "mcp:read", "mcp:write"];

  it("drops mcp:write for read only and keeps the rest of the request", () => {
    expect(consentScope(requested, "read")).toBe("openid offline_access mcp:read");
    expect(consentScope(requested, "write")).toBe("openid offline_access mcp:read mcp:write");
  });
});

describe("tool classification", () => {
  it("counts exactly the read-only tools as reads, by their annotation", () => {
    const tools = registerAll();
    expect(tools.filter((t) => isReadTool(t.config)).map((t) => t.name).sort()).toEqual(READ_TOOLS);
    expect(tools.filter((t) => !isReadTool(t.config)).map((t) => t.name).sort()).toEqual(WRITE_TOOLS);
  });

  it("treats a tool with no hint as a write tool", () => {
    expect(isReadTool({})).toBe(false);
    expect(isReadTool({ annotations: { idempotentHint: true } as object })).toBe(false);
  });
});

describe("scopedServer", () => {
  // Each registration makes fresh closures and schemas, so compare what they say.
  const same = (t: Registered) => [t.name, t.config.description, t.config.annotations, String(t.handler)];

  it("passes every tool through unchanged with write access", () => {
    const base = {} as McpServer;
    expect(scopedServer(base, "write")).toBe(base);
    expect(registerAll((s) => scopedServer(s, "write")).map(same)).toEqual(registerAll().map(same));
  });

  it("keeps write tools listed but swaps their handler for a refusal under read only", async () => {
    const plain = new Map(registerAll().map((t) => [t.name, t]));
    const scoped = registerAll((s) => scopedServer(s, "read"));
    expect(scoped.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    for (const tool of scoped) {
      if (READ_TOOLS.includes(tool.name)) {
        expect(same(tool)).toEqual(same(plain.get(tool.name)!));
        continue;
      }
      expect(String(tool.handler)).not.toBe(String(plain.get(tool.name)!.handler));
      expect(tool.config.description).toContain("this connection is read-only");
      expect(await tool.handler()).toEqual({ content: [{ type: "text", text: `Error: ${READ_ONLY_REFUSAL}` }], isError: true });
    }
  });
});
