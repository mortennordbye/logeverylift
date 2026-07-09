/**
 * Verifies the MCP tool modules register the expected tools without throwing.
 *
 * This exercises the registration code paths (which only run on an authenticated
 * MCP request at runtime, after the 401 gate) and guards against wiring
 * regressions — a renamed/dropped tool or a bad registerTool() call fails here.
 * It does not hit the database; handlers are registered but not invoked.
 */

import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

// The tool modules import `@/db`, which validates DB env vars at import time.
// Registration never touches the database, so stub the client out.
vi.mock("@/db", () => ({ db: {} }));

function collect(register: (s: McpServer, userId: string) => void) {
  const names: string[] = [];
  const stub = {
    registerTool(name: string) {
      names.push(name);
    },
  } as unknown as McpServer;
  register(stub, "test-user");
  return names;
}

describe("MCP tool registration", () => {
  it("registers the profile & weight tools", () => {
    expect(collect(registerProfileTools).sort()).toEqual(
      ["get_profile", "manage_weight", "update_profile"].sort(),
    );
  });

  it("registers the program tools", () => {
    expect(collect(registerProgramTools).sort()).toEqual(
      [
        "list_programs",
        "get_program",
        "create_program",
        "update_program",
        "delete_program",
        "edit_program_exercise",
      ].sort(),
    );
  });

  it("registers the training-cycle tools", () => {
    expect(collect(registerCycleTools).sort()).toEqual(
      [
        "list_training_cycles",
        "get_training_cycle",
        "manage_training_cycle",
        "edit_cycle_slot",
      ].sort(),
    );
  });
});
