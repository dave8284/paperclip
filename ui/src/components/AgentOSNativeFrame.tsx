import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { useTheme } from "@/context/ThemeContext";
import { fridayNavigationSearch, type FridayNavigation } from "@/lib/friday-navigation";
import { AgentOSHeader, AgentOSSidebar } from "./AgentOSNavigation";
import { FridayDock } from "./FridayDock";

/** Native settings and record pages share the Agent OS navigation. */
export function AgentOSNativeFrame({ children, context, properties }: { children: ReactNode; context?: ReactNode; properties?: ReactNode }) {
  const { companies, selectedCompanyId } = useCompany();
  const { setTheme } = useTheme();
  useEffect(() => setTheme("light"), [setTheme]);
  const navigate = useNavigate();
  const go = (view: FridayNavigation) => navigate({ pathname: "/friday", search: fridayNavigationSearch(view) });
  const scope: FridayNavigation = { panel: "work", companyId: selectedCompanyId ?? undefined };
  return <div className="agentos-app agentos-native-frame"><AgentOSHeader view={scope} navigate={go} onSettings={() => navigate("/company/settings")} />
    <div className="agentos-workspace-shell"><AgentOSSidebar companies={companies} view={scope} navigate={go} /><div className="agentos-native-content">{context && <div className="agentos-native-context">{context}</div>}<div className="agentos-native-page">{children}</div>{properties}</div></div>
    <FridayDock />
  </div>;
}
