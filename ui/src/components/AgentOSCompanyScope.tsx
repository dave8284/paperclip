import type { ReactNode } from "react";
import type { Company } from "@paperclipai/shared";
import { CompanyViewProvider } from "@/context/CompanyContext";
import { CompanyRouteScope } from "@/lib/router";

export function AgentOSCompanyScope({ company, children }: { company: Company; children: ReactNode }) {
  return <CompanyViewProvider companyId={company.id}><CompanyRouteScope companyPrefix={company.issuePrefix}>{children}</CompanyRouteScope></CompanyViewProvider>;
}
