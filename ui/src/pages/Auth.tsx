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

export function AuthPage() {
  const { setTheme } = useTheme();
  useEffect(() => setTheme("light"), [setTheme]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const joining = searchParams.get("mode") === "sign_up";
  const [error, setError] = useState<string | null>(null);
  const errorId = "auth-error";
  const options = useQuery({ queryKey: ["public-auth-options"], queryFn: administrationApi.authOptions, retry: false, refetchOnMount: "always" });
  const google = useMutation({
    mutationFn: () => authApi.signInGoogle(nextPath),
    onSuccess: async (url) => {
      setError(null);
      // OAuth can switch accounts. Clear identity-sensitive cached reads before
      // leaving, including any request for the previous company list in flight.
      queryClient.removeQueries({ queryKey: ["registration"] });
      queryClient.removeQueries({ queryKey: ["administration"] });
      await queryClient.resetQueries({ queryKey: queryKeys.access.currentBoardAccess });
      await queryClient.resetQueries({ queryKey: queryKeys.companies.all });
      navigateTopLevel(url);
    },
    onError: (failure: Error) => setError(failure.message),
  });

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
      {/* Google entry */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="mb-8">
            <AgentOSBrand to="/welcome" />
          </div>

          <h1 className="text-xl font-semibold">{joining ? "Join the AgentOS waiting list" : "Sign in to AgentOS"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {joining ? "Continue with Google to register your interest." : "Continue with Google to access your workspace."}
          </p>
          {options.data.googleEnabled && options.data.approvalRequired && (
            <p className="mt-2 text-sm text-muted-foreground">New accounts require administrator approval.</p>
          )}
          {options.data.googleEnabled ? (
            <Button className="mt-6 w-full" variant="outline" disabled={google.isPending}
              aria-describedby={error ? errorId : undefined}
              onClick={() => { setError(null); google.mutate(); }}>
              {google.isPending ? "Connecting…" : "Continue with Google"}
            </Button>
          ) : (
            <p role="alert" className="mt-6 text-sm text-destructive">Sign-in is unavailable. Contact the instance administrator.</p>
          )}
          {error && (
            <p id={errorId} role="alert" className="mt-4 text-xs text-destructive">{error}</p>
          )}

        </div>
      </div>

      <div className="hidden w-1/2 flex-col items-center justify-center gap-6 overflow-hidden border-l border-border md:flex">
        <FridayOrb state="idle" label="Friday" />
        <p className="text-lg text-muted-foreground">Turn ideas into coordinated action.</p>
      </div>
    </div>
  );
}
