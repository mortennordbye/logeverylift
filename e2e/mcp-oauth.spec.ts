import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";

// The flow an MCP client (Claude, ChatGPT) runs to connect: discover the
// authorization server from the endpoint's 401, register, send the user
// through consent, swap the code for a token, call a tool.
//
// It runs against the standalone production build (scripts/e2e-serve.sh), the
// same files the Docker image ships, so reading the resources here is the test
// that the docs reach production (docs/plans/mcp-access.md, 2.4).
//
// The browser is already signed in (the worker's storage state). Signing in
// through the form here would spend the per-IP sign-in budget the whole suite
// shares; the login page's hand-back to the flow is covered by
// src/__tests__/sign-in-redirect.test.ts.

// Stands in for the assistant's own callback; page.route answers it. Port 9
// would be simpler, but WebKit refuses restricted ports before any request.
const CALLBACK = "http://127.0.0.1:59231/mcp-callback";

async function discover(request: APIRequestContext) {
  const unauthenticated = await request.post("/api/mcp", {
    headers: { accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(unauthenticated.status()).toBe(401);
  const challenge = unauthenticated.headers()["www-authenticate"] ?? "";
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  expect(metadataUrl, challenge).toBeTruthy();

  const resource = await (await request.get(metadataUrl!)).json();
  const issuer = new URL(resource.authorization_servers[0]);
  const server = await (
    await request.get(`/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, "")}`)
  ).json();
  return { resource: resource.resource as string, server };
}

async function register(request: APIRequestContext, registrationEndpoint: string, name: string) {
  // Better Auth allows five registrations a minute per IP, and every worker
  // shares one; with --repeat-each a 429 is waited out, not a finding. Every
  // attempt counts against the limit, so retries are spaced out.
  let clientId = "";
  await expect(async () => {
    const res = await request.post(registrationEndpoint, {
      data: {
        client_name: name,
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    clientId = (await res.json()).client_id;
  }).toPass({ timeout: 130_000, intervals: [30_000, 30_000, 60_000] });
  return clientId;
}

/** Open the authorize URL; returns the PKCE verifier for the token request. */
async function authorize(page: Page, server: { authorization_endpoint: string }, clientId: string, resource: string) {
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(server.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    scope: "openid offline_access mcp:read mcp:write",
    state: "s-123",
    resource,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  await page.goto(url.toString());
  return verifier;
}

// One client for the whole flow, to stay inside the registration rate limit.
test("an MCP client connects through consent and calls a tool with its token", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(180_000);
  // The client's own HTTP calls carry no browser cookies, as a real one's don't.
  const request = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const { resource, server } = await discover(request);
  const clientId = await register(request, server.registration_endpoint, "E2E Assistant");

  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ body: "callback" }));

  // Deny first; a denial stores no consent, so the second round asks again.
  await authorize(page, server, clientId, resource);
  await expect(page.getByRole("heading", { name: "Connect E2E Assistant?" })).toBeVisible();
  await page.getByRole("button", { name: "Deny" }).click();
  await page.waitForURL(`${CALLBACK}**`);
  const refused = new URL(page.url());
  expect(refused.searchParams.get("error")).toBe("access_denied");
  expect(refused.searchParams.get("code")).toBeNull();

  const verifier = await authorize(page, server, clientId, resource);
  await expect(page.getByRole("heading", { name: "Connect E2E Assistant?" })).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL(`${CALLBACK}**`);
  const back = new URL(page.url());
  expect(back.searchParams.get("state")).toBe("s-123");
  const code = back.searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenRes = await request.post(server.token_endpoint, {
    form: {
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: CALLBACK,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    },
  });
  expect(tokenRes.status(), await tokenRes.text()).toBe(200);
  const { access_token } = await tokenRes.json();

  // One JSON-RPC call; the endpoint answers as JSON or as one SSE event.
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await request.post("/api/mcp", {
      headers: { authorization: `Bearer ${access_token}`, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method, params },
    });
    const text = await res.text();
    const json = text.startsWith("{") ? text : /^data: (.*)$/m.exec(text)?.[1];
    return { status: res.status(), body: json ? JSON.parse(json) : null, text };
  };

  // Read only was preselected.
  const tools = await rpc("tools/list");
  expect(tools.status).toBe(200);
  expect(tools.text).toContain("get_profile");
  const profile = await rpc("tools/call", { name: "get_profile", arguments: {} });
  expect(profile.body.result.isError, profile.text).toBeFalsy();
  const write = await rpc("tools/call", { name: "update_profile", arguments: { name: "Changed by assistant" } });
  expect(write.body.result.isError).toBe(true);
  expect(write.body.result.content[0].text).toContain("This connection is read-only");
  // The AI coach tools are listed, and a write among them refuses here too.
  for (const name of ["search_exercises", "log_session", "get_coach_memory", "manage_coach_memory"]) expect(tools.text).toContain(name);
  const memory = await rpc("tools/call", {
    name: "manage_coach_memory",
    arguments: { operation: "add", kind: "preference", text: "Long rides on Saturday", reason: "e2e" },
  });
  expect(memory.body.result.isError).toBe(true);
  expect(memory.body.result.content[0].text).toContain("This connection is read-only");
  // The athlete profile tools (docs/plans/athlete-profile.md, 2.8): thresholds for every user, and the prompt.
  for (const name of ["get_athlete_profile", "manage_thresholds"]) expect(tools.text).toContain(name);
  const threshold = await rpc("tools/call", {
    name: "manage_thresholds",
    arguments: { operation: "add", kind: "ftp", watts: 250, source: "manual", reason: "e2e" },
  });
  expect(threshold.body.result.isError).toBe(true);
  expect(threshold.body.result.content[0].text).toContain("This connection is read-only");
  const prompts = await rpc("prompts/list");
  expect(prompts.text).toContain("intake_interview");

  // The server instructions and both resources, read from the production build.
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  expect(init.body.result.instructions).toContain("weekly review");
  const listed = await rpc("resources/list");
  const uris = listed.body.result.resources.map((r: { uri: string }) => r.uri);
  expect(uris).toEqual(["logeverylift://docs/endurance-training-reference", "logeverylift://docs/app-rules", "logeverylift://docs/workout-steps"]);
  for (const uri of uris) {
    const read = await rpc("resources/read", { uri });
    expect(read.body.result?.contents?.[0]?.text, read.text).toMatch(/^<!-- version \d{4}-\d{2}-\d{2}\+[0-9a-f]{12} -->/);
  }

  // Disconnect in the app; the same token stops working at once.
  await page.goto("/more/assistants");
  await expect(page.getByText("E2E Assistant")).toBeVisible();
  await expect(page.getByText(/Read only · Connected/)).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await page.getByRole("button", { name: "Disconnect" }).last().click();
  await expect(page.getByTestId("assistants-empty")).toBeVisible();
  expect((await rpc("tools/list")).status).toBe(401);
  await request.dispose();
});
