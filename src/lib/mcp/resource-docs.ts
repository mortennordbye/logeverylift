/**
 * The docs the MCP server serves as resources (docs/plans/mcp-access.md, 2.4).
 *
 * `next.config.ts` imports this list for `outputFileTracingIncludes`, so each
 * file is copied into the standalone build the Docker image runs. Keep this
 * module free of path aliases and Node imports: the config loads it directly.
 */

export const MCP_RESOURCE_DOCS = [
  {
    name: "endurance-training-reference",
    uri: "logeverylift://docs/endurance-training-reference",
    path: "docs/research/endurance-training-reference.md",
    title: "Endurance training reference",
    description:
      "The training rules (periodization, zones, load, recovery, strength, nutrition, workout data models) with an evidence label on each. Read before planning or changing endurance training.",
  },
  {
    name: "app-rules",
    uri: "logeverylift://docs/app-rules",
    path: "docs/mcp/app-rules.md",
    title: "LogEveryLift rules for assistants",
    description:
      "How the app's data fits together, which writer owns which field, and what the app cannot do yet. Read before the first change in a conversation.",
  },
] as const;
