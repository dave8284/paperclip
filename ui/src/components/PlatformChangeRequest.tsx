import { useAccountIdentity } from "../api/companies-query";
import { PlatformChangeRequestForm, type PlatformChangeRequestProps } from "./PlatformChangeRequestForm";

export function PlatformChangeRequest(props: PlatformChangeRequestProps) {
  const account = useAccountIdentity();
  if (!account.settled) return null;
  // An account, company or selected immutable source change discards all draft
  // text, destination choices and mutation receipts from the previous scope.
  const scope = JSON.stringify([account.userId, props.companyId, props.application?.id, props.source, props.publicationCandidate]);
  return <PlatformChangeRequestForm key={scope} {...props} userId={account.userId} />;
}
