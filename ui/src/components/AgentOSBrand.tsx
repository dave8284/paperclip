import { Link } from "@/lib/router";
import { FridayOrb } from "./FridayOrb";

export function AgentOSBrand({ to = "/workspace" }: { to?: string }) {
  return <Link to={to} className="agentos-brand" aria-label="AgentOS home"><FridayOrb decorative compact state="idle" label="AgentOS" /><span>AgentOS</span></Link>;
}
