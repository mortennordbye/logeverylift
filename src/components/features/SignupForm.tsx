"use client";

import { validateInviteToken, registerWithToken } from "@/lib/actions/invite-tokens";
import { authClient } from "@/lib/auth-client";
import { ChevronLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

type Step = "token" | "details";

export function SignupForm() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("token");
  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [validatedToken, setValidatedToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;

    setLoading(true);
    setError("");

    const result = await validateInviteToken(token.trim());

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setValidatedToken(token.trim());
    setStep("details");
    setLoading(false);
  }

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) return;

    setLoading(true);
    setError("");

    const result = await registerWithToken(validatedToken, name, email, password);

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    // Sign in after account creation
    const signInResult = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInResult.error) {
      // Account was created — redirect to login to sign in manually
      window.location.href = "/login";
      return;
    }

    window.location.href = "/";
  }

  if (step === "token") {
    return (
      <form onSubmit={handleTokenSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="token" className="text-sm font-medium">
            Invite token
          </label>
          <input
            id="token"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter your invite token"
            className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary transition-shadow"
          />
        </div>

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
              Verifying…
            </>
          ) : (
            "Continue"
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

  return (
    <form onSubmit={handleDetailsSubmit} className="space-y-4">
      <button
        type="button"
        onClick={() => { setStep("token"); setError(""); }}
        className="flex items-center gap-0.5 text-sm text-primary active:opacity-70 -ml-1 mb-2"
      >
        <ChevronLeft className="w-4 h-4" />
        Back
      </button>

      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          required
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Choose a password"
          className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary transition-shadow"
        />
      </div>

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
    </form>
  );
}
