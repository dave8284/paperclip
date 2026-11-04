import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { CloudSignIn } from "@/components/CloudSignIn";
import { clearCloudSignInAttempt } from "@/lib/cloud-sign-in";
import { tenantSignInReturnPath } from "@/lib/cloudLinks";
import { queryKeys } from "../lib/queryKeys";
import { getRememberedInvitePath } from "../lib/invite-memory";
import { Button } from "@/components/ui/button";
import { AgentOSBrand } from "@/components/AgentOSBrand";
import { FridayOrb } from "@/components/FridayOrb";
import { AgentOSLoading } from "@/components/AgentOSLoading";
import { useTheme } from "@/context/ThemeContext";
import { administrationApi } from "@/api/administration";
import { navigateTopLevel } from "@/lib/browserNavigation";

type AuthMode = "sign_in" | "sign_up";

export function AuthPage() {
  const { setTheme } = useTheme();
  useEffect(() => setTheme("light"), [setTheme]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(() => searchParams.get("mode") === "sign_up" ? "sign_up" : "sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = "auth-error";
  const options = useQuery({ queryKey: ["public-auth-options"], queryFn: administrationApi.authOptions, retry: false, refetchOnMount: "always" });
  const passwordEnabled = options.data?.passwordSignInEnabled === true && !options.error;
  const signUpEnabled = passwordEnabled && options.data?.passwordSignUpEnabled === true;
  const formMode: AuthMode = mode === "sign_up" && signUpEnabled ? "sign_up" : "sign_in";
  const google = useMutation({ mutationFn: () => authApi.signInGoogle(nextPath), onSuccess: navigateTopLevel,
    onError: (failure: Error) => setError(failure.message) });

  const nextPath = useMemo(
    () => tenantSignInReturnPath(searchParams.get("next") || getRememberedInvitePath() || "/"),
    [searchParams],
  );
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const { data: session, isLoading: isSessionLoading, error: sessionError } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) {
      clearCloudSignInAttempt();
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!passwordEnabled || options.isFetching) throw new Error("Password sign-in is unavailable.");
      if (formMode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }
      await authApi.signUpEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });
    },
    onSuccess: async () => {
      setError(null);
      queryClient.removeQueries({ queryKey: ["registration"] });
      queryClient.removeQueries({ queryKey: ["administration"] });
      await queryClient.resetQueries({ queryKey: queryKeys.access.currentBoardAccess });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.health });
      // Reset rather than invalidate: the `["companies"]` entry is shared app-wide and
      // is not account-scoped, so invalidating leaves the previous account's list
      // readable (and any fetch for that session in flight) until the refetch lands.
      // Sign-in can change accounts, so drop the list outright.
      await queryClient.resetQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Authentication failed");
    },
  });

  const canSubmit =
    passwordEnabled &&
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (formMode === "sign_in" || (name.trim().length > 0 && password.trim().length >= 8));

  if (healthQuery.isLoading || isSessionLoading || session) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <AgentOSLoading className="min-h-0" />
      </div>
    );
  }

  // A health/session failure must not be mistaken for a self-hosted instance.
  if (healthQuery.error || sessionError) {
    return <p role="alert" className="p-6 text-sm text-destructive">Unable to check sign-in. Refresh and try again.</p>;
  }

  if (healthQuery.data?.cloud) {
    return <CloudSignIn cloud={healthQuery.data.cloud} returnTo={nextPath} />;
  }

  if (healthQuery.data?.deploymentMode === "local_trusted") {
    return <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6">
      <AgentOSBrand to="/welcome" />
      <h1 className="text-2xl font-medium">Your local workspace is ready.</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">This development instance trusts your device. Registration and Google sign-in become available when authenticated mode is configured.</p>
      <div><Button asChild><Link to="/workspace">Open workspace</Link></Button></div>
    </main>;
  }

  // Revalidate cached options before exposing an authentication method. Cloud
  // and trusted-local deployments above retain their own entry flows.
  if (options.isPending || options.isFetching) {
    return <div className="fixed inset-0 flex items-center justify-center">
      <AgentOSLoading className="min-h-0" />
    </div>;
  }
  if (options.error || !options.data) {
    return <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-6">
      <AgentOSBrand to="/welcome" />
      <p role="alert" className="text-sm text-destructive">Unable to load sign-in options. Try again.</p>
      <div><Button variant="outline" onClick={() => void options.refetch()}>Try again</Button></div>
    </main>;
  }

  return (
    <div className="agentos-public fixed inset-0 flex bg-background">
      {/* Left half — form */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="mb-8">
            <AgentOSBrand to="/welcome" />
          </div>

          <h1 className="text-xl font-semibold">
            {formMode === "sign_in" ? "Sign in to AgentOS" : "Create your AgentOS account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {!passwordEnabled && options.data.googleEnabled
              ? "Continue with Google to access your workspace."
              : formMode === "sign_in"
                ? "Welcome back. Sign in to your workspace."
                : "Register now. An administrator will review your account before granting workspace access."}
          </p>
          {!passwordEnabled && options.data.googleEnabled && options.data.approvalRequired && (
            <p className="mt-2 text-sm text-muted-foreground">New accounts require administrator approval.</p>
          )}
          {options.data.googleEnabled && <Button className="mt-6 w-full" variant="outline" disabled={google.isPending} onClick={() => { setError(null); google.mutate(); }}>{google.isPending ? "Connecting…" : "Continue with Google"}</Button>}
          {!passwordEnabled && !options.data.googleEnabled && (
            <p role="alert" className="mt-6 text-sm text-destructive">Sign-in is unavailable. Contact the instance administrator.</p>
          )}
          {error && (
            <p id={errorId} role="alert" className="mt-4 text-xs text-destructive">{error}</p>
          )}

          {passwordEnabled && <form
            className="mt-6 space-y-4"
            method="post"
            action={formMode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"}
            onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending) return;
              if (!canSubmit) {
                setError("Please fill in all required fields.");
                return;
              }
              mutation.mutate();
            }}
          >
            {formMode === "sign_up" && (
              <div>
                <label htmlFor="name" className="text-xs text-muted-foreground mb-1 block">Name</label>
                <input
                  id="name"
                  name="name"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  aria-required="true"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  autoFocus
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="text-xs text-muted-foreground mb-1 block">Email</label>
              <input
                id="email"
                name="email"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                autoFocus={formMode === "sign_in"}
              />
            </div>
            <div>
              <label htmlFor="password" className="text-xs text-muted-foreground mb-1 block">Password</label>
              <input
                id="password"
                name="password"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={formMode === "sign_in" ? "current-password" : "new-password"}
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </div>
            <Button
              type="submit"
              disabled={mutation.isPending}
              aria-disabled={!canSubmit || mutation.isPending}
              className={`w-full ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
            >
              {mutation.isPending
                ? "Working…"
                : formMode === "sign_in"
                  ? "Sign In"
                  : "Create Account"}
            </Button>
          </form>}

          {signUpEnabled && <div className="mt-5 text-sm text-muted-foreground">
            {formMode === "sign_in" ? "Need an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => {
                setError(null);
                setMode(formMode === "sign_in" ? "sign_up" : "sign_in");
              }}
            >
              {formMode === "sign_in" ? "Create one" : "Sign in"}
            </button>
          </div>}
        </div>
      </div>

      <div className="hidden w-1/2 flex-col items-center justify-center gap-6 overflow-hidden border-l border-border md:flex">
        <FridayOrb state="idle" label="Friday" />
        <p className="text-lg text-muted-foreground">Turn ideas into coordinated action.</p>
      </div>
    </div>
  );
}
