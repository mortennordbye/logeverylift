-- MCP access levels (docs/plans/mcp-access.md, section 3). Data only, idempotent.
-- Let clients registered before the scopes existed request them: authorize
-- checks requested scopes against this list.
UPDATE "oauth_client" SET "scopes" = array_cat("scopes", ARRAY['mcp:read','mcp:write'])
  WHERE "scopes" IS NOT NULL AND NOT ('mcp:read' = ANY("scopes"));
--> statement-breakpoint
-- Connections approved under the old consent text hold no mcp scope: end them,
-- so each assistant connects again and the user picks its access level.
UPDATE "oauth_refresh_token" SET "revoked" = now()
  WHERE "revoked" IS NULL AND NOT ('mcp:read' = ANY("scopes"));
--> statement-breakpoint
DELETE FROM "oauth_consent" WHERE NOT ('mcp:read' = ANY("scopes"));
