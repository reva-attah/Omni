import React, { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";

export function Login({ accessDenied = false, accessEmail, onSignOut }) {
  const { signIn, signOut } = useAuthActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSending(true);
    try {
      const formData = new FormData();
      formData.set("email", email.trim().toLowerCase());
      formData.set("password", password);
      formData.set("flow", "signIn");
      await signIn("password", formData);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const detail = typeof err?.data === "string" ? err.data : message;
      if (/InvalidSecret|Incorrect email or password/i.test(detail)) {
        setError("Vanta did not accept this email and password. Check your Vanta Production credentials.");
      } else if (/InvalidAccountId/i.test(detail)) {
        setError("No Vanta Production account was found for this email. Contact your Vanta administrator if you need an account.");
      } else {
        setError("Omni could not complete Vanta sign-in. Check your credentials and try again.");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-5 py-12 flex items-center justify-center">
      <section className="w-full max-w-md rounded-2xl border border-border bg-surface-container-lowest p-8 shadow-lg">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <span className="material-symbols-outlined">insights</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-on-surface">Omni</h1>
            <p className="text-sm text-secondary">Venture Intelligence</p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-on-surface">Sign in with Vanta</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">
          Use your Vanta Production account. Omni access is limited to Trium work email addresses.
        </p>
        {accessDenied && (
          <div role="alert" className="mt-4 space-y-2 text-sm text-error">
            <p>This Vanta account is not authorized for Omni{accessEmail ? ` (${accessEmail})` : ""}. Contact your Trium administrator if you believe access should be enabled.</p>
            <button type="button" onClick={onSignOut ?? (() => void signOut())} className="font-semibold underline underline-offset-2">Sign out of Vanta</button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-on-surface" htmlFor="email">Work email</label>
            <input id="email" name="email" type="email" autoComplete="username" required value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-border bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="name@trium.ng" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-on-surface" htmlFor="password">Vanta password</label>
            <div className="relative mt-1">
              <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface-container-low px-3 pr-16 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-3 my-auto h-fit text-xs font-semibold text-secondary hover:text-on-surface">
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <button type="submit" disabled={sending || !email.trim() || !password}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60">
            {sending ? "Signing in…" : "Sign in with Vanta"}
          </button>
        </form>
        <p className="mt-4 text-xs leading-5 text-secondary">
          For password recovery or Vanta account access, use Vanta’s approved account recovery process or contact your Vanta administrator.
        </p>
      </section>
    </main>
  );
}

export default Login;
