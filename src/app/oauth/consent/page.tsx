import { OAuthConsentForm } from "@/components/features/OAuthConsentForm";
import { db } from "@/db";
import { oauthClients } from "@/db/schema";
import { auth } from "@/lib/auth";
import { garminAllowed } from "@/lib/garmin/access";
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/lib/mcp/scopes";
import { requireSession } from "@/lib/utils/session";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";

/**
 * Where the OAuth provider sends a signed-in user to approve an MCP client
 * (an AI assistant) before it gets a token for /api/mcp. The query is signed
 * by Better Auth; anything else is refused rather than shown.
 *
 * The user picks the access level here (docs/plans/mcp-access.md, 2.1). The
 * provider only lets consent narrow the requested scopes, so read and change
 * is offered only when the client asked for mcp:write.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }

  const { secret } = await auth.$context;
  const clientId = query.get("client_id");
  const valid = clientId !== null && (await verifyOAuthQueryParams(query.toString(), secret));
  const [client] = valid
    ? await db.select({ name: oauthClients.name }).from(oauthClients).where(eq(oauthClients.clientId, clientId))
    : [];
  const requested = (query.get("scope") ?? "").split(" ").filter(Boolean);
  const garmin = garminAllowed((session.user as { role?: string }).role);

  return (
    <div className="h-[100dvh] overflow-y-auto bg-background">
      <div className="mx-auto max-w-md px-6 pt-16 pb-16 flex flex-col gap-6">
        {client ? (
          <>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Connect {client.name ?? "an AI assistant"}?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                It will be able to read your profile and body weight, your programs, training cycles with their dated sessions, seasons and races with
                their change history, your structured workouts, planned versus done for each session, your coach memory,
                your thresholds and athlete profile with any injuries and sick periods you entered, your fuel logs, sweat tests
                and race plans, and your workout
                history: sets, weights, heart rate zones, effort, how you felt, your readiness, and the notes you write on
                workouts, sets and exercises.
                {garmin && " It can also read data from your Garmin account: readiness, sleep, heart rate, training load and activities."}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                With read and change access it can also change your profile, body weight, programs, cycles, dated sessions (move, skip
                or add one), seasons, races and structured workouts, write coach memory, thresholds, your athlete profile, injuries and
                sick periods, log fuel and sweat tests, change race plans, mark a planned session as done or missed, create custom exercises, log workouts you did, and restore earlier versions of
                your programs, cycles and seasons. Changes apply at once, and each plan change is kept in the plan&apos;s history, where you can
                undo it. You can disconnect it at any time in More → Connected assistants.
              </p>
            </div>
            <OAuthConsentForm
              requestedScopes={requested}
              canRead={requested.includes(MCP_READ_SCOPE)}
              canWrite={requested.includes(MCP_WRITE_SCOPE)}
            />
          </>
        ) : (
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Link expired</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This connection request is no longer valid. Start connecting again from your AI assistant.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
