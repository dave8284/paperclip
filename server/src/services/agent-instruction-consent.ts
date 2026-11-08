import { forbidden } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";

declare const instructionConsent: unique symbol;
export type InstructionChangeConsentReceipt = { readonly [instructionConsent]: true };
const receipts = new WeakMap<InstructionChangeConsentReceipt, {
  companyId: string; targetAgentId: string; actorAgentId: string; runId: string; keyId?: string;
}>();

/** Internal handoff after the route consumes native consent. No JSON value can
 * create this receipt. It authorizes one matching writer to reuse that check;
 * native grants, responsible identity and department scope are checked again. */
export function recordInstructionChangeConsent(actor: AuthorizationActor, target: { companyId: string; id: string }) {
  if (actor.type !== "agent" || actor.companyId !== target.companyId || !actor.agentId || !actor.runId)
    throw forbidden("Instruction consent requires its authenticated agent execution");
  const receipt = Object.freeze({}) as InstructionChangeConsentReceipt;
  receipts.set(receipt, { companyId: target.companyId, targetAgentId: target.id,
    actorAgentId: actor.agentId, runId: actor.runId, keyId: actor.keyId ?? undefined });
  return receipt;
}

export function consumeInstructionChangeConsent(receipt: InstructionChangeConsentReceipt | undefined,
  actor: AuthorizationActor, target: { companyId: string; id: string }) {
  if (!receipt) return false;
  const saved = receipts.get(receipt);
  if (!saved || actor.type !== "agent" || saved.companyId !== target.companyId || saved.companyId !== actor.companyId
    || saved.targetAgentId !== target.id || saved.actorAgentId !== actor.agentId || saved.runId !== actor.runId || saved.keyId !== (actor.keyId ?? undefined))
    throw forbidden("Instruction consent does not match this writer");
  receipts.delete(receipt);
  return true;
}
