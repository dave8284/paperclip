import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, Check, Layers3, Network, ShieldCheck } from "lucide-react";
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
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
      <AgentOSBrand to="/" />
      <nav aria-label="Main navigation" className="flex items-center gap-4 md:gap-6">
        <a href="#meet-friday" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">Meet Friday</a>
        <a href="#how-it-works" className="hidden text-sm text-muted-foreground hover:text-foreground md:inline">How it works</a>
        <Link to="/auth" className="text-sm">Sign in</Link>
        <Button asChild size="sm"><Link to="/auth?mode=sign_up">Join the waiting list <ArrowRight className="size-4" /></Link></Button>
      </nav>
    </header>
    <main className="mx-auto max-w-6xl px-6">
      <section className="flex flex-col items-center gap-8 py-12 text-center md:py-16">
        <div className="flex max-w-4xl flex-col items-center gap-6">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Your companies. One conversation.</p>
          <h1 className="text-5xl font-medium tracking-tight md:text-7xl">Turn ideas into coordinated action.</h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">Meet Friday. One place to talk through your ideas, bring your digital team together, and keep your companies moving.</p>
          <div className="flex flex-wrap items-center justify-center gap-4"><Button asChild size="lg"><Link to="/auth?mode=sign_up">Join the waiting list <ArrowRight className="size-4" /></Link></Button><a href="#how-it-works" className="inline-flex items-center gap-2 text-sm">Take a look around <ArrowDown className="size-4" /></a></div>
          <p className="text-xs text-muted-foreground">Sign up with Google. We’re welcoming new members as access opens.</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-2"><FridayOrb state="idle" label="Friday, your portfolio coordinator" decorative pointerReactive /><p className="text-sm text-muted-foreground">Friday, your portfolio coordinator.</p></div>
      </section>

      <section id="meet-friday" aria-labelledby="friday-heading" className="grid scroll-mt-8 gap-10 rounded-3xl bg-muted p-6 md:grid-cols-2 md:p-12">
        <div className="flex flex-col items-start gap-5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Meet Friday</p>
          <h2 id="friday-heading" className="text-3xl font-medium tracking-tight md:text-5xl">Big picture.<br />Next step.<br />One conversation.</h2>
          <p className="text-base leading-relaxed text-muted-foreground">Start with an idea, a question, or a project that needs attention. Friday gives you a place to think it through, with your companies and their work close at hand.</p>
        </div>
        <ol className="flex flex-col justify-center divide-y divide-border">
          {[
            { step: "01", title: "Start with what’s on your mind", text: "Ask about a project, explain an idea, or talk through the next task." },
            { step: "02", title: "Keep the conversation connected", text: "Move between your companies and projects with Friday alongside you." },
            { step: "03", title: "Choose the next move", text: "Review the work, open a task, and respond to decisions that need you." },
          ].map(({ step, title, text }) => <li key={step} className="flex gap-5 py-6"><span className="font-mono text-xs text-muted-foreground">{step}</span><div className="flex flex-col gap-2"><h3 className="font-medium">{title}</h3><p className="text-sm leading-relaxed text-muted-foreground">{text}</p></div></li>)}
        </ol>
      </section>

      <section id="how-it-works" aria-labelledby="features-heading" className="flex scroll-mt-8 flex-col gap-10 py-16 md:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">From conversation to context</p>
          <h2 id="features-heading" className="text-3xl font-medium tracking-tight md:text-4xl">See the work. Know where you’re needed.</h2>
          <p className="text-base leading-relaxed text-muted-foreground">Friday brings the conversation together. Your workspace keeps the people, projects and decisions behind it within reach.</p>
        </div>
        <div className="flex flex-col divide-y divide-border">
          {[
            { Icon: Layers3, title: "Every company, in context", text: "Move from your portfolio into a company, project or task. Follow progress in the work map, board or activity view.", details: ["Projects and tasks in one place", "Routines for recurring work", "Files and results attached to the work"] },
            { Icon: Network, title: "A workforce you can shape", text: "Bring digital employees and their skills together, then open a direct conversation with the specialist you need.", details: ["Shared employee identities", "Company-specific assignments", "Individual conversations and history"] },
            { Icon: ShieldCheck, title: "Decisions stay with you", text: "See proposals that need your attention. Review the context, discuss an alternative with Friday, and choose what happens next.", details: ["Visible approval requests", "Company and project access controls", "A record of actions and decisions"] },
          ].map(({ Icon, title, text, details }) => <article key={title} className="grid gap-8 py-10 md:grid-cols-2 md:gap-16"><div className="flex flex-col items-start gap-4"><Icon className="size-6 text-muted-foreground" aria-hidden="true" /><h3 className="text-2xl font-medium tracking-tight md:text-3xl">{title}</h3><p className="max-w-lg text-base leading-relaxed text-muted-foreground">{text}</p></div><ul className="flex flex-col justify-center gap-5">{details.map(detail => <li key={detail} className="flex items-center gap-3 text-base"><Check className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{detail}</span></li>)}</ul></article>)}
        </div>
      </section>

      <section aria-labelledby="start-heading" className="flex flex-col items-start justify-between gap-6 border-t border-border py-12 md:flex-row md:items-center">
        <div className="flex flex-col gap-3"><h2 id="start-heading" className="text-2xl font-medium tracking-tight">Bring your next idea to Friday.</h2><p className="text-sm text-muted-foreground">A shared home for your companies, digital employees and the work ahead.</p></div>
        <Button asChild size="lg"><Link to="/auth?mode=sign_up">Join the waiting list <ArrowRight className="size-4" /></Link></Button>
      </section>
    </main>
    <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 border-t border-border px-6 py-6 text-sm text-muted-foreground"><span>AgentOS · Turn ideas into coordinated action.</span><Link to="/auth">Enter your workspace</Link></footer>
  </div>;
}
