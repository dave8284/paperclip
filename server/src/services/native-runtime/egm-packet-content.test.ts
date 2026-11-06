import { expect, it, vi } from "vitest";
import { prepareEgmPacketContent, parseRetainedEgmPacket, canonicalEgmJson } from "./egm-packet-content.js";
import { egmCreatorAuthority } from "./egm-packet-authority.js";
vi.mock("../documents.js", () => ({ documentService: () => ({ getIssueDocumentRevision: async (input: { documentId: string; revisionId: string }) => ({
  ...input, key: input.documentId.endsWith("000010") ? "context-packet" : "plan", revisionNumber: 1, latestRevisionId: input.revisionId, body: "Synthetic package validation source",
}) }) }));
it("loads and verifies the actual bundled persona and standard without provider access", async () => {
  const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const actor = { type: "agent" as const, agentId: id(4), runId: id(3), companyId: id(1), onBehalfOfUserId: "synthetic-owner", source: "agent_jwt" as const };
  const packet = await prepareEgmPacketContent({} as never, { companyId: id(1), issueId: id(2), sourceRunId: id(3), authorAgentId: id(4),
    preparedBy: { type: "agent", id: id(4) }, creatorAuthority: egmCreatorAuthority(actor),
    request: { reviewerAgentId: id(5), packet: { documentId: id(10), revisionId: id(11) }, target: { documentId: id(12), revisionId: id(13) }, sources: [], persona: "comprehension", question: "Can this artifact explain itself?" },
  });
  expect(packet.persona.body.length).toBeGreaterThan(100);
  expect(packet.standard.path).toContain("re-implementation-standard");
  expect(parseRetainedEgmPacket(Object.fromEntries(Object.entries(packet).reverse()))).toEqual(packet);
  expect(packet.execution).toBe("independent_review_unavailable");
  expect(canonicalEgmJson({ z: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"z":1}');
});
