import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleUserRound, LogOut } from "lucide-react";
import { authApi } from "@/api/auth";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/lib/queryKeys";
import { fridayVoiceSession } from "@/lib/friday-voice-session";
import { useSignOut } from "@/hooks/useSignOut";
import { Link, useNavigate } from "@/lib/router";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function AgentOSAccountMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false });
  const health = useQuery({ queryKey: queryKeys.health, queryFn: healthApi.get });
  const signOut = useSignOut();
  const localWorkspace = health.data?.deploymentMode === "local_trusted";
  const leave = async () => { fridayVoiceSession.disable(); await signOut.mutateAsync(); setOpen(false); navigate("/auth"); };
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Your profile"><CircleUserRound /></Button></PopoverTrigger><PopoverContent align="end" className="space-y-3">
    <p className="font-medium">{localWorkspace ? "Local workspace" : session.data?.user.name || "Your profile"}</p>
    {!localWorkspace && session.data?.user.email && <p className="text-sm text-muted-foreground">{session.data.user.email}</p>}
    {localWorkspace ? <p className="text-sm text-muted-foreground">This local workspace is not using account sign-in yet.</p>
      : session.data ? <><Button variant="outline" disabled={signOut.isPending} onClick={() => void leave().catch(() => {})}><LogOut />Sign out</Button><Button variant="ghost" disabled={signOut.isPending} onClick={() => void leave().catch(() => {})}>Use a different account</Button></>
      : <Button asChild variant="outline"><Link to="/auth">Sign in</Link></Button>}
    {(session.error || signOut.error || health.error) && <p role="alert" className="text-sm text-destructive">{session.error?.message || signOut.error?.message || health.error?.message}</p>}
  </PopoverContent></Popover>;
}
