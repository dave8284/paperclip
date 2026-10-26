import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Layers3, Network, ShieldCheck } from "lucide-react";
import { Link, Navigate } from "@/lib/router";
import { administrationApi, registrationKey } from "@/api/administration";
import { useAccountIdentity } from "@/api/companies-query";
import { useTheme } from "@/context/ThemeContext";
import { AgentOSBrand } from "@/components/AgentOSBrand";
import { FridayOrb } from "@/components/FridayOrb";
import { Button } from "@/components/ui/button";

export function AgentOSLanding({ preview = false }: { preview?: boolean }) {
  const { setTheme } = useTheme();
  useEffect(() => setTheme("light"), [setTheme]);
  const { userId } = useAccountIdentity();
  const state = useQuery({ queryKey: registrationKey(userId), queryFn: administrationApi.registration, retry: false });
  if (!preview && state.data?.status === "approved") return <Navigate to="/workspace" replace />;
  if (!preview && state.data && !["anonymous", "approved"].includes(state.data.status)) return <Navigate to="/pending-approval" replace />;
  return <div className="agentos-public min-h-dvh bg-background text-foreground">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
      <AgentOSBrand to="/" />
      <div className="flex items-center gap-4"><Link to="/auth" className="text-sm">Sign in</Link><Button asChild size="sm"><Link to="/auth?mode=sign_up">Get started <ArrowRight className="size-4" /></Link></Button></div>
    </header>
    <main className="mx-auto max-w-6xl px-6">
      <section className="grid items-center gap-8 py-16 md:grid-cols-2 md:py-24">
        <div className="space-y-6">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Your companies. One conversation.</p>
          <h1 className="text-4xl font-medium tracking-tight md:text-6xl">A little clarity,<br />a lot in motion.</h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">Meet Friday. A shared home for your companies, digital employees, projects and decisions. See the work. Shape what happens next.</p>
          <div className="flex flex-wrap items-center gap-4"><Button asChild size="lg"><Link to="/auth?mode=sign_up">Create your account <ArrowRight className="size-4" /></Link></Button><span className="text-sm text-muted-foreground">Access reviewed by an administrator.</span></div>
        </div>
        <div className="flex flex-col items-center justify-center gap-4"><FridayOrb state="idle" label="Friday, your portfolio coordinator" /><p className="text-sm text-muted-foreground">One place to bring everything together.</p></div>
      </section>
      <section aria-label="Explore Agent OS" className="grid gap-6 border-t border-border py-12 md:grid-cols-3">
        {[
          { Icon: Layers3, title: "Every company, in context", text: "Move from portfolio to company, project and task, with decisions and routines in the right place." },
          { Icon: Network, title: "People and work connected", text: "Build a reusable workforce. Follow assignments, skills, artefacts and activity as work moves forward." },
          { Icon: ShieldCheck, title: "Clear authority", text: "Keep company access, approvals and audit history visible. You decide who enters your workspace." },
        ].map(({ Icon, title, text }) => <article key={title} className="space-y-3 rounded-2xl border border-border p-6"><Icon className="size-5 text-muted-foreground" /><h2 className="font-medium">{title}</h2><p className="text-sm leading-relaxed text-muted-foreground">{text}</p></article>)}
      </section>
    </main>
    <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 border-t border-border px-6 py-6 text-sm text-muted-foreground"><span>Agent OS · Your portfolio, in motion</span><Link to="/auth">Enter your workspace</Link></footer>
  </div>;
}
