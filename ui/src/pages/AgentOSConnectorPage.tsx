import { useCompany } from "@/context/CompanyContext";
import { AgentOSConnectors } from "@/components/AgentOSConnectors";
import { lazy, Suspense } from "react";
import { useSearchParams } from "@/lib/router";

const SavedAggregatorContinuation = lazy(() => import("./apps/Browse").then(module => ({ default: module.Browse })));

/** Native account setup/detail URLs remain available for existing connections. */
export function AgentOSConnectorPage() {
  const { selectedCompanyId } = useCompany();
  const [params] = useSearchParams();
  // Existing account setup returns here after its provider handoff. Preserve
  // that explicit continuation without restoring the broad default catalog.
  if (params.get("source") === "composio" && params.get("targetToolkit")) {
    return <Suspense fallback={<p role="status">Loading saved account setup…</p>}><SavedAggregatorContinuation /></Suspense>;
  }
  return selectedCompanyId
    ? <AgentOSConnectors key={selectedCompanyId} companyId={selectedCompanyId} />
    : <p className="agentos-empty">Select a company to manage its connectors.</p>;
}
