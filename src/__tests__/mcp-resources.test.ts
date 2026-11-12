/**
 * MCP resources and server instructions (docs/plans/mcp-access.md, 2.3-2.4).
 * The e2e spec e2e/mcp-oauth.spec.ts reads the same resources from the
 * standalone production build.
 */

import { serverInstructions } from "@/lib/mcp/instructions";
import { MCP_RESOURCE_DOCS } from "@/lib/mcp/resource-docs";
import { docDate, docVersion, loadResourceDocs, registerResources, servedText } from "@/lib/mcp/resources";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("resource docs", () => {
  it.each(MCP_RESOURCE_DOCS.map((d) => [d.uri, d]))("%s states a date and gets a date+hash version", (_uri, doc) => {
    const raw = readFileSync(path.join(process.cwd(), doc.path), "utf8");
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
    expect(docDate(raw)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(docVersion(raw)).toBe(`${docDate(raw)}+${hash}`);
  });

  it("serves the text without the repo-only doc-claims marker, with the version on top", () => {
    const raw = "<!-- doc-claims: skip — a reason. -->\n\n> Research done 2026-11-12.\n\n# Title\n";
    expect(servedText(raw, "2026-11-12+abc")).toBe("<!-- version 2026-11-12+abc -->\n> Research done 2026-11-12.\n\n# Title\n");
  });

  it("registers each doc with its version and returns its text on read", async () => {
    const registered: { name: string; uri: string; meta: { _meta?: { version?: string } }; read: (u: URL) => Promise<{ contents: { text: string }[] }> }[] = [];
    const server = {
      registerResource: (name: string, uri: string, meta: never, read: never) => registered.push({ name, uri, meta, read }),
    } as unknown as McpServer;
    const docs = await loadResourceDocs();
    registerResources(server, docs);
    expect(registered.map((r) => r.uri)).toEqual(MCP_RESOURCE_DOCS.map((d) => d.uri));
    for (const [i, r] of registered.entries()) {
      const raw = readFileSync(path.join(process.cwd(), MCP_RESOURCE_DOCS[i].path), "utf8");
      expect(r.meta._meta?.version).toBe(docVersion(raw));
      const { contents } = await r.read(new URL(r.uri));
      expect(contents[0].text).toContain(`version ${docVersion(raw)}`);
      expect(contents[0].text).not.toContain("doc-claims:");
    }
  });

  it("traces every doc into the standalone build", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/api/[transport]"]).toEqual(
      MCP_RESOURCE_DOCS.map((d) => `./${d.path}`),
    );
  });
});

describe("server instructions", () => {
  it("name both resources and the weekly review, and say what each access level may do", () => {
    for (const access of ["read", "write"] as const) {
      const text = serverInstructions(access);
      for (const doc of MCP_RESOURCE_DOCS) expect(text).toContain(doc.uri);
      expect(text).toContain("weekly review");
      expect(text).toContain("expectedVersion");
      expect(text).toContain("restore_revision");
    }
    expect(serverInstructions("read")).toContain("read only");
    expect(serverInstructions("write")).toContain("can read and change");
  });
});
