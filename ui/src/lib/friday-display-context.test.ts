import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { clearFridayDisplaySelection, setFridayDisplaySelection, syncFridayDisplayContext } from "./friday-display-context";
const api = vi.hoisted(() => ({ getDocument: vi.fn(), upsertDocument: vi.fn() }));
vi.mock("@/api/issues", () => ({ issuesApi: api }));
beforeEach(() => { vi.resetAllMocks(); clearFridayDisplaySelection(); api.getDocument.mockRejectedValue(new ApiError("Missing", 404, null)); api.upsertDocument.mockResolvedValue({}); });
it("sends selected decision context without presenting it as permission or approval", async () => {
  setFridayDisplaySelection("company", "attention", { decisionId: "decision" });
  await syncFridayDisplayContext("chat", { panel: "attention", companyId: "company", speakerId: "Friday", speakerCompanyId: "home" });
  const saved = api.upsertDocument.mock.calls[0][2];
  expect(JSON.parse(saved.body)).toEqual({ version: 1, display: { panel: "attention", companyId: "company" }, selection: { decisionId: "decision" } });
  expect(saved).toMatchObject({ baseRevisionId: null, changeSummary: expect.stringContaining("not an approval") });
});
it("does not carry a company's selection into another company or view", async () => {
  setFridayDisplaySelection("other", "attention", { decisionId: "private" });
  await syncFridayDisplayContext("chat", { panel: "attention", companyId: "company" }, "/AGE/issues/task");
  expect(JSON.parse(api.upsertDocument.mock.calls[0][2].body)).toMatchObject({ selection: null, nativePath: "/AGE/issues/task" });
});
it("retries a concurrent revision once using a fresh head and skips identical context", async () => {
  api.getDocument.mockResolvedValueOnce({ body: "old", latestRevisionId: "r1" }).mockResolvedValueOnce({ body: "new", latestRevisionId: "r2" });
  api.upsertDocument.mockRejectedValueOnce(new ApiError("Conflict", 409, null)).mockResolvedValueOnce({});
  await syncFridayDisplayContext("chat", { panel: null, companyId: "company" });
  expect(api.upsertDocument.mock.calls.map(call => call[2].baseRevisionId)).toEqual(["r1", "r2"]);
  api.getDocument.mockResolvedValue({ body: api.upsertDocument.mock.calls[1][2].body, latestRevisionId: "r3" });
  await syncFridayDisplayContext("chat", { panel: null, companyId: "company" });
  expect(api.upsertDocument).toHaveBeenCalledTimes(2);
});
it("surfaces authorization and persistent revision failures instead of sending stale context", async () => {
  api.getDocument.mockRejectedValueOnce(new ApiError("Forbidden", 403, null));
  await expect(syncFridayDisplayContext("chat", { panel: null })).rejects.toMatchObject({ status: 403 });
  expect(api.upsertDocument).not.toHaveBeenCalled();
  api.getDocument.mockResolvedValue({ body: "old", latestRevisionId: "r1" });
  api.upsertDocument.mockRejectedValue(new ApiError("Conflict", 409, null));
  await expect(syncFridayDisplayContext("chat", { panel: null })).rejects.toMatchObject({ status: 409 });
  expect(api.upsertDocument).toHaveBeenCalledTimes(2);
});
