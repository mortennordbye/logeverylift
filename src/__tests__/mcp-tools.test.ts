/**
 * Verifies the MCP tool modules register the expected tools without throwing.
 *
 * This exercises the registration code paths (which only run on an authenticated
 * MCP request at runtime, after the 401 gate) and guards against wiring
 * regressions — a renamed/dropped tool or a bad registerTool() call fails here.
 * It does not hit the database; handlers are registered but not invoked.
 */

import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerGarminTools } from "@/lib/mcp/tools/garmin";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { registerWorkoutTools } from "@/lib/mcp/tools/workouts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

// The tool modules import `@/db`, which validates DB env vars at import time.
// Registration never touches the database, so stub the client out.
vi.mock("@/db", () => ({ db: {} }));

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

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
  it("registers the Garmin tools, all read-only", () => {
    const tools: { name: string; annotations: unknown }[] = [];
    const stub = {
      registerTool(name: string, config: { annotations?: unknown }) {
        tools.push({ name, annotations: config.annotations });
      },
    } as unknown as McpServer;
    registerGarminTools(stub, "test-user");
    expect(tools.map((t) => t.name).sort()).toEqual(["get_garmin_activity", "get_garmin_status", "get_garmin_trends", "list_garmin_activities"]);
    for (const t of tools) expect(t.annotations).toEqual(READ_ONLY);
  });

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
        // The revision tools register with the program tools (docs/plans/revisions.md, 2.10).
        "list_revisions",
        "restore_revision",
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

  it("registers the workout history tools, every one of them read-only", () => {
    const tools: { name: string; annotations: unknown }[] = [];
    const stub = {
      registerTool(name: string, config: { annotations: unknown }) {
        tools.push({ name, annotations: config.annotations });
      },
    } as unknown as McpServer;

    registerWorkoutTools(stub, "test-user");

    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "exercise_history",
        "personal_records",
        "recent_workouts",
        "summary_stats",
        "weekly_volume",
      ].sort(),
    );
    for (const tool of tools) expect(tool.annotations).toEqual(READ_ONLY);
  });
});
