"use client";

import { ConsentChecks, type ConsentState } from "@/components/features/ConsentChecks";
import { redeemFriendCode } from "@/lib/actions/friend-invites";
import { registerWithToken } from "@/lib/actions/invite-tokens";
import { acceptTerms } from "@/lib/actions/legal";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import { authClient } from "@/lib/auth-client";
import { callAction } from "@/lib/utils/stale-bundle";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function SignupForm() {
  // Invite links (/signup?token=...) still go through registerWithToken so the
  // token's use is counted; everyone else signs up directly.
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token")?.trim() ?? "";
  // A friend's share link (/welcome?ref=...): the new account starts as their friend.
  const friendCode = searchParams.get("ref")?.trim() ?? "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<ConsentState>({ terms: false, healthData: false });

  // The account exists and is signed in by now. If this write fails, the home
  // screen asks again (src/app/consent), so it never blocks the sign-up.
  async function recordConsent() {
    await callAction(acceptTerms({ version: LEGAL_VERSION, ...consent })).catch(() => {});
  }

  // Also after sign-in. A failure only means starting without the friend.
  async function connectInviter() {
    if (friendCode) await callAction(redeemFriendCode({ code: friendCode })).catch(() => {});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) return;
    if (!consent.terms || !consent.healthData) {
      setError("Please tick both boxes to create an account.");
      return;
    }

    setLoading(true);
    setError("");

    if (inviteToken) {
      const result = await callAction(registerWithToken(inviteToken, name, email, password));
      if (!result.success) {
        setError(result.error);
        setLoading(false);
        return;
      }
      const signInResult = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
      // Account was created; fall back to signing in manually.
      if (!signInResult.error) {
        await recordConsent();
        await connectInviter();
      }
      window.location.href = signInResult.error ? "/login" : "/";
      return;
    }

    // Signs the new user in on success (better-auth autoSignIn).
    const result = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
    });

    if (result.error) {
      setError(
        result.error.status === 429
          ? "Too many attempts. Please try again later."
          : result.error.code === "USER_ALREADY_EXISTS"
            ? "An account with this email already exists."
            : (result.error.message ?? "Failed to create account. Please try again."),
      );
      setLoading(false);
      return;
    }

    await recordConsent();
    await connectInviter();
    window.location.href = "/";
  }

  return (
    <form method="post" onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary transition-shadow"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary transition-shadow"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary transition-shadow"
        />
      </div>

      <ConsentChecks value={consent} onChange={(v) => { setConsent(v); setError(""); }} />

      {friendCode && (
        <p className="text-sm text-muted-foreground">
          You&apos;ll start as friends with the person who invited you. You can remove them in Friends.
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground active:opacity-80 disabled:opacity-50 transition-opacity"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Creating account…
          </>
        ) : (
          "Create Account"
        )}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary font-medium">
          Sign in
        </Link>
      </p>
    </form>
  );
}
