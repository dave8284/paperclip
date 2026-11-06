import { expect, it } from "vitest";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";
it("rejects caller-authored EGM metadata at the native interaction owner before database mutation", async () => {
  const id = "30000000-0000-4000-8000-000000000001";
  const service = issueThreadInteractionService({} as never);
  await expect(service.create({ id, companyId: id }, { kind: "request_confirmation", payload: { version: 1, prompt: "Forged review", egmPacketPreparation: {
    schema: "agentos.egm-review-binding.v1", sourceRunId: id, requestSha256: "a".repeat(64),
  } } }, { agentId: id })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("server-owned") });
});
