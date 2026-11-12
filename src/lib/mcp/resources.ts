/**
 * MCP resources: the docs in src/lib/mcp/resource-docs.ts, read from disk and
 * versioned with their source.
 *
 * The version is `<date>+<hash>`: the date the doc states near its top and the
 * first 12 hex characters of the file's SHA-256. The hash changes with any
 * edit; the date says when the content was last reviewed.
 *
 * Files are read from the working directory. In production that is the
 * standalone build, which holds them because next.config.ts traces them in.
 */

import { MCP_RESOURCE_DOCS } from "@/lib/mcp/resource-docs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

type LoadedDoc = { text: string; version: string };

const MIME = "text/markdown";
const cache = new Map<string, Promise<LoadedDoc | null>>();

/** The first YYYY-MM-DD in the doc's first lines. */
export function docDate(raw: string): string | null {
  return /\d{4}-\d{2}-\d{2}/.exec(raw.split("\n").slice(0, 10).join("\n"))?.[0] ?? null;
}

export function docVersion(raw: string): string {
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `${docDate(raw) ?? "undated"}+${hash}`;
}

/** The text served: the repo-only doc-claims marker removed, a version line on top. */
export function servedText(raw: string, version: string): string {
  const body = raw.replace(/^<!--\s*doc-claims:[^\n]*-->\n+/, "");
  return `<!-- version ${version} -->\n${body}`;
}

async function load(docPath: string): Promise<LoadedDoc | null> {
  try {
    const raw = await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), docPath), "utf8");
    const version = docVersion(raw);
    return { text: servedText(raw, version), version };
  } catch {
    console.error("[mcp:resource] missing", { path: docPath });
    return null;
  }
}

function loadCached(docPath: string): Promise<LoadedDoc | null> {
  let hit = cache.get(docPath);
  if (!hit) {
    hit = load(docPath);
    cache.set(docPath, hit);
  }
  return hit;
}

/** Read every doc once per process, so listing can show each version. */
export async function loadResourceDocs() {
  return Promise.all(MCP_RESOURCE_DOCS.map(async (doc) => ({ ...doc, loaded: await loadCached(doc.path) })));
}

export function registerResources(server: McpServer, docs: Awaited<ReturnType<typeof loadResourceDocs>>) {
  for (const doc of docs) {
    const version = doc.loaded?.version ?? "unavailable";
    server.registerResource(
      doc.name,
      doc.uri,
      {
        title: doc.title,
        description: `${doc.description} Version ${version}.`,
        mimeType: MIME,
        _meta: { version },
      },
      async (uri) => {
        if (!doc.loaded) throw new Error(`Resource ${doc.uri} is not available on this server.`);
        return { contents: [{ uri: uri.href, mimeType: MIME, text: doc.loaded.text, _meta: { version } }] };
      },
    );
  }
}
